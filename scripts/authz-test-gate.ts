// T028: the authorization-test gate of R-MOBILE-13 (FR-210, research R-115).
//
//   pnpm check:authz
//
// R-MOBILE-13: never hide a forbidden action only in the UI and call it enforced; the server check
// must exist first. A diff of a screen cannot show that, so the gate checks the other side: every
// user-surface procedure that is not public — the actions a screen can reach — has a spec under
// `apps/api/src/modules/**` that names the procedure's path and asserts a refusal of the wrong
// caller (`UNAUTHENTICATED`, `FORBIDDEN` or `ACCOUNT_RESTRICTED`). A procedure with no such spec is
// refused, naming R-MOBILE-13 and the path.
//
// WHAT IS READ. The committed contract snapshot (`packages/contracts/contract-snapshot.json`),
// whose user-surface entries carry each procedure's caller kind from its meta (T028); an entry with
// no caller kind is read as guarded, never as public. And the text of every `*.spec.ts` under
// `apps/api/src/modules/`. A spec names a path when the text holds it quoted (`'account.me'`,
// `"account.me"`, or between backticks) or called (`.account.me(`); it asserts a refusal when the
// same file holds one of the three codes. The administrator surface is not read: every one of its
// procedures is the administrator kind, and its refusals are the admin module's (T066).
//
// Exit 0 with a one-line count; 1 listing each refusal; 2 when the snapshot cannot be read.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const repositoryRoot = join(__dirname, '..');
const SNAPSHOT = join('packages', 'contracts', 'contract-snapshot.json');
const MODULES = join('apps', 'api', 'src', 'modules');

/** The codes a caller kind refuses with (kernel.md "Caller kinds"). */
export const REFUSAL_CODES = ['UNAUTHENTICATED', 'FORBIDDEN', 'ACCOUNT_RESTRICTED'] as const;

/** A procedure entry as this gate reads it from the snapshot. */
export interface SnapshotProcedure {
  readonly caller?: string;
  readonly kind: string;
}

export interface SnapshotProcedures {
  readonly admin: Readonly<Record<string, SnapshotProcedure>>;
  readonly app: Readonly<Record<string, SnapshotProcedure>>;
}

export interface ModuleSpec {
  readonly path: string;
  readonly text: string;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `text` names the procedure `path`, quoted or called. */
function names(text: string, path: string): boolean {
  const quoted = new RegExp(`['"\`]${escaped(path)}['"\`]`);
  const called = new RegExp(`\\.${escaped(path)}\\s*\\(`);
  return quoted.test(text) || called.test(text);
}

const assertsRefusal = (text: string) => REFUSAL_CODES.some((code) => text.includes(code));

/** The user-surface procedures that are not public and that no module spec names with a refusal. */
export function findUntested(snapshot: SnapshotProcedures, specs: readonly ModuleSpec[]): string[] {
  return Object.entries(snapshot.app)
    .filter(([, procedure]) => procedure.caller !== 'public')
    .map(([path]) => path)
    .filter((path) => !specs.some((spec) => names(spec.text, path) && assertsRefusal(spec.text)))
    .sort();
}

/** The refusal a reviewer reads. */
export function describeUntested(paths: readonly string[]): string {
  return [
    ...paths.map(
      (path) =>
        `${path}: no spec under ${MODULES.split('\\').join('/')} names it and asserts a refusal (${REFUSAL_CODES.join(', ')})`,
    ),
    'R-MOBILE-13: hiding an action in the UI is not authorization; the server test must exist first',
  ].join('\n');
}

/** Every `*.spec.ts` under the modules, with its text. */
function moduleSpecs(root: string): ModuleSpec[] {
  const found: ModuleSpec[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.spec.ts')) {
        found.push({ path: relative(root, full), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(join(root, MODULES));
  return found;
}

function snapshotOf(root: string): SnapshotProcedures {
  const document = JSON.parse(readFileSync(join(root, SNAPSHOT), 'utf8')) as {
    procedures?: Partial<SnapshotProcedures>;
  };
  const procedures = document.procedures;
  if (procedures?.app === undefined || procedures.admin === undefined) {
    throw new Error(`${SNAPSHOT} holds no procedures`);
  }
  return { admin: procedures.admin, app: procedures.app };
}

export function main(
  _argv: readonly string[],
  streams: { out(text: string): void; err(text: string): void },
  root: string = repositoryRoot,
): number {
  let snapshot: SnapshotProcedures;
  try {
    snapshot = snapshotOf(root);
  } catch (error: unknown) {
    streams.err(
      `authorization-test gate: ${error instanceof Error ? error.message : String(error)}; nothing was judged\n`,
    );
    return 2;
  }
  const untested = findUntested(snapshot, moduleSpecs(root));
  if (untested.length > 0) {
    streams.err(`${describeUntested(untested)}\n`);
    return 1;
  }
  const guarded = Object.values(snapshot.app).filter((p) => p.caller !== 'public').length;
  streams.out(
    `authorization-test gate: ${guarded} guarded procedures, each with a refusal spec (R-MOBILE-13)\n`,
  );
  return 0;
}

// Run as a command (`pnpm check:authz`, tsx), never when a test imports this file. tsx compiles it
// as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'authz-test-gate.ts') {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
