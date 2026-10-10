// T085 — the generated-file drift check (FR-062, R-PROC-9).
//
// Each committed generated file is regenerated and compared; a difference fails naming R-PROC-9 and
// the command that regenerates it. The contract snapshot is compared with what the code generates
// (an addition without regeneration and a hand edit both fail). The lockfile is checked in a scratch
// copy of the workspace's manifests by pnpm's own `install --lockfile-only`, so these cases also
// assert that the committed lockfile is never rewritten. The lockfile cases copy the repository's
// real manifests and lockfile into a throwaway root and change the copy only.
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SNAPSHOT_PATH } from '../../scripts/contract-snapshot';
import {
  checkContractSnapshot,
  checkLockfile,
  describeDrift,
} from '../../scripts/generated-file-check';

const root = join(__dirname, '..', '..');

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function scratchRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ijazah-generated-'));
  directories.push(directory);
  return directory;
}

describe('the contract snapshot (T084)', () => {
  const generated = '{ "generated": true }\n';
  const generate = (): Promise<string> => Promise.resolve(generated);

  function rootHolding(text: string | undefined): string {
    const directory = scratchRoot();
    if (text !== undefined) {
      mkdirSync(dirname(join(directory, SNAPSHOT_PATH)), { recursive: true });
      writeFileSync(join(directory, SNAPSHOT_PATH), text);
    }
    return directory;
  }

  it('passes the committed copy the code generates', async () => {
    expect(await checkContractSnapshot(rootHolding(generated), generate)).toBeUndefined();
  });

  it('fails a copy that differs, naming R-PROC-9 and the command to run', async () => {
    const drift = await checkContractSnapshot(rootHolding('{ "generated": false }\n'), generate);
    expect(drift?.path).toBe(SNAPSHOT_PATH);
    const message = describeDrift(drift ?? { path: '', problem: '', command: '' });
    expect(message).toContain('R-PROC-9');
    expect(message).toContain(SNAPSHOT_PATH);
    expect(message).toContain('pnpm contract:snapshot');
  });

  it('fails a missing snapshot', async () => {
    expect((await checkContractSnapshot(rootHolding(undefined), generate))?.problem).toBe(
      'is missing',
    );
  });

  it('passes this repository’s committed snapshot', async () => {
    expect(await checkContractSnapshot(root)).toBeUndefined();
  });
});

describe('the lockfile', () => {
  /** A throwaway root holding the repository's manifests and lockfile, and nothing else. */
  function workspaceCopy(): string {
    const directory = scratchRoot();
    const files = ['package.json', 'pnpm-workspace.yaml', '.npmrc', 'pnpm-lock.yaml'];
    for (const group of ['apps', 'packages']) {
      for (const name of readdirSync(join(root, group)))
        files.push(join(group, name, 'package.json'));
    }
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      copyFileSync(join(root, file), join(directory, file));
    }
    return directory;
  }

  it('passes the committed lockfile, and leaves it byte for byte as it was', () => {
    const directory = workspaceCopy();
    const before = readFileSync(join(directory, 'pnpm-lock.yaml'), 'utf8');
    expect(checkLockfile(directory)).toBeUndefined();
    expect(readFileSync(join(directory, 'pnpm-lock.yaml'), 'utf8')).toBe(before);
  });

  it('fails a lockfile that no longer matches a manifest', () => {
    const directory = workspaceCopy();
    const manifest = join(directory, 'package.json');
    writeFileSync(
      manifest,
      readFileSync(manifest, 'utf8').replace('"dotenv": "17.4.2"', '"dotenv": "17.4.1"'),
    );
    const drift = checkLockfile(directory);
    expect(drift?.problem).toContain('does not match the package manifests');
    const message = describeDrift(drift ?? { path: '', problem: '', command: '' });
    expect(message).toContain('R-PROC-9');
    expect(message).toContain('pnpm install');
  });

  it('fails a lockfile edited by hand into a form pnpm does not write, and leaves it as it was', () => {
    const directory = workspaceCopy();
    const lockfile = join(directory, 'pnpm-lock.yaml');
    const edited = readFileSync(lockfile, 'utf8').replace('\nimporters:\n', '\n\nimporters:\n');
    writeFileSync(lockfile, edited);
    expect(checkLockfile(directory)?.problem).toBe(
      'is not the lockfile pnpm writes for these manifests',
    );
    expect(readFileSync(lockfile, 'utf8')).toBe(edited);
  });
});
