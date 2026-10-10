// T085: the generated-file drift check (FR-062, R-PROC-9). A generated file is never edited by hand:
// it is regenerated from its source and committed. This check regenerates every committed generated
// file and fails, naming R-PROC-9 and the command to run, when the committed copy differs.
//
//   pnpm check:generated
//
// WHAT IS CHECKED, AND HOW
//
//   packages/contracts/contract-snapshot.json   regenerated in memory from the code (T084) and
//                                                compared byte for byte. So a procedure, field or
//                                                enum member added without regenerating the
//                                                snapshot fails here, and a hand edit fails too.
//   pnpm-lock.yaml                               two runs of pnpm's own `install --lockfile-only`,
//                                                in a scratch copy of the workspace's manifests, so
//                                                the committed file is never rewritten and nothing
//                                                is downloaded or linked: first `--frozen-lockfile`,
//                                                which refuses a lockfile that no longer matches the
//                                                manifests (a dependency changed without
//                                                `pnpm install`, or a specifier edited by hand);
//                                                then a regeneration `--offline` against an empty
//                                                store and cache, compared byte for byte, which
//                                                refuses a lockfile pnpm would not have written
//                                                (an entry reordered, removed or reformatted).
//
// WHAT IS NOT. The Prisma client is generated into `node_modules` and never committed (.gitignore),
// so there is no copy to compare. Migrations are not generated files: a migration is the source of
// truth from the moment it is created (research R-6, RUNBOOK "Migration workflow"), and R-DB-1's
// checksum check holds it (T071). A lockfile edit that leaves a valid lockfile pnpm would write the
// same way, such as a resolved version changed with its integrity, is not visible to any pnpm
// option; the integrity check of `pnpm install --frozen-lockfile` in CI refuses a package whose
// hash does not match.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

import { SNAPSHOT_PATH, currentSnapshotText } from './contract-snapshot';

const repositoryRoot = join(__dirname, '..');

/** A committed generated file that is not what its generator writes. */
export interface Drift {
  readonly path: string;
  readonly problem: string;
  /** The command that regenerates it. */
  readonly command: string;
}

/** The failure line for one drift, naming R-PROC-9 and what to run. */
export function describeDrift(drift: Drift): string {
  return `R-PROC-9: ${drift.path} ${drift.problem}. Never edit a generated file by hand: run \`${drift.command}\` and commit the result.`;
}

/** Compares the committed contract snapshot with the one the code generates now. */
export async function checkContractSnapshot(
  root: string,
  generate: () => Promise<string> = currentSnapshotText,
): Promise<Drift | undefined> {
  const file = join(root, SNAPSHOT_PATH);
  const command = 'pnpm contract:snapshot';
  if (!existsSync(file)) {
    return { path: SNAPSHOT_PATH, problem: 'is missing', command };
  }
  if (readFileSync(file, 'utf8') === (await generate())) return undefined;
  return {
    path: SNAPSHOT_PATH,
    problem:
      'differs from the snapshot generated from this code (a procedure, field or enum member added or changed without regenerating it, or an edit by hand)',
    command,
  };
}

/** `pnpm` with `args` in `cwd`, run the way this process was started when a pnpm script started it. */
function pnpm(cwd: string, args: readonly string[]): { ok: boolean; output: string } {
  const entry = process.env['npm_execpath'];
  const result =
    entry !== undefined && /\.c?js$/.test(entry)
      ? spawnSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf8' })
      : spawnSync('pnpm', [...args], {
          cwd,
          encoding: 'utf8',
          shell: process.platform === 'win32',
        });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Every workspace project's directory, relative to `root`, as pnpm itself lists them. */
function workspaceProjects(root: string): string[] {
  const listed = pnpm(root, ['-r', 'ls', '--depth', '-1', '--json']);
  if (!listed.ok)
    throw new Error(`generated files: pnpm could not list the workspace: ${listed.output}`);
  const projects: unknown = JSON.parse(listed.output);
  if (!Array.isArray(projects)) throw new Error('generated files: pnpm listed no workspace');
  return projects.map((project: unknown) => {
    const path: unknown =
      typeof project === 'object' && project !== null ? Reflect.get(project, 'path') : undefined;
    if (typeof path !== 'string')
      throw new Error('generated files: a workspace project has no path');
    return relative(root, path);
  });
}

// What pnpm reads besides the manifests when it writes the lockfile, copied when present.
const WORKSPACE_FILES = ['pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs'];

/**
 * Checks `pnpm-lock.yaml` against the manifests in a scratch copy of the workspace, so the committed
 * file is never rewritten: refused when it no longer matches them, or when pnpm would write it
 * differently.
 */
export function checkLockfile(root: string): Drift | undefined {
  const command = 'pnpm install';
  const committed = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const scratch = mkdtempSync(join(tmpdir(), 'ijazah-lockfile-'));
  try {
    const files = [
      'pnpm-lock.yaml',
      ...WORKSPACE_FILES.filter((file) => existsSync(join(root, file))),
      ...workspaceProjects(root).map((project) => join(project, 'package.json')),
    ];
    for (const file of files) {
      mkdirSync(dirname(join(scratch, file)), { recursive: true });
      copyFileSync(join(root, file), join(scratch, file));
    }
    // A patched dependency's hash is in the lockfile, so its patch is read too.
    if (existsSync(join(root, 'patches'))) {
      cpSync(join(root, 'patches'), join(scratch, 'patches'), { recursive: true });
    }
    // `--ignore-scripts`: no lifecycle script runs in the scratch copy. The store and cache are the
    // scratch copy's own, so `--offline` proves the lockfile alone is enough and touches no cache.
    const isolated = ['--ignore-scripts', '--store-dir', '.store', '--cache-dir', '.cache'];
    const frozen = pnpm(scratch, ['install', '--lockfile-only', '--frozen-lockfile', ...isolated]);
    if (!frozen.ok) {
      return {
        path: 'pnpm-lock.yaml',
        problem: `does not match the package manifests (pnpm install --frozen-lockfile refuses it)\n${frozen.output.trim()}`,
        command,
      };
    }
    const rewritten = pnpm(scratch, [
      'install',
      '--lockfile-only',
      '--no-frozen-lockfile',
      '--offline',
      ...isolated,
    ]);
    if (!rewritten.ok || readFileSync(join(scratch, 'pnpm-lock.yaml'), 'utf8') !== committed) {
      return {
        path: 'pnpm-lock.yaml',
        problem: 'is not the lockfile pnpm writes for these manifests',
        command,
      };
    }
    return undefined;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const checked: [string, Drift | undefined][] = [
    [SNAPSHOT_PATH, await checkContractSnapshot(repositoryRoot)],
    ['pnpm-lock.yaml', checkLockfile(repositoryRoot)],
  ];
  for (const [path, drift] of checked) {
    if (drift === undefined) process.stdout.write(`generated files: ${path} is as generated\n`);
    else process.stderr.write(`${describeDrift(drift)}\n`);
  }
  return checked.some(([, drift]) => drift !== undefined) ? 1 : 0;
}

// Run as a command (`pnpm check:generated`, tsx), never when a test imports this file. tsx
// compiles it as CommonJS, so neither top-level await nor `import.meta` is available.
if (basename(process.argv[1] ?? '') === 'generated-file-check.ts') {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    },
  );
}
