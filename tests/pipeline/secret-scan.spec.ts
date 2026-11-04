// Secret scanning, in two places (T080, SC-010, FR-059, research R-15).
//
// The local check is the Gitleaks line of `.husky/pre-commit` (T082) and the pipeline check is the
// Gitleaks step of the `secret-scan` job in `.github/workflows/ci.yml` (T083). This spec reads each
// command from its own file and runs it, exactly as written, in a throwaway repository holding a
// planted secret, so the test fails the day either file stops rejecting one. Each command is run on
// its own and neither file may name the other: the two nets are independent on purpose (SC-010).
//
// The planted secret is a GitHub token shape (Gitleaks rule `github-pat`) assembled at run time from
// random bytes, so this file holds no secret and the repository's own scan stays clean. A clean
// repository is run through both commands too, so a refusal is known to come from the secret and
// not from a broken command. Gitleaks must be on the PATH (quickstart; T081 installs it in the test
// stage); without it the spawn fails and so does this spec.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const RULE = 'github-pat';

/** The single `gitleaks …` line of the pre-commit hook, as argv. */
function localCommand(): string[] {
  const hook = readFileSync(join(root, '.husky', 'pre-commit'), 'utf8');
  const lines = hook.split(/\r?\n/).filter((line) => /^gitleaks\s/.test(line.trim()));
  expect(lines, 'exactly one gitleaks line in .husky/pre-commit').toHaveLength(1);
  return argv(lines[0]);
}

/** The single `run: gitleaks …` step of the `secret-scan` job, as argv. */
function pipelineCommand(): string[] {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = jobBlock(workflow, 'secret-scan');
  const lines = job
    .split(/\r?\n/)
    .map((line) => /^\s*(?:-\s+)?run:\s+(gitleaks\s.*)$/.exec(line)?.[1])
    .filter((line): line is string => line !== undefined);
  expect(lines, 'exactly one `run: gitleaks` step in the secret-scan job').toHaveLength(1);
  return argv(lines[0]);
}

/** The lines of one top-level job under `jobs:`, up to the next job. */
function jobBlock(workflow: string, name: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  expect(start, `job ${name} in ci.yml`).toBeGreaterThan(-1);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** A command with no quoting, pipes or variables, split on spaces; anything else is refused. */
function argv(command: string | undefined): string[] {
  const trimmed = (command ?? '').trim();
  expect(trimmed, 'a plain command the test can run exactly').toMatch(
    /^[\w./=-]+(?:\s+[\w./=-]+)*$/,
  );
  return trimmed.split(/\s+/);
}

/** A token of GitHub's personal-access-token shape, never written to this file. */
function plantedSecret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const body = Array.from(randomBytes(36), (byte) => alphabet[byte % alphabet.length]).join('');
  return ['ghp', body].join('_');
}

const repositories: string[] = [];

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  expect(result.status, `git ${args.join(' ')}: ${result.stderr}`).toBe(0);
}

function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ijazah-secret-scan-'));
  repositories.push(dir);
  git(dir, 'init', '--quiet');
  git(dir, 'config', 'user.name', 'secret-scan spec');
  git(dir, 'config', 'user.email', 'secret-scan@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  // The throwaway repository runs no hook of its own: each check is run below, by itself.
  git(dir, 'config', 'core.hooksPath', join(dir, 'no-hooks'));
  write(dir, 'README.md', 'nothing to see\n');
  git(dir, 'add', '--all');
  git(dir, 'commit', '--quiet', '--message', 'start');
  return dir;
}

function write(dir: string, file: string, content: string): void {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), content);
}

function run(command: string[], cwd: string): { status: number | null; output: string } {
  const [program, ...args] = command;
  if (program === undefined) throw new Error('an empty command');
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const dir of repositories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the two checks are separate nets (SC-010)', () => {
  it('the hook does not call the pipeline, and the pipeline does not call the hook', () => {
    // Comments are left out: each file's header may say, in words, that the other net exists.
    const code = (text: string): string =>
      text
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
    const hook = code(readFileSync(join(root, '.husky', 'pre-commit'), 'utf8'));
    const job = code(
      jobBlock(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'), 'secret-scan'),
    );
    expect(hook).not.toMatch(/ci\.yml|\.github|workflow/);
    expect(job).not.toMatch(/\.husky|pre-commit/);
    expect(localCommand()).not.toEqual(pipelineCommand());
  });
});

describe('the local check (.husky/pre-commit, T082)', () => {
  // It starts nine processes, git eight times and Gitleaks once (about 0.4 s of its own), with no
  // work repeated. Measured on the owner's machine (T067, 2026-11-02): 0.7 s alone, 0.7 to 0.9 s
  // under coverage, 2.7 s in a full run, and past the default five seconds in a full run on
  // `ijazah_integrity` (B26). The room is the generated-file check's lockfile cases'.
  it('passes a clean staged change', { timeout: 15_000 }, () => {
    const dir = repository();
    write(dir, 'src/config.ts', "export const region = 'eu';\n");
    git(dir, 'add', '--all');
    expect(run(localCommand(), dir).status).toBe(0);
  });

  it.each(['src/config.ts', 'specs/001-foundations/notes.md'])(
    'rejects a secret staged in %s',
    (file) => {
      const dir = repository();
      write(dir, file, `token = ${plantedSecret()}\n`);
      git(dir, 'add', '--all');
      const result = run(localCommand(), dir);
      expect(result.status, result.output).not.toBe(0);
      expect(result.output).toContain(RULE);
    },
  );
});

describe('the pipeline check (ci.yml secret-scan, T083)', () => {
  // B31a (the note under 003:T080): Gitleaks over a repository's history ran past the default five
  // seconds in a full run on `ijazah_integrity`; each history case has the staged-change case's room.
  it('passes a clean history', { timeout: 15_000 }, () => {
    const dir = repository();
    expect(run(pipelineCommand(), dir).status).toBe(0);
  });

  it.each(['src/config.ts', 'specs/001-foundations/notes.md'])(
    'rejects a secret committed in %s and removed in a later commit',
    { timeout: 15_000 },
    (file) => {
      const dir = repository();
      write(dir, file, `token = ${plantedSecret()}\n`);
      git(dir, 'add', '--all');
      git(dir, 'commit', '--quiet', '--message', 'plant');
      rmSync(join(dir, file));
      git(dir, 'add', '--all');
      git(dir, 'commit', '--quiet', '--message', 'remove');
      const result = run(pipelineCommand(), dir);
      expect(result.status, result.output).not.toBe(0);
      expect(result.output).toContain(RULE);
    },
  );
});
