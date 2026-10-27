// T087 (SC-109, FR-170 to FR-173, research R-107; quickstart §4): the administrator's sign-in seen
// from outside. Through the running local API it signs the seed's administrator in with a wrong
// password until the lockout's count, once more while locked, then with the right password while
// locked, timing each answer; and it says whether every answer was the same.
//
//   pnpm exec tsx scripts/dev/admin-lockout-probe.ts [--api <origin>]
//
// IT IS NOT READ-ONLY (note under T087, the owner's approval of 2026-10-27). Each wrong attempt is
// counted toward the lockout, which the API writes: the seed's administrator is locked for
// `admin_lockout_minutes` when the probe ends. So it runs only on this machine (`local-only.ts`),
// only against the seed's administrator (`prisma/seed.ts`, by id and address, its password set by
// `admin-invite.ts`), says before its first attempt how the attempts count, with the counts read from
// `settings`, and reads the right password from hidden input, never from its arguments. The database
// is only read, over a read-only session.
//
// THE VERDICT. Every answer is the sign-in refusal (401, `ADMIN_SIGN_IN_FAILED`), with the same
// status and a byte-identical body; none signs in; none
// carries a count, in its body or a header's name; and the spread of the timings is under
// `TOLERANCE_IN_VERIFIES` password verifies, T060's tolerance (`admin-auth.service.spec.ts`: "the
// tolerance is one verify"). That spec holds the verify's time as a constant of its own, which no
// file exports; here one verify is measured on this machine, the fastest of three with the API's own
// `verifyPassword`, as that spec takes the fastest of three runs so a pause is not read as a
// difference. Each attempt is sent once, since a repeat would change the count it probes.
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import { hashPassword, verifyPassword } from '../../apps/api/src/platform/crypto/hashing';
import { ADMINISTRATOR } from '../../prisma/seed';
import {
  apiOriginOf,
  connectReadOnly,
  type Connection,
  type Env,
  environment,
  lineWriter,
  localOnlyRefusal,
} from './local-only';

/** T060's tolerance: the spread of the refusals' timings stays under one password verify. */
export const TOLERANCE_IN_VERIFIES = 1;

/** The administrator surface's sign-in, a tRPC mutation under `/admin/trpc` (T067). */
export const SIGN_IN_PATH = '/admin/trpc/auth.signIn';

const USAGE = 'usage: admin-lockout-probe.ts [--api <origin>]  (the password is asked for, hidden)';
const SEND_TIMEOUT_MILLISECONDS = 10_000;
const VERIFY_SAMPLES = 3;
const WRONG_PASSWORD_BYTES = 18;
/** The attempts after the count: one more wrong, and the right one, both while locked. */
const ATTEMPTS_WHILE_LOCKED = 2;

const ATTEMPTS_SETTING = 'admin_lockout_attempts';
const MINUTES_SETTING = 'admin_lockout_minutes';
const THROTTLE_SETTING = 'rate_limit_authentication';

/** The arguments, or the usage line. The password and the account are never arguments. */
export function parseArguments(argv: readonly string[]): { readonly api?: string } | string {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { api: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    return values.api === undefined ? {} : { api: values.api };
  } catch {
    return USAGE;
  }
}

export interface HiddenStep {
  readonly typed: string;
  readonly state: 'typing' | 'entered' | 'cancelled';
}

/** What is typed after `chunk` arrives: Enter ends it, Backspace erases, Ctrl-C (or Ctrl-D on an empty line) cancels. */
export function hiddenInputStep(typed: string, chunk: string): HiddenStep {
  let text = typed;
  for (const char of chunk) {
    if (char === '\r' || char === '\n') return { typed: text, state: 'entered' };
    if (char === '\u0003' || (char === '\u0004' && text === '')) {
      return { typed: '', state: 'cancelled' };
    }
    if (char === '\u007f' || char === '\b') text = text.slice(0, -1);
    else if (char >= ' ') text += char;
  }
  return { typed: text, state: 'typing' };
}

/** Reads one line from `input` without echoing it; null when cancelled. */
function readHidden(input: NodeJS.ReadStream): Promise<string | null> {
  return new Promise((resolve) => {
    let typed = '';
    const raw = input.isTTY;
    const finish = (value: string | null): void => {
      input.off('data', onData);
      input.off('end', onEnd);
      if (raw) input.setRawMode(false);
      input.pause();
      resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      const step = hiddenInputStep(typed, chunk.toString());
      typed = step.typed;
      if (step.state === 'entered') finish(typed);
      if (step.state === 'cancelled') finish(null);
    };
    const onEnd = (): void => finish(typed === '' ? null : typed);
    if (raw) input.setRawMode(true);
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

export interface Plan {
  readonly attempts: number;
  readonly minutes: number;
  readonly throttleLimit: number;
}

const positiveWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** The lockout pair and the throttle, from the rows of `settings`; or why the probe cannot run. */
export function planOf(rows: readonly { key: string; value: unknown }[]): Plan | string {
  const valueOf = (key: string): unknown => rows.find((row) => row.key === key)?.value;
  const attempts = valueOf(ATTEMPTS_SETTING);
  const minutes = valueOf(MINUTES_SETTING);
  const throttle = valueOf(THROTTLE_SETTING);
  if (!positiveWhole(attempts))
    return `the setting ${ATTEMPTS_SETTING} is missing or not a positive whole number`;
  if (!positiveWhole(minutes))
    return `the setting ${MINUTES_SETTING} is missing or not a positive whole number`;
  const throttleLimit =
    typeof throttle === 'object' && throttle !== null && 'limit' in throttle
      ? throttle.limit
      : null;
  if (!positiveWhole(throttleLimit))
    return `the setting ${THROTTLE_SETTING} is missing or has no limit`;
  if (attempts + ATTEMPTS_WHILE_LOCKED > throttleLimit) {
    return `${attempts + ATTEMPTS_WHILE_LOCKED} attempts would meet the throttle (${THROTTLE_SETTING}) before the lockout is probed`;
  }
  return { attempts, minutes, throttleLimit };
}

/** One answer as the verdict reads it. */
export interface Attempt {
  readonly label: string;
  readonly status: number;
  readonly body: string;
  readonly headerNames: readonly string[];
  readonly milliseconds: number;
}

export interface Verdict {
  readonly passed: boolean;
  readonly findings: readonly string[];
}

/** The one answer of the admin sign-in to a wrong password and to a locked account (T060). */
const SIGN_IN_REFUSED = 'ADMIN_SIGN_IN_FAILED';
const SIGN_IN_REFUSED_STATUS = 401;

/** A header whose name gives away a count, or how long a lock lasts. */
const COUNT_HEADER = /attempt|remaining|retry-after|lock/i;
/** A number, or a word for a count, anywhere in a body. */
const COUNT_IN_BODY = /[0-9]|attempt|remaining|count/i;

/** Whether the answers were the same: status, body, no count, timing within the tolerance. */
export function judge(attempts: readonly Attempt[], oneVerifyMilliseconds: number): Verdict {
  const findings: string[] = [];
  const [first] = attempts;
  if (first === undefined) return { passed: false, findings: ['no attempt was made'] };
  // Answers alike in some other refusal (a wrong path, a lost session) never reached the lockout.
  if (first.status !== SIGN_IN_REFUSED_STATUS || !first.body.includes(`"${SIGN_IN_REFUSED}"`)) {
    findings.push(
      `${first.label}: HTTP ${first.status} is not the sign-in refusal (${SIGN_IN_REFUSED_STATUS}, ${SIGN_IN_REFUSED}); the lockout was not reached`,
    );
  }
  for (const attempt of attempts) {
    if (attempt.status >= 200 && attempt.status < 300) {
      findings.push(
        `${attempt.label}: signed in (HTTP ${attempt.status}); the lockout did not hold`,
      );
    }
    if (attempt.status !== first.status) {
      findings.push(
        `${attempt.label}: HTTP ${attempt.status}, where ${first.label} answered ${first.status}`,
      );
    }
    if (attempt.body !== first.body)
      findings.push(`${attempt.label}: the body differs from ${first.label}'s`);
    if (
      COUNT_IN_BODY.test(attempt.body) ||
      attempt.headerNames.some((name) => COUNT_HEADER.test(name))
    ) {
      findings.push(`${attempt.label}: the response carries a count`);
    }
  }
  const timings = attempts.map(({ milliseconds }) => milliseconds);
  const spread = Math.max(...timings) - Math.min(...timings);
  const tolerance = TOLERANCE_IN_VERIFIES * oneVerifyMilliseconds;
  if (spread >= tolerance) {
    findings.push(
      `timing: the spread is ${spread.toFixed(1)} ms, not under ${tolerance.toFixed(1)} ms (${TOLERANCE_IN_VERIFIES} verify)`,
    );
  }
  return { passed: findings.length === 0, findings };
}

export interface RunDependencies {
  readonly connect: (url: string) => Promise<Connection>;
  readonly fetch: typeof fetch;
  /** The right password, typed hidden; null when the person cancelled. */
  readonly readSecret: () => Promise<string | null>;
  /** One password verify's time on this machine. */
  readonly oneVerifyMilliseconds: () => Promise<number>;
  readonly now: () => number;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

interface AdministratorState {
  readonly passwordSet: boolean;
  readonly active: boolean;
  readonly locked: boolean;
}

/** The seed's administrator and the settings, or why the probe will not run against it. */
async function preconditionsOf(db: Connection): Promise<Plan | string> {
  // One client runs one query at a time, so the two reads go one after the other.
  const { rows: administrators } = await db.query<AdministratorState>(
    `SELECT password_set_at IS NOT NULL AS "passwordSet",
            is_active AS "active",
            locked_until_at IS NOT NULL AND locked_until_at > now() AS "locked"
       FROM admin_users
      WHERE id = $1 AND email = $2`,
    [ADMINISTRATOR.id, ADMINISTRATOR.email],
  );
  const { rows: settings } = await db.query<{ key: string; value: unknown }>(
    'SELECT key, value FROM settings WHERE key = ANY($1::text[])',
    [[ATTEMPTS_SETTING, MINUTES_SETTING, THROTTLE_SETTING]],
  );
  const [administrator] = administrators;
  if (administrator === undefined)
    return 'the seed’s administrator is not in this database (pnpm db:seed)';
  if (!administrator.passwordSet) {
    return 'the seed’s administrator has no password yet: run scripts/dev/admin-invite.ts and set it';
  }
  if (!administrator.active) return 'the seed’s administrator is disabled';
  if (administrator.locked)
    return 'the seed’s administrator is locked already; run the probe once the lock lifts';
  return planOf(settings);
}

function wrongPassword(right: string, used: ReadonlySet<string>): string {
  for (;;) {
    const candidate = randomBytes(WRONG_PASSWORD_BYTES).toString('base64url');
    if (candidate !== right && !used.has(candidate)) return candidate;
  }
}

async function signIn(
  deps: RunDependencies,
  api: string,
  label: string,
  password: string,
): Promise<Attempt> {
  const started = deps.now();
  const response = await deps.fetch(new URL(SIGN_IN_PATH, api), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMINISTRATOR.email, password }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MILLISECONDS),
  });
  const body = await response.text();
  const milliseconds = deps.now() - started;
  return {
    label,
    status: response.status,
    body,
    headerNames: [...response.headers.keys()],
    milliseconds,
  };
}

/** Probes the lockout; the process's exit code. */
export async function run(
  argv: readonly string[],
  env: Env,
  deps: RunDependencies,
): Promise<number> {
  const say = (line: string): void => deps.err(`admin-lockout-probe: ${line}`);
  const parsed = parseArguments(argv);
  if (typeof parsed === 'string') {
    say(parsed);
    return 2;
  }
  const api = apiOriginOf(env, parsed.api);
  const refusal = localOnlyRefusal(env, api);
  if (refusal !== null) {
    say(refusal);
    return 1;
  }
  const db = await deps.connect(env['DATABASE_URL'] ?? '');
  let plan: Plan | string;
  try {
    plan = await preconditionsOf(db);
  } finally {
    await db.end().catch(() => undefined);
  }
  if (typeof plan === 'string') {
    say(plan);
    return 1;
  }
  const wrongCount = plan.attempts + 1;
  deps.out(
    `admin-lockout-probe: these attempts count toward the lockout of the seed’s administrator ` +
      `(${ADMINISTRATOR.email}): ${plan.attempts} attempts lock it for ${plan.minutes} minutes. ` +
      `The probe makes ${wrongCount} wrong attempts and one right one, so the account stays locked ` +
      `for ${plan.minutes} minutes after it ends. Ctrl-C at the prompt to stop here.`,
  );
  const right = await deps.readSecret();
  if (right === null || right === '') {
    say('no password was typed; nothing was sent');
    return 1;
  }
  const oneVerify = await deps.oneVerifyMilliseconds();
  const attempts: Attempt[] = [];
  const used = new Set<string>();
  // One after another: the lockout is the order of the attempts.
  for (let index = 1; index <= wrongCount; index += 1) {
    const wrong = wrongPassword(right, used);
    used.add(wrong);
    const label = index > plan.attempts ? `wrong ${index} (locked)` : `wrong ${index}`;
    attempts.push(await signIn(deps, api, label, wrong));
  }
  attempts.push(await signIn(deps, api, 'right (locked)', right));
  for (const { label, status, milliseconds } of attempts) {
    deps.out(`  ${label.padEnd(16)} HTTP ${status}  ${milliseconds.toFixed(1)} ms`);
  }
  const verdict = judge(attempts, oneVerify);
  deps.out(`  one verify on this machine: ${oneVerify.toFixed(1)} ms (the tolerance)`);
  for (const finding of verdict.findings) deps.out(`  - ${finding}`);
  deps.out(`admin-lockout-probe: ${verdict.passed ? 'PASS' : 'FAIL'}`);
  return verdict.passed ? 0 : 1;
}

/** One password verify on this machine: the fastest of a few, so a pause is not read as its cost. */
async function measureOneVerify(): Promise<number> {
  const stored = await hashPassword(randomBytes(WRONG_PASSWORD_BYTES).toString('base64url'));
  let fastest = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < VERIFY_SAMPLES; sample += 1) {
    const started = performance.now();
    await verifyPassword('not the password', stored);
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

// Run as a command (tsx), never when a spec imports it; tsx compiles this file as CommonJS.
if (basename(process.argv[1] ?? '') === 'admin-lockout-probe.ts') {
  void run(process.argv.slice(2), environment(), {
    connect: connectReadOnly,
    fetch,
    readSecret: async () => {
      process.stderr.write('The right password (hidden): ');
      const typed = await readHidden(process.stdin);
      process.stderr.write('\n');
      return typed;
    },
    oneVerifyMilliseconds: measureOneVerify,
    now: () => performance.now(),
    out: lineWriter(process.stdout),
    err: lineWriter(process.stderr),
  }).then((code) => {
    process.exitCode = code;
  });
}
