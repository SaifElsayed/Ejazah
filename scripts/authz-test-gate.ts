// T028: the authorization-test gate of R-MOBILE-13 (FR-210, research R-115).
//
//   pnpm check:authz
//
// R-MOBILE-13: never hide a forbidden action only in the UI and call it enforced; the server check
// must exist first. A diff of a screen cannot show that, so the gate checks the other side: every
// user-surface procedure that is not public — the actions a screen can reach — has tests under
// `apps/api/src/modules/**` that name the procedure's path and assert its kind's refusals
// (kernel.md "Caller kinds"): a `user` procedure refuses an anonymous caller (UNAUTHENTICATED); a
// `student` or `teacher` one refuses an anonymous caller and a caller of the other role
// (UNAUTHENTICATED and FORBIDDEN). A procedure without them is refused, naming R-MOBILE-13 and the
// path and the codes it lacks.
//
// WHAT IS READ. The committed contract snapshot (`packages/contracts/contract-snapshot.json`),
// whose user-surface entries carry each procedure's caller kind from its meta (T028); an entry with
// no caller kind is read as guarded, never as public. And the text of every `*.spec.ts` under
// `apps/api/src/modules/`, comments removed, cut into tests at each `it(` or `test(`: a test names a
// path when it holds it quoted (`'account.me'`, `"account.me"`, between backticks) or called
// (`.account.me(`), and a refusal counts for that path only inside a test that names it, so a path
// in a comment, or a refusal of another procedure in the same file, proves nothing (review of B7,
// finding 3). The administrator surface is not read: every one of its procedures is the
// administrator kind, and its refusals are the admin module's (T066).
//
// Exit 0 with a one-line count; 1 listing each refusal; 2 when the snapshot cannot be read.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const repositoryRoot = join(__dirname, '..');
const SNAPSHOT = join('packages', 'contracts', 'contract-snapshot.json');
const MODULES = join('apps', 'api', 'src', 'modules');

/** The refusals each guarded kind must prove (kernel.md "Caller kinds"); an unknown kind, all. */
export const REQUIRED_REFUSALS: Readonly<Record<string, readonly string[]>> = {
  user: ['UNAUTHENTICATED'],
  student: ['UNAUTHENTICATED', 'FORBIDDEN'],
  teacher: ['UNAUTHENTICATED', 'FORBIDDEN'],
};
const ALL_REFUSALS = ['UNAUTHENTICATED', 'FORBIDDEN'];

const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const TEST_START = /\b(?:it|test)(?:\.each\([^)]*\))?\s*\(/;

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

/** The tests of a spec: its text without comments, cut at each `it(` or `test(`. */
function testsOf(text: string): string[] {
  return text.replace(COMMENTS, '').split(TEST_START).slice(1);
}

/** The refusals a procedure must prove and has not, across every test that names it. */
export function missingRefusals(
  path: string,
  caller: string | undefined,
  specs: readonly ModuleSpec[],
): string[] {
  const required = REQUIRED_REFUSALS[caller ?? ''] ?? ALL_REFUSALS;
  const naming = specs.flatMap((spec) => testsOf(spec.text)).filter((test) => names(test, path));
  return required.filter((code) => !naming.some((test) => test.includes(code)));
}

/** The user-surface procedures that are not public and lack a refusal their kind must prove. */
export function findUntested(snapshot: SnapshotProcedures, specs: readonly ModuleSpec[]): string[] {
  return Object.entries(snapshot.app)
    .filter(([, procedure]) => procedure.caller !== 'public')
    .filter(([path, procedure]) => missingRefusals(path, procedure.caller, specs).length > 0)
    .map(([path]) => path)
    .sort();
}

/** The refusal a reviewer reads. */
export function describeUntested(paths: readonly string[]): string {
  return [
    ...paths.map(
      (path) =>
        `${path}: no test under ${MODULES.split('\\').join('/')} names it and asserts its kind's refusals (UNAUTHENTICATED; FORBIDDEN for a student or teacher procedure)`,
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
    `authorization-test gate: ${guarded} guarded procedures, each with its kind's refusals tested (R-MOBILE-13)\n`,
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
