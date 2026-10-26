// T079 (FR-191, FR-194; quickstart §6): the payment stand-in's gateway, acting by hand. It sends
// the API's payment webhook a signed `recipient_verified` or `recipient_rejected` event for one
// teacher's registered payout recipient, as the gateway would once it checked the account.
//
//   pnpm exec tsx scripts/dev/emit-recipient-event.ts --teacher <user id> --verdict rejected --reason "name mismatch"
//   pnpm exec tsx scripts/dev/emit-recipient-event.ts --teacher <user id> --verdict verified
//   pnpm exec tsx scripts/dev/emit-recipient-event.ts --teacher <user id> --verdict verified   # a replay
//
// `--teacher` is the teacher's user id (a `teacher_profiles` id is accepted too); `--api` names the
// API's origin, `http://localhost:<PORT>` by default. The recipient reference is read from
// `teacher_profiles.payout_account_ref_encrypted` and decrypted with the column cipher, bound to the
// profile's row as the identity module stores it (R-DB-8). The body is the stand-in's own form
// (`{ id, type, recipient, reason? }`), signed by HMAC-SHA256 in `x-fake-signature` under the secret
// the API verifies with, `standInWebhookSecret` of the payment port's entry: the configured
// `PAYMENT_GATEWAY_WEBHOOK_SECRET`, or the one derived from `ENCRYPTION_KEY` (T121). The event id is
// decided by the reference, the verdict and the reason, so the same command twice sends the same
// event, which the API records once (FR-PAYG-4).
//
// IT RUNS ONLY ON THIS MACHINE (the owner's condition 3 at B15's check): it refuses, before it
// opens the database or sends anything, unless `NODE_ENV` is `development` or `test`, `DATABASE_URL`
// names a database on this machine (`localhost`, `127.0.0.1` or `::1`, with no `host` parameter
// pointing elsewhere), and the API's origin is on this machine too. It prints the event's id and the
// API's status, never the reference.
import { createHash, createHmac } from 'node:crypto';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

import { config as readDotenv } from 'dotenv';
import pg from 'pg';

import { PAYMENT_WEBHOOK_PATH } from '../../apps/api/src/modules/payments/index';
import { ColumnCipher } from '../../apps/api/src/platform/crypto/encryption';
import { standInWebhookSecret } from '../../apps/api/src/platform/ports/payment/index';

/** The stand-in's signature header (note under T117). */
const SIGNATURE_HEADER = 'x-fake-signature';

/** Where the identity module keeps the reference, as the cipher binds it (R-DB-8). */
const PAYOUT_REF_COLUMN = 'teacher_profiles.payout_account_ref_encrypted';

const DEVELOPMENT_MODES: ReadonlySet<string> = new Set(['development', 'test']);
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PORT = '3000';
const SEND_TIMEOUT_MILLISECONDS = 10_000;

const USAGE =
  'usage: emit-recipient-event.ts --teacher <id> --verdict verified|rejected [--reason "…"] [--api <origin>]';

export type Verdict = 'verified' | 'rejected';

export interface EmitArguments {
  readonly teacher: string;
  readonly verdict: Verdict;
  /** Only with `rejected`. */
  readonly reason?: string;
  readonly api?: string;
}

/** The arguments, or the usage line saying what is wrong with them. */
export function parseArguments(argv: readonly string[]): EmitArguments | string {
  let values: { teacher?: string; verdict?: string; reason?: string; api?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        teacher: { type: 'string' },
        verdict: { type: 'string' },
        reason: { type: 'string' },
        api: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return USAGE;
  }
  const { teacher, verdict, reason, api } = values;
  if (teacher === undefined || !UUID.test(teacher)) return `${USAGE}\n  --teacher is a uuid`;
  if (verdict !== 'verified' && verdict !== 'rejected') {
    return `${USAGE}\n  --verdict is verified or rejected`;
  }
  if (reason !== undefined && (verdict !== 'rejected' || reason.trim() === '')) {
    return `${USAGE}\n  --reason is a non-empty text, and only a rejection carries one`;
  }
  return {
    teacher,
    verdict,
    ...(reason === undefined ? {} : { reason }),
    ...(api === undefined ? {} : { api }),
  };
}

type Env = Readonly<Record<string, string | undefined>>;

function isLocalDatabase(url: string | undefined): boolean {
  if (url === undefined || !URL.canParse(url)) return false;
  const parsed = new URL(url);
  // libpq and pg read a `host` or `hostaddr` parameter over the URL's host.
  if (parsed.searchParams.has('host') || parsed.searchParams.has('hostaddr')) return false;
  return (
    (parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:') &&
    LOCAL_HOSTS.has(parsed.hostname)
  );
}

function isLocalApi(origin: string): boolean {
  if (!URL.canParse(origin)) return false;
  const parsed = new URL(origin);
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    LOCAL_HOSTS.has(parsed.hostname)
  );
}

/** Why the script will not run here, or null when it may. */
export function refusalOf(env: Env, apiOrigin: string): string | null {
  if (!DEVELOPMENT_MODES.has(env['NODE_ENV'] ?? '')) {
    return 'runs only where NODE_ENV is development or test';
  }
  if (!isLocalDatabase(env['DATABASE_URL'])) {
    return 'runs only against a database on this machine: the host of DATABASE_URL must be localhost, 127.0.0.1 or ::1';
  }
  if (!isLocalApi(apiOrigin)) {
    return 'runs only against an API on this machine: its origin must be http(s)://localhost, 127.0.0.1 or [::1]';
  }
  return null;
}

/** The stand-in's recipient event body (note under T117). */
export interface RecipientEventBody {
  readonly id: string;
  readonly type: 'recipient_verified' | 'recipient_rejected';
  readonly recipient: string;
  readonly reason?: string;
}

/** The event for `verdict` on `recipientRef`; its id the same whenever the three are. */
export function recipientEventBody(
  recipientRef: string,
  verdict: Verdict,
  reason?: string,
): RecipientEventBody {
  const digest = createHash('sha256')
    .update(JSON.stringify([recipientRef, verdict, reason ?? null]))
    .digest('hex');
  const id = `fake_evt_${digest.slice(0, 32)}`;
  return verdict === 'verified'
    ? { id, type: 'recipient_verified', recipient: recipientRef }
    : {
        id,
        type: 'recipient_rejected',
        recipient: recipientRef,
        ...(reason === undefined ? {} : { reason }),
      };
}

/** The body as sent and its signature, under the secret the API's stand-in verifies with. */
export function signedEvent(
  body: RecipientEventBody,
  config: Parameters<typeof standInWebhookSecret>[0],
): { readonly rawBody: Buffer; readonly headers: Readonly<Record<string, string>> } {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = createHmac('sha256', standInWebhookSecret(config))
    .update(rawBody)
    .digest('hex');
  return { rawBody, headers: { [SIGNATURE_HEADER]: signature } };
}

/** What the script reads the database through. */
export interface Connection {
  query<Row extends pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<Row>>;
  end(): Promise<void>;
}

export interface RunDependencies {
  readonly connect: (url: string) => Promise<Connection>;
  readonly fetch: typeof fetch;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** The teacher's recipient reference, or why there is none to report on. */
async function recipientRefOf(
  db: Connection,
  cipher: ColumnCipher,
  teacher: string,
): Promise<string | { readonly missing: string }> {
  const { rows } = await db.query<{ id: string; ref: Uint8Array | null }>(
    `SELECT id, payout_account_ref_encrypted AS ref
       FROM teacher_profiles
      WHERE user_id = $1 OR id = $1`,
    [teacher],
  );
  const row = rows[0];
  if (row === undefined) return { missing: 'no teacher profile has that id' };
  if (row.ref === null) return { missing: 'that teacher has not registered a payout account' };
  return cipher.decrypt(row.ref, PAYOUT_REF_COLUMN, row.id);
}

/** Sends the verdict; the process's exit code. */
export async function run(
  argv: readonly string[],
  env: Env,
  deps: RunDependencies,
): Promise<number> {
  const say = (line: string): void => deps.err(`emit-recipient-event: ${line}`);
  const parsed = parseArguments(argv);
  if (typeof parsed === 'string') {
    say(parsed);
    return 2;
  }
  const api = parsed.api ?? `http://localhost:${env['PORT'] || DEFAULT_PORT}`;
  const refusal = refusalOf(env, api);
  if (refusal !== null) {
    say(refusal);
    return 1;
  }
  const encryptionKey = env['ENCRYPTION_KEY'];
  if (encryptionKey === undefined || encryptionKey === '') {
    say('ENCRYPTION_KEY is not set (.env.example)');
    return 1;
  }
  const previousKey = env['ENCRYPTION_KEY_PREVIOUS'] || undefined;
  const cipher = new ColumnCipher(encryptionKey, previousKey);
  const db = await deps.connect(env['DATABASE_URL'] ?? '');
  let recipientRef: Awaited<ReturnType<typeof recipientRefOf>>;
  try {
    recipientRef = await recipientRefOf(db, cipher, parsed.teacher);
  } finally {
    await db.end().catch(() => undefined);
  }
  if (typeof recipientRef !== 'string') {
    say(recipientRef.missing);
    return 1;
  }
  const body = recipientEventBody(recipientRef, parsed.verdict, parsed.reason);
  const webhookSecret = env['PAYMENT_GATEWAY_WEBHOOK_SECRET'] || undefined;
  const { rawBody, headers } = signedEvent(body, {
    ENCRYPTION_KEY: encryptionKey,
    ...(webhookSecret === undefined ? {} : { PAYMENT_GATEWAY_WEBHOOK_SECRET: webhookSecret }),
  });
  const response = await deps.fetch(new URL(PAYMENT_WEBHOOK_PATH, api), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: new Uint8Array(rawBody),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MILLISECONDS),
  });
  await response.body?.cancel();
  const line = `${body.type} event ${body.id} for teacher ${parsed.teacher}: HTTP ${response.status}`;
  if (!response.ok) {
    say(line);
    return 1;
  }
  deps.out(`emit-recipient-event: ${line}`);
  return 0;
}

async function main(): Promise<number> {
  const fromDotenv: Record<string, string> = {};
  readDotenv({ processEnv: fromDotenv, quiet: true });
  return run(
    process.argv.slice(2),
    { ...fromDotenv, ...process.env },
    {
      connect: async (url) => {
        const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
        await db.connect();
        return db;
      },
      fetch,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
    },
  );
}

// Run as a command (tsx), never when a spec imports it; tsx compiles this file as CommonJS.
if (basename(process.argv[1] ?? '') === 'emit-recipient-event.ts') {
  void main().then((code) => {
    process.exitCode = code;
  });
}
