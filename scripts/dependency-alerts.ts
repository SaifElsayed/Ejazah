// T160: the dependency-alerts gate (FR-060, R-SEC-12): no merge while a critical dependency
// alert is open. The logic the `dependency-alerts` job held in inline bash since T090 and T158,
// moved here so a spec can prove each refusal (tests/pipeline/dependency-alerts.spec.ts).
//
//   node scripts/dependency-alerts.ts      (CI; needs DEPENDABOT_ALERTS_TOKEN and GITHUB_REPOSITORY)
//
// Two readings of the same advisory data, each failing closed, both always run so a run reports
// every problem at once:
//   1. `pnpm audit --audit-level critical` over pnpm-lock.yaml. A non-zero exit is a critical
//      advisory or an audit that could not run, and both block.
//   2. The repository's open critical Dependabot alerts, through the REST API. `GITHUB_TOKEN`
//      cannot read them, so a fine-grained token with "Dependabot alerts: read" is stored as
//      DEPENDABOT_ALERTS_TOKEN (note under T090). An empty token, an unknown repository, any
//      answer other than a 2xx list, a request that fails, or a next page that never arrives is
//      never read as zero alerts. REST only: the GraphQL field answers zero without the permission.
// Then T158's warning: every answer to the token carries its expiry date in the
// GitHub-Authentication-Token-Expiration header; from fourteen days before it, the run warns, and
// it never fails on that, because an expired token already fails closed above.
//
// Output is GitHub's workflow commands (`::error::`, `::warning::`), each naming R-SEC-12; the
// token is never printed. Exit 1 on any refusal, 0 otherwise.
//
// Run by Node itself with its type stripping (Node 24, .nvmrc), so the job installs nothing before
// auditing the lockfile: only `node:` modules are imported and no TypeScript-only syntax is used.
import { spawn } from 'node:child_process';
import { basename } from 'node:path';

/** The audit, as a program and its arguments. */
export const AUDIT_COMMAND = ['pnpm', ['audit', '--audit-level', 'critical']] as const;

/** The first page of the repository's open critical Dependabot alerts. */
export const ALERTS_URL = (repository: string): string =>
  `https://api.github.com/repos/${repository}/dependabot/alerts?state=open&severity=critical&per_page=100`;

const WARN_DAYS = 14;
const DAY_MS = 86_400_000;
/** A runaway pagination guard; 100 pages of 100 alerts is far beyond any real repository. */
const MAX_PAGES = 100;

/** One answer from GitHub: its status, a header by name (case-insensitive), and its JSON body. */
export interface Answer {
  readonly status: number;
  readonly header: (name: string) => string | undefined;
  readonly body: unknown;
}

export interface Dependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Runs the audit, its own output going straight to the log; resolves to its exit code. */
  readonly audit: () => Promise<number>;
  /** One GET with the token; rejects when no answer arrives. */
  readonly request: (url: string, token: string) => Promise<Answer>;
  readonly now: () => Date;
}

export interface Streams {
  readonly out: (text: string) => void;
}

interface Alert {
  readonly package: string;
  readonly advisory: string;
  readonly url: string;
}

function field(value: unknown, ...path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    current =
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[key]
        : undefined;
  }
  return typeof current === 'string' ? current : '?';
}

function nextLink(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/** The expiry header as a time, accepting `YYYY-MM-DD HH:MM:SS` then `UTC` or a `±HHMM` offset. */
export function parseExpiry(text: string): Date | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*(UTC|Z|[+-]\d{2}:?\d{2}))?$/.exec(
    text.trim(),
  );
  if (match === null) return undefined;
  const [, date, time, zone] = match;
  const offset =
    zone === undefined || zone === 'UTC' || zone === 'Z'
      ? 'Z'
      : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  // eslint-disable-next-line ijazah/time/no-datetime-outside-package -- T160: the gate runs before any install, so packages/time cannot load; an instant parsed from a fixed UTC or offset form, no wall clock
  const parsed = new Date(`${date}T${time}${offset}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

type AlertsReading =
  | { readonly ok: true; readonly alerts: readonly Alert[]; readonly first: Answer }
  | { readonly ok: false; readonly reason: string; readonly first: Answer | undefined };

async function readAlerts(
  repository: string,
  token: string,
  request: Dependencies['request'],
): Promise<AlertsReading> {
  const alerts: Alert[] = [];
  let first: Answer | undefined;
  let url: string | undefined = ALERTS_URL(repository);
  for (let pages = 0; url !== undefined; pages += 1) {
    if (pages === MAX_PAGES) return { ok: false, reason: `more than ${MAX_PAGES} pages`, first };
    let answer: Answer;
    try {
      answer = await request(url, token);
    } catch {
      return { ok: false, reason: 'answered with no page', first };
    }
    first ??= answer;
    if (answer.status < 200 || answer.status > 299) {
      return { ok: false, reason: `answered ${answer.status}`, first };
    }
    if (!Array.isArray(answer.body)) {
      return { ok: false, reason: 'answered with something that is not a list of alerts', first };
    }
    for (const item of answer.body) {
      alerts.push({
        package: field(item, 'dependency', 'package', 'name'),
        advisory: field(item, 'security_advisory', 'ghsa_id'),
        url: field(item, 'html_url'),
      });
    }
    url = nextLink(answer.header('link'));
  }
  return first === undefined
    ? { ok: false, reason: 'answered with no page', first }
    : { ok: true, alerts, first };
}

export async function main(dependencies: Dependencies, streams: Streams): Promise<number> {
  const say = (line: string): void => streams.out(`${line}\n`);
  let refused = false;

  if ((await dependencies.audit()) !== 0) {
    say(
      '::error::R-SEC-12: pnpm audit found a critical advisory in pnpm-lock.yaml (listed above), or could not read the advisory database; the merge is blocked until it is fixed',
    );
    refused = true;
  }

  const token = dependencies.env['DEPENDABOT_ALERTS_TOKEN'] ?? '';
  const repository = dependencies.env['GITHUB_REPOSITORY'] ?? '';
  if (token === '') {
    say(
      '::error::R-SEC-12: the secret DEPENDABOT_ALERTS_TOKEN is empty or not available to this run, so open Dependabot alerts cannot be read; the merge is blocked (fail closed)',
    );
    return 1;
  }
  if (repository === '') {
    say(
      '::error::R-SEC-12: GITHUB_REPOSITORY is not set, so open Dependabot alerts cannot be read; the merge is blocked (fail closed)',
    );
    return 1;
  }

  const reading = await readAlerts(repository, token, dependencies.request);
  if (!reading.ok) {
    say(
      `::error::R-SEC-12: the Dependabot alerts API ${reading.reason}; no count can be trusted, so the merge is blocked (fail closed)`,
    );
    refused = true;
  } else {
    for (const alert of reading.alerts) {
      say(
        `::error::R-SEC-12: open critical Dependabot alert: ${alert.package} ${alert.advisory} ${alert.url}`,
      );
    }
    if (reading.alerts.length > 0) {
      say(
        `R-SEC-12: ${reading.alerts.length} open critical Dependabot alert(s); the merge is blocked until each is fixed or dismissed`,
      );
      refused = true;
    } else {
      say('R-SEC-12: no open critical Dependabot alert');
    }
  }

  // T158: warn, never fail.
  const header = reading.first?.header('github-authentication-token-expiration');
  if (header === undefined || header === '') {
    say(
      "::warning::R-SEC-12: GitHub returned no expiry date for DEPENDABOT_ALERTS_TOKEN; check it in the repository owner's fine-grained tokens",
    );
  } else {
    const expiry = parseExpiry(header);
    if (expiry === undefined) {
      say(
        `::warning::R-SEC-12: the expiry date of DEPENDABOT_ALERTS_TOKEN could not be read: ${header}`,
      );
    } else {
      // eslint-disable-next-line ijazah/time/no-datetime-outside-package -- T160: the gate runs before any install, so packages/time cannot load; whole days between two UTC instants for a warning, no wall clock
      const daysLeft = Math.floor((expiry.getTime() - dependencies.now().getTime()) / DAY_MS);
      say(
        daysLeft < WARN_DAYS
          ? `::warning::R-SEC-12: DEPENDABOT_ALERTS_TOKEN expires on ${header} (${daysLeft} days left); renew it (docs/RUNBOOK.md, GitHub tokens) before the dependency-alerts job fails closed`
          : `DEPENDABOT_ALERTS_TOKEN expires on ${header} (${daysLeft} days left)`,
      );
    }
  }

  return refused ? 1 : 0;
}

/** The real audit: the pnpm shim needs a shell on Windows; the arguments are fixed. */
function runAudit(): Promise<number> {
  const [program, args] = AUDIT_COMMAND;
  return new Promise((resolve) => {
    const child = spawn(program, [...args], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function request(url: string, token: string): Promise<Answer> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return {
    status: response.status,
    header: (name) => response.headers.get(name) ?? undefined,
    body,
  };
}

if (basename(process.argv[1] ?? '') === 'dependency-alerts.ts') {
  void main(
    { env: process.env, audit: runAudit, request, now: () => new Date() },
    { out: (text) => process.stdout.write(text) },
  ).then((code) => {
    process.exitCode = code;
  });
}
