// T071: migration checksum verification (FR-037, R-DB-1). A merged migration is never edited; a
// mistake is fixed forward by a new migration.
//
//   pnpm check:migrations --base <ref>
//
// WHY AGAINST THE BASE (owner's decision, 2026-10-10). Prisma keeps a checksum of every migration it
// applied and warns when the file changes afterwards, but only on a database that applied it; the
// pipeline's database is created empty for each run, so that checksum has nothing to compare with.
// The check therefore compares the change with the branch it targets, the pattern of the contract
// snapshot (T084): every file the base holds under a migration folder, and
// `prisma/migrations/migration_lock.toml`, must be byte for byte the same in the head.
//
// WHAT FAILS, each line naming R-DB-1:
//   a file of a merged migration folder changed, deleted, or renamed (a rename is the deletion of
//   the old name), or a file added to a merged folder;
//   `migration_lock.toml` changed or deleted: it records the provider every merged migration was
//   written for;
//   a new migration folder that does not sort after the base's last one. Prisma applies folders in
//   name order, so on a database that already applied the base's last migration an older-named one
//   would be applied out of order.
// A new folder that sorts last passes silently. Any other file directly under `prisma/migrations/`
// (its README) is documentation, not history, and is not read.
//
// WHAT "THE HEAD" IS. The working tree, read through git: `git diff --no-renames <base>` for the
// files git tracks, which compares content through git's own filters (so a checkout's line endings
// never read as an edit), plus the untracked files git does not ignore. In the pipeline the working
// tree is the commit under test; on a developer's machine an edit is seen before it is committed.
//
// Exit 0 when the history is intact, 1 on any violation, 2 on a bad argument or a ref git does not
// know (fetch the base first; the pipeline's checkout holds one commit).
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

const repositoryRoot = join(__dirname, '..');

const MIGRATIONS = 'prisma/migrations/';
const LOCK_FILE = 'migration_lock.toml';
const FIX_FORWARD = 'a merged migration is never edited; fix forward with a new migration.';

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`migration check: git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** The NUL-separated fields of a `-z` listing. */
function fields(output: string): string[] {
  return output.split('\0').filter((field) => field !== '');
}

/** The part of a path under `prisma/migrations/`: its folder (none for a top-level file) and the rest. */
function locate(path: string): { folder: string | undefined; name: string } {
  const inside = path.slice(MIGRATIONS.length);
  const slash = inside.indexOf('/');
  return slash === -1
    ? { folder: undefined, name: inside }
    : { folder: inside.slice(0, slash), name: inside.slice(slash + 1) };
}

/**
 * Every way the head breaks R-DB-1 against `base`; none when it passes. Throws when git does not
 * know `base`.
 */
export function checkMigrations(options: {
  readonly cwd: string;
  readonly base: string;
}): string[] {
  const { cwd, base } = options;
  const known = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], {
    cwd,
    encoding: 'utf8',
  });
  if (known.status !== 0) {
    throw new Error(
      `migration check: git does not know the base ${base}; fetch it before comparing`,
    );
  }

  const baseFolders = new Set<string>();
  for (const path of fields(
    git(cwd, ['ls-tree', '-r', '-z', '--name-only', base, '--', MIGRATIONS]),
  )) {
    const { folder } = locate(path);
    if (folder !== undefined) baseFolders.add(folder);
  }
  const lastBaseFolder = [...baseFolders].sort().at(-1);

  // Status and path pairs from the diff, then every untracked file as an addition.
  const diff = fields(
    git(cwd, ['diff', '--no-renames', '--name-status', '-z', base, '--', MIGRATIONS]),
  );
  const changes: { status: string; path: string }[] = [];
  for (let index = 0; index + 1 < diff.length; index += 2) {
    changes.push({ status: diff[index] ?? '', path: diff[index + 1] ?? '' });
  }
  for (const path of fields(
    git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', MIGRATIONS]),
  )) {
    changes.push({ status: 'A', path });
  }

  const problems: string[] = [];
  const newFolders = new Set<string>();
  for (const { status, path } of changes) {
    const { folder, name } = locate(path);
    if (folder === undefined) {
      if (name === LOCK_FILE) {
        problems.push(
          `R-DB-1: ${path} is ${status === 'D' ? 'deleted' : 'changed'}; it records the provider every migration merged on ${base} was written for, so ${FIX_FORWARD}`,
        );
      }
      continue;
    }
    if (!baseFolders.has(folder)) {
      newFolders.add(folder);
      continue;
    }
    const what =
      status === 'D'
        ? `is deleted or renamed`
        : status === 'A'
          ? `is added to ${folder}`
          : 'is changed';
    problems.push(`R-DB-1: ${path} ${what}, but ${folder} is merged on ${base}; ${FIX_FORWARD}`);
  }

  if (lastBaseFolder !== undefined) {
    for (const folder of [...newFolders].sort()) {
      if (folder < lastBaseFolder) {
        problems.push(
          `R-DB-1: the new migration ${folder} sorts before ${lastBaseFolder}, the last migration on ${base}; Prisma applies folders in name order, so a database that already applied ${lastBaseFolder} would apply ${folder} out of order. Name it with a timestamp after ${lastBaseFolder}.`,
        );
      }
    }
  }
  return problems;
}

interface Streams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** The command: 0 when the history is intact, 1 on a violation, 2 on a bad argument or unknown ref. */
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
    streams.err(`migration check: ${error instanceof Error ? error.message : 'bad arguments'}\n`);
    return 2;
  }
  if (base === undefined || base === '') {
    streams.err('migration check: needs --base <git ref>, the branch the change targets\n');
    return 2;
  }
  let problems: string[];
  try {
    problems = checkMigrations({ cwd, base });
  } catch (error: unknown) {
    streams.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  for (const problem of problems) streams.err(`${problem}\n`);
  if (problems.length === 0) {
    streams.out(
      `migration check: every migration merged on ${base} is unchanged, and every new one sorts after them (R-DB-1)\n`,
    );
  }
  return problems.length === 0 ? 0 : 1;
}

// Run as a command (`pnpm check:migrations`, tsx), never when a test imports this file. tsx compiles
// it as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'migration-check.ts') {
  process.exitCode = main(process.argv.slice(2), repositoryRoot, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
