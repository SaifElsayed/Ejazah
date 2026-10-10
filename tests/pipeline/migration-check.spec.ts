// T071 — migration checksum verification against the base branch (FR-037, R-DB-1).
//
// A merged migration is never edited: a mistake is fixed forward by a new migration. A fresh CI
// database has applied nothing, so Prisma's own checksum has nothing to compare with there; the
// pipeline compares the change with its base instead, as the contract snapshot does (owner's
// decision, 2026-10-10). Every migration folder, and `migration_lock.toml`, present on the base
// must be byte for byte the same in the head; a new folder must sort after the base's last one,
// because Prisma applies folders in name order and a database that already applied the base's
// last migration would apply an older-named one out of order. A refusal names R-DB-1.
//
// Each case builds a throwaway repository: the base is a commit, and the head is that repository's
// working tree, committed or not, which is how the pipeline's checkout and a developer's tree are
// both read.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkMigrations, main } from '../../scripts/migration-check';

const INIT = '20261007000000_init';
const ROLES = '20261007000100_roles_and_privileges';
const LATER = '20261011000000_add_settings_index';
const EARLIER = '20261007000050_forgotten_index';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=T071', '-c', 'user.email=t071@example.invalid', ...args],
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

/** A repository whose base commit holds two merged migrations, the lock file and a README. */
function repositoryWithHistory(): { cwd: string; base: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'ijazah-migrations-'));
  directories.push(cwd);
  git(cwd, 'init', '--quiet');
  write(cwd, `prisma/migrations/${INIT}/migration.sql`, 'CREATE TABLE users ();\n');
  write(cwd, `prisma/migrations/${ROLES}/migration.sql`, 'CREATE ROLE ijazah_app;\n');
  write(cwd, 'prisma/migrations/migration_lock.toml', 'provider = "postgresql"\n');
  write(cwd, 'prisma/migrations/README.md', '# migrations\n');
  write(cwd, 'README.md', 'base\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '--quiet', '--message', 'base');
  return { cwd, base: git(cwd, 'rev-parse', 'HEAD') };
}

function problemsOf(cwd: string, base: string): string[] {
  return checkMigrations({ cwd, base });
}

describe('a history the head leaves as the base merged it passes', () => {
  it('passes the unchanged history', () => {
    const { cwd, base } = repositoryWithHistory();
    expect(problemsOf(cwd, base)).toEqual([]);
  });

  it('passes a new migration that sorts after the base’s last one, silently', () => {
    const { cwd, base } = repositoryWithHistory();
    write(cwd, `prisma/migrations/${LATER}/migration.sql`, 'CREATE INDEX x ON users (id);\n');
    expect(problemsOf(cwd, base)).toEqual([]);
    git(cwd, 'add', '.');
    git(cwd, 'commit', '--quiet', '--message', 'head');
    expect(problemsOf(cwd, base)).toEqual([]);
  });

  it('passes a change outside the migration folders, such as the README beside them', () => {
    const { cwd, base } = repositoryWithHistory();
    write(cwd, 'prisma/migrations/README.md', '# migrations\n\nRewritten.\n');
    write(cwd, 'README.md', 'head\n');
    expect(problemsOf(cwd, base)).toEqual([]);
  });

  it('passes when the base holds no migration yet', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ijazah-migrations-'));
    directories.push(cwd);
    git(cwd, 'init', '--quiet');
    write(cwd, 'README.md', 'base\n');
    git(cwd, 'add', '.');
    git(cwd, 'commit', '--quiet', '--message', 'base');
    const base = git(cwd, 'rev-parse', 'HEAD');
    write(cwd, `prisma/migrations/${INIT}/migration.sql`, 'CREATE TABLE users ();\n');
    expect(problemsOf(cwd, base)).toEqual([]);
  });
});

describe('a merged migration that changes fails, naming R-DB-1 (FR-037)', () => {
  it('fails an edited migration, committed or not', () => {
    const { cwd, base } = repositoryWithHistory();
    write(cwd, `prisma/migrations/${INIT}/migration.sql`, 'CREATE TABLE users (id uuid);\n');
    const uncommitted = problemsOf(cwd, base);
    expect(uncommitted).toHaveLength(1);
    expect(uncommitted[0]).toContain('R-DB-1');
    expect(uncommitted[0]).toContain(`prisma/migrations/${INIT}/migration.sql`);
    git(cwd, 'commit', '--quiet', '--all', '--message', 'head');
    expect(problemsOf(cwd, base)).toEqual(uncommitted);
  });

  it('fails a deleted migration', () => {
    const { cwd, base } = repositoryWithHistory();
    rmSync(join(cwd, 'prisma', 'migrations', ROLES), { recursive: true });
    const problems = problemsOf(cwd, base);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('R-DB-1');
    expect(problems[0]).toContain(`prisma/migrations/${ROLES}/migration.sql`);
    expect(problems[0]).toContain('deleted or renamed');
  });

  it('fails a renamed migration as the removal of its old name', () => {
    const { cwd, base } = repositoryWithHistory();
    renameSync(join(cwd, 'prisma', 'migrations', ROLES), join(cwd, 'prisma', 'migrations', LATER));
    git(cwd, 'add', '--all');
    git(cwd, 'commit', '--quiet', '--message', 'head');
    const problems = problemsOf(cwd, base);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`prisma/migrations/${ROLES}/migration.sql`);
    expect(problems[0]).toContain('deleted or renamed');
  });

  it('fails a file added to a merged migration, committed or not', () => {
    const { cwd, base } = repositoryWithHistory();
    write(cwd, `prisma/migrations/${INIT}/extra.sql`, 'DROP TABLE users;\n');
    const problems = problemsOf(cwd, base);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('R-DB-1');
    expect(problems[0]).toContain(`prisma/migrations/${INIT}/extra.sql`);
    git(cwd, 'add', '.');
    git(cwd, 'commit', '--quiet', '--message', 'head');
    expect(problemsOf(cwd, base)).toEqual(problems);
  });

  it('fails a changed or deleted migration_lock.toml, which every merged migration was written for', () => {
    const { cwd, base } = repositoryWithHistory();
    write(cwd, 'prisma/migrations/migration_lock.toml', 'provider = "mysql"\n');
    const changed = problemsOf(cwd, base);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain('R-DB-1');
    expect(changed[0]).toContain('prisma/migrations/migration_lock.toml');
    rmSync(join(cwd, 'prisma', 'migrations', 'migration_lock.toml'));
    expect(problemsOf(cwd, base)[0]).toContain('prisma/migrations/migration_lock.toml');
  });

  it('lists every problem at once', () => {
    const { cwd, base } = repositoryWithHistory();
    write(cwd, `prisma/migrations/${INIT}/migration.sql`, 'CREATE TABLE users (id uuid);\n');
    rmSync(join(cwd, 'prisma', 'migrations', ROLES), { recursive: true });
    write(cwd, `prisma/migrations/${EARLIER}/migration.sql`, 'CREATE INDEX y ON users (id);\n');
    expect(problemsOf(cwd, base)).toHaveLength(3);
  });
});

describe('a new migration that sorts before the base’s last one fails (R-DB-1)', () => {
  it('fails it, naming both folders, committed or not', () => {
    const { cwd, base } = repositoryWithHistory();
    write(cwd, `prisma/migrations/${EARLIER}/migration.sql`, 'CREATE INDEX y ON users (id);\n');
    const problems = problemsOf(cwd, base);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('R-DB-1');
    expect(problems[0]).toContain(EARLIER);
    expect(problems[0]).toContain(ROLES);
    expect(problems[0]).toContain('out of order');
    git(cwd, 'add', '.');
    git(cwd, 'commit', '--quiet', '--message', 'head');
    expect(problemsOf(cwd, base)).toEqual(problems);
  });
});

describe('the base is read through git', () => {
  it('refuses a base git does not know', () => {
    const { cwd } = repositoryWithHistory();
    expect(() => problemsOf(cwd, 'no-such-branch')).toThrow(/no-such-branch/);
  });
});

describe('the command', () => {
  const output = { out: '', err: '' };
  const streams = {
    out: (text: string) => {
      output.out += text;
    },
    err: (text: string) => {
      output.err += text;
    },
  };
  afterEach(() => {
    output.out = '';
    output.err = '';
  });

  it('exits 0 on a clean history and 1 on a broken one, naming R-DB-1', () => {
    const { cwd, base } = repositoryWithHistory();
    expect(main(['--base', base], cwd, streams)).toBe(0);
    expect(output.out).toContain('R-DB-1');
    writeFileSync(join(cwd, 'prisma', 'migrations', INIT, 'migration.sql'), 'edited\n');
    expect(main(['--base', base], cwd, streams)).toBe(1);
    expect(output.err).toContain('R-DB-1');
    expect(output.err).toContain(`prisma/migrations/${INIT}/migration.sql`);
  });

  it('exits 2 without --base, on an unknown option and on a ref git does not know', () => {
    const { cwd } = repositoryWithHistory();
    expect(main([], cwd, streams)).toBe(2);
    expect(main(['--base', 'HEAD', '--check'], cwd, streams)).toBe(2);
    expect(main(['--base', 'no-such-branch'], cwd, streams)).toBe(2);
    expect(output.err).toContain('no-such-branch');
  });
});
