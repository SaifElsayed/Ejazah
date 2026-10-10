// T091: the branch-to-spec-directory check (FR-061, R-PROC-1, ADR 0005 D9). No spec folder, no
// branch: work happens on a branch named for the spec it implements, and reaches `develop` by pull
// request.
//
//   pnpm check:branch
//
// THE RULE (owner's decision 7, 2026-10-10). A task branch is named `Ejazah_app/<phase>/<task ids>`:
// `<phase>` is the name of an existing `specs/NNN-*` folder, and `<task ids>` is one task id
// (`T001`) or several joined by `-` (a range, `T001-T005`, and a batch list,
// `T079-T084-T085-T144-T086-T091`, have the same shape), with no descriptive suffix. It targets
// `develop`. `develop` and `main` are exempt as head branches: the integration branch and the
// release branch (`develop` reaches `main` by release pull request).
//
// WHERE THE NAMES COME FROM. In a pull_request run, GitHub sets the head in GITHUB_HEAD_REF and the
// target in GITHUB_BASE_REF. In a push run both are empty and the pushed branch is GITHUB_REF_NAME;
// the pipeline runs on push for `develop` and `main` only, so a push run passes. Outside GitHub, the
// current git branch is checked, with no target.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const repositoryRoot = join(__dirname, '..');

const EXEMPT = new Set(['develop', 'main']);
const TARGET = 'develop';
const TASK_BRANCH = /^Ejazah_app\/([^/]+)\/(T\d{3,}(?:-T\d{3,})*)$/;
const EXPECTED =
  'Ejazah_app/<phase>/<task ids>, where <phase> is a specs/NNN-* folder and <task ids> is one task id or several joined by "-", with nothing after them (Ejazah_app/001-foundations/T001, Ejazah_app/001-foundations/T001-T005)';

/** The phases a branch may name: the `specs/NNN-*` folders. */
export function specPhases(root: string): string[] {
  return readdirSync(join(root, 'specs'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** The branch being checked and, in a pull request, the branch it targets. */
export function branchFromEnvironment(environment: Readonly<Record<string, string | undefined>>): {
  head: string | undefined;
  base: string | undefined;
} {
  const head = environment['GITHUB_HEAD_REF'];
  if (head !== undefined && head !== '') {
    const base = environment['GITHUB_BASE_REF'];
    return { head, base: base === '' ? undefined : base };
  }
  const pushed = environment['GITHUB_REF_NAME'];
  return { head: pushed === '' ? undefined : pushed, base: undefined };
}

/** Every way the branch breaks R-PROC-1; none when it passes. */
export function checkBranch(options: {
  readonly head: string;
  readonly base: string | undefined;
  readonly phases: readonly string[];
}): string[] {
  const { head, base, phases } = options;
  if (EXEMPT.has(head)) return [];
  const problems: string[] = [];
  const named = TASK_BRANCH.exec(head);
  if (named === null) {
    problems.push(`R-PROC-1: the branch "${head}" is not named ${EXPECTED}.`);
  } else if (!phases.includes(named[1] ?? '')) {
    problems.push(
      `R-PROC-1: the branch "${head}" names the phase "${named[1] ?? ''}", which has no folder under specs/ (${phases.join(', ') || 'none'}); no spec folder, no branch. Expected ${EXPECTED}.`,
    );
  }
  if (base !== undefined && base !== TARGET) {
    problems.push(
      `R-PROC-1: the pull request from "${head}" targets "${base}"; a task branch merges into ${TARGET}, and ${TARGET} reaches main by release pull request.`,
    );
  }
  return problems;
}

function currentGitBranch(): string | undefined {
  const result = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function main(): number {
  const { head, base } = branchFromEnvironment(process.env);
  const branch = head ?? currentGitBranch();
  if (branch === undefined) {
    process.stderr.write(`R-PROC-1: no branch to check (a detached HEAD); expected ${EXPECTED}.\n`);
    return 1;
  }
  const problems = checkBranch({ head: branch, base, phases: specPhases(repositoryRoot) });
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length === 0) {
    const target = base === undefined ? '' : ` targeting ${base}`;
    process.stdout.write(`branch check: "${branch}"${target} follows R-PROC-1\n`);
  }
  return problems.length === 0 ? 0 : 1;
}

// Run as a command (`pnpm check:branch`, tsx), never when a test imports this file. tsx compiles it
// as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'branch-spec-check.ts') {
  process.exitCode = main();
}
