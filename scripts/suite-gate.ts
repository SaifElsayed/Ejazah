// T163: the suite gate of R-PROC-5 (research R-13).
//
//   pnpm check:suites --base <ref>
//
// R-PROC-5: never merge a gender or time change without its adversarial or DST tests updated. The
// per-path coverage floors (T086) hold the "unit tests" half; this gate holds the other. Against the
// base, every changed file is read (committed, uncommitted and untracked, as the migration check
// reads them), and for each suite in scripts/suite-gate.paths.ts a change under its guarded paths
// with no change under its tests is refused, naming R-PROC-5, the files and the tests expected.
// One suite never stands in for the other.
//
// WHAT "CHANGED" IS. `git diff --no-renames --name-only <base>` against the working tree, plus the
// untracked files. In CI the checkout is the pull request's merge commit, so the diff against the
// base branch is exactly the pull request's change.
//
// Exit 0 silently; 1 listing each refusal; 2 on a bad argument or a base git does not know, in
// which case nothing is judged.
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

import { IGNORED, SUITES } from './suite-gate.paths';

const repositoryRoot = join(__dirname, '..');

function patternToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern.charAt(index);
    if (char === '*' && pattern.charAt(index + 1) === '*') {
      // `**/` matches no segment or several; a trailing `**` matches the rest of the path.
      const slash = pattern.charAt(index + 2) === '/';
      source += slash ? '(?:.*/)?' : '.*';
      index += slash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** Whether `path` (repository-relative, forward slashes) matches any of `patterns`. */
export function matches(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => patternToRegExp(pattern).test(path));
}

/** Whether a change to `path` is one the patterns guard: never a spec, Markdown or a fixture. */
export function guards(path: string, patterns: readonly string[]): boolean {
  return !matches(path, IGNORED) && matches(path, patterns);
}

/** Every refusal for this list of changed files; none when it passes. */
export function judge(changed: readonly string[]): string[] {
  const refusals: string[] = [];
  for (const suite of SUITES) {
    const guarded = changed.filter((path) => guards(path, suite.changes));
    if (guarded.length === 0) continue;
    if (changed.some((path) => matches(path, suite.tests))) continue;
    refusals.push(
      `R-PROC-5: a ${suite.name} change with no change to ${suite.testsShown}: ${guarded.join(', ')}. Update those tests in the same change.`,
    );
  }
  return refusals;
}

export interface Streams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout;
}

function lines(text: string): string[] {
  return text.split('\0').filter((line) => line !== '');
}

/** The files changed against `base`, repository-relative. Throws when git does not know `base`. */
export function changedFiles(cwd: string, base: string): string[] {
  const known = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], {
    cwd,
    encoding: 'utf8',
  });
  if (known.status !== 0) throw new Error(`git does not know the base ${base}; fetch it first`);
  return [
    ...lines(git(cwd, ['diff', '--no-renames', '--name-only', '-z', base])),
    ...lines(git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])),
  ];
}

export function main(argv: readonly string[], cwd: string, streams: Streams): number {
  let base: string | undefined;
  try {
    ({
      values: { base },
    } = parseArgs({
      args: [...argv],
      options: { base: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error: unknown) {
    streams.err(`suite gate: ${error instanceof Error ? error.message : 'bad arguments'}\n`);
    return 2;
  }
  if (base === undefined || base === '') {
    streams.err('suite gate: --base <ref> is required\n');
    return 2;
  }
  let changed: string[];
  try {
    changed = changedFiles(cwd, base);
  } catch (error: unknown) {
    streams.err(
      `suite gate: ${error instanceof Error ? error.message : String(error)}; nothing was judged\n`,
    );
    return 2;
  }
  const refusals = judge(changed);
  for (const refusal of refusals) streams.err(`${refusal}\n`);
  return refusals.length === 0 ? 0 : 1;
}

// Run as a command (`pnpm check:suites`, tsx), never when a test imports this file. tsx compiles
// it as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'suite-gate.ts') {
  process.exitCode = main(process.argv.slice(2), repositoryRoot, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
