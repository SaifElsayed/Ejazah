// T163 — the gates of R-PROC-5 (research R-13, SC-003).
//
// R-PROC-5: never merge a service change without unit tests, or a gender or time change without
// its adversarial or DST tests updated. Its mechanism is "per-path coverage floors plus suite
// gates". Two halves, each proven here by a case that must fail:
//   - the suite gate, `scripts/suite-gate.ts`: against the base, a change under the gender paths
//     with no change under the adversarial suite, or under the time paths with no change to the DST
//     specs of `packages/time`, fails naming R-PROC-5. The path lists live in
//     `scripts/suite-gate.paths.ts`.
//   - the coverage floor of `packages/config/vitest.base.ts` (T086): the real configuration, run
//     over a fixture below the floor under `tests/violations/fixtures/`, exits 1.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { guards, judge, main, matches } from '../../scripts/suite-gate';
import { GENDER, TIME } from '../../scripts/suite-gate.paths';

const root = join(__dirname, '..', '..');

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('which paths each suite guards (scripts/suite-gate.paths.ts)', () => {
  it.each([
    ['apps/api/src/platform/guards/requester-gender.ts', GENDER.changes],
    ['apps/api/src/modules/catalog/teacher-list.service.ts', GENDER.changes],
    ['packages/contracts/src/gender-filter.ts', GENDER.changes],
    ['packages/time/src/resolve.ts', TIME.changes],
  ])('a change to %s is guarded', (path, patterns) => {
    expect(guards(path, patterns)).toBe(true);
  });

  it.each([
    ['apps/api/src/modules/catalog/README.md', GENDER.changes],
    ['apps/api/src/modules/catalog/catalog.service.spec.ts', GENDER.changes],
    ['apps/api/src/modules/identity/identity.repository.ts', GENDER.changes],
    ['packages/time/src/resolve.spec.ts', TIME.changes],
    ['packages/time/README.md', TIME.changes],
    ['tests/violations/fixtures/packages/time/src/x.ts', TIME.changes],
    ['tests/violations/fixtures/apps/api/src/modules/catalog/catalog.service.ts', GENDER.changes],
  ])('a change to %s is not guarded', (path, patterns) => {
    expect(guards(path, patterns)).toBe(false);
  });

  it.each([
    ['tests/adversarial/gender.spec.ts', GENDER.tests],
    ['packages/time/src/resolve.spec.ts', TIME.tests],
  ])('%s counts as a test of its suite', (path, patterns) => {
    expect(matches(path, patterns)).toBe(true);
  });
});

describe('the suite gate over a list of changed files (T163)', () => {
  it('passes a change that touches neither suite', () => {
    expect(judge(['apps/api/src/jobs/queue.ts', 'docs/RUNBOOK.md'])).toEqual([]);
  });

  it('refuses a gender change with no adversarial change, naming R-PROC-5 and the files', () => {
    const refusals = judge(['apps/api/src/modules/catalog/teacher-list.service.ts']);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('R-PROC-5');
    expect(refusals[0]).toContain('apps/api/src/modules/catalog/teacher-list.service.ts');
    expect(refusals[0]).toContain('tests/adversarial/');
  });

  it('passes the same gender change once the adversarial suite changes with it', () => {
    expect(
      judge([
        'apps/api/src/modules/catalog/teacher-list.service.ts',
        'tests/adversarial/gender.spec.ts',
      ]),
    ).toEqual([]);
  });

  it('refuses a time change with no DST spec change', () => {
    const refusals = judge(['packages/time/src/resolve.ts']);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('R-PROC-5');
    expect(refusals[0]).toContain('packages/time/src/resolve.ts');
    expect(refusals[0]).toContain('DST');
  });

  it('passes a time change that updates a DST spec of packages/time', () => {
    expect(judge(['packages/time/src/resolve.ts', 'packages/time/src/resolve.spec.ts'])).toEqual(
      [],
    );
  });

  it('refuses both at once, each in its own line', () => {
    expect(
      judge(['packages/time/src/index.ts', 'apps/api/src/platform/guards/requester-gender.ts']),
    ).toHaveLength(2);
  });

  it('does not let one suite stand in for the other', () => {
    expect(judge(['packages/time/src/index.ts', 'tests/adversarial/gender.spec.ts'])).toHaveLength(
      1,
    );
  });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=T163', '-c', 'user.email=t163@example.invalid', ...args],
    { cwd, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function write(cwd: string, path: string, text: string): void {
  const file = join(cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function repository(): { cwd: string; base: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'ijazah-suite-gate-'));
  directories.push(cwd);
  git(cwd, 'init', '--quiet');
  write(cwd, 'packages/time/src/resolve.ts', 'export {};\n');
  write(cwd, 'packages/time/src/resolve.spec.ts', 'export {};\n');
  write(cwd, 'README.md', 'base\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '--quiet', '--message', 'base');
  return { cwd, base: git(cwd, 'rev-parse', 'HEAD') };
}

function run(cwd: string, argv: readonly string[]) {
  const err: string[] = [];
  const code = main(argv, cwd, { out: () => undefined, err: (text) => err.push(text) });
  return { code, err: err.join('') };
}

describe('the suite gate against a base, through git (T163)', () => {
  it('reads committed, uncommitted and untracked changes against the base', () => {
    const { cwd, base } = repository();
    write(cwd, 'packages/time/src/resolve.ts', 'export const changed = true;\n');
    expect(run(cwd, ['--base', base]).code).toBe(1);

    write(cwd, 'packages/time/src/resolve.spec.ts', 'export const updated = true;\n');
    expect(run(cwd, ['--base', base]).code).toBe(0);
  });

  it('counts a new, untracked time file', () => {
    const { cwd, base } = repository();
    write(cwd, 'packages/time/src/recurrence.ts', 'export {};\n');
    const result = run(cwd, ['--base', base]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('packages/time/src/recurrence.ts');
  });

  it('passes silently when nothing in either suite changed', () => {
    const { cwd, base } = repository();
    write(cwd, 'README.md', 'changed\n');
    expect(run(cwd, ['--base', base])).toEqual({ code: 0, err: '' });
  });

  it.each([[[]], [['--base']], [['--base', '']], [['--unknown']], [['positional']]])(
    'stops with exit 2 on the arguments %j',
    (argv) => {
      expect(run(repository().cwd, argv).code).toBe(2);
    },
  );

  it('stops with exit 2 on a base git does not know, judging nothing', () => {
    const result = run(repository().cwd, ['--base', 'no-such-ref']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('no-such-ref');
    expect(result.err).not.toContain('R-PROC-5:');
  });
});

describe('the coverage floor refuses a covered path below 80% (T163, T086)', () => {
  it('fails the real configuration over a fixture below the floor, with its tests passing', () => {
    // The fixtures folder is the run's root, so the configuration's own globs
    // (`packages/money/src/**`) land on the fixture's mirror of that path. The report is written to
    // a throwaway folder, and Vite's cache folder, which the run creates under its root, is removed
    // unless it was already there.
    const fixtures = join(root, 'tests', 'violations', 'fixtures');
    const cache = join(fixtures, 'node_modules');
    const cacheExisted = existsSync(cache);
    const reports = mkdtempSync(join(tmpdir(), 'ijazah-coverage-floor-'));
    directories.push(reports);
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--coverage',
        '--coverage.reportsDirectory',
        reports,
        '--config',
        join(root, 'packages', 'config', 'vitest.base.ts'),
        '--root',
        fixtures,
        'packages/money/src/under-floor.spec.ts',
      ],
      { cwd: root, encoding: 'utf8', timeout: 120_000 },
    );
    if (!cacheExisted) rmSync(cache, { recursive: true, force: true });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, output).toBe(1);
    expect(output).toMatch(/Tests\s+1 passed/);
    expect(output).toMatch(/does not meet "packages\/money\/src\/\*\*" threshold \(80%\)/);
  }, 150_000);
});
