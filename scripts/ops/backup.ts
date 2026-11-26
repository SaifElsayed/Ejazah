// R2 T179 (`specs/002-identity/tasks.md` T179 and its R2 note; SRS DEC-100, DEC-108; ADR 0015):
// the server's backups, run by its owner's nightly timer (`docs/RUNBOOK.md`, «Backups and restore»):
//
//   pnpm exec tsx scripts/ops/backup.ts dump
//   pnpm exec tsx scripts/ops/backup.ts copy-documents
//   pnpm exec tsx scripts/ops/backup.ts restore --target-url <url> --object db/<instant>.dump.gpg
//
// DUMP. `pg_dump --format=custom` as the owner role (`DATABASE_URL_OWNER`: it reads
// `_prisma_migrations`, which the application role cannot), piped into `gpg --symmetric --cipher-algo
// AES256` with the passphrase file, into a temporary file in a directory only this user reads,
// uploaded with its length to the backup bucket as `db/<UTC instant>.dump.gpg`; the directory is
// removed in every case. Then the prune: every `db/` object older than RETENTION_DAYS is deleted,
// the newest never (a server clock gone wrong must not take the last good dump with it).
//
// COPY-DOCUMENTS. Cloudflare R2 has no versioning, so the documents' second copy is this script's:
// every documents-bucket object missing under `docs/` in the backup bucket is copied there (read
// with the documents' read-only token, written with the backup token: two clients); a `docs/` copy
// whose source is gone moves to `docs-gone/` (copied then deleted inside the backup bucket, so its
// date is the night it was seen gone), and `docs-gone/` objects older than RETENTION_DAYS are
// deleted. An erased file therefore leaves every copy within about 15 days (ADR 0015's 30).
//
// RESTORE. Downloads the object, `gpg --decrypt`, `pg_restore` into the NAMED target only: there is
// no default target, and a target whose database is the one `DATABASE_URL_OWNER` or `DATABASE_URL`
// names, on any host, is refused (a restore goes into a new database, which is then switched to).
//
// The environment is `deploy/backup.env.example`'s, never the API's schema. The three programs
// come from `BACKUP_PG_DUMP`, `BACKUP_PG_RESTORE` and `BACKUP_GPG` (default `pg_dump`,
// `pg_restore`, `gpg`), each a program and its leading arguments split on spaces, so a machine
// without them can run them in a container (`docker exec -i -e PGPASSWORD <container> pg_dump`). A
// database password reaches its program as `PGPASSWORD`, never as an argument, and no bucket key
// or database URL reaches any program's environment. Each command prints one line: counts and the
// backup bucket's object keys, or a reason code; never a URL, a key or the passphrase (the
// programs' own messages are not printed, since they may name a host and a role). A failure exits 1.
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { finished } from 'node:stream/promises';
import { parseArgs } from 'node:util';

import {
  type BucketAccess,
  type ObjectSummary,
  openBucket,
  type S3BackupObjects,
} from '../../apps/api/src/platform/ports/storage/backup-objects';
import { addDays, addSeconds } from '../../packages/time/src/index';

export type Env = Readonly<Record<string, string | undefined>>;

/** DEC-100: dumps are kept 14 days; an erased document's copy leaves `docs-gone/` after as many. */
export const RETENTION_DAYS = 14;
export const DB_PREFIX = 'db/';
export const DOCS_PREFIX = 'docs/';
export const GONE_PREFIX = 'docs-gone/';
const DUMP_SUFFIX = '.dump.gpg';

/** How long one program of a pipe may run before it is stopped (a hung dump fails the night). */
export const STEP_TIMEOUT_MS = 3_600_000;

/** Only the owner reads or writes the encrypted dump on disk. */
const OWNER_ONLY_FILE_MODE = 0o600;

export const USAGE =
  'usage: pnpm exec tsx scripts/ops/backup.ts dump | copy-documents | restore --target-url <url> --object db/<instant>.dump.gpg';

export type Command =
  | { readonly kind: 'dump' }
  | { readonly kind: 'copy-documents' }
  | { readonly kind: 'restore'; readonly targetUrl: string | undefined; readonly object: string };

/** One program of a pipe: its name in a reason code, what to run, and its environment. */
export interface Step {
  readonly name: string;
  readonly program: string;
  readonly args: readonly string[];
  readonly env: Env;
}

/** Runs the steps as one pipe, from a file or nothing, into a file or nothing. */
export interface Runner {
  run(steps: readonly Step[], io: { readonly from?: string; readonly to?: string }): Promise<void>;
}

/** The steps of a pipe that did not end with exit code 0, by name, in the pipe's order. */
export class StepFailure extends Error {
  constructor(readonly failed: readonly string[]) {
    super(`steps failed: ${failed.join(', ')}`);
    this.name = 'StepFailure';
  }
}

export interface Dependencies {
  readonly env: Env;
  readonly backup: S3BackupObjects;
  /** The documents bucket, through its read-only token; only `copy-documents` reads it. */
  readonly documents?: S3BackupObjects;
  readonly runner: Runner;
  readonly now: () => Date;
  /** Where the temporary directory is made. */
  readonly tempRoot: string;
}

/** Where `execute` writes: one line to stdout on success, one to stderr otherwise. */
export interface Output {
  out(line: string): void;
  err(line: string): void;
}

const BACKUP_BUCKET = 'BACKUP_S3';
const DOCUMENTS_BUCKET = 'DOCUMENTS_S3';
const BUCKET_FIELDS = ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'];

function bucketKeys(prefix: string): string[] {
  return BUCKET_FIELDS.map((field) => `${prefix}_${field}`);
}

const REQUIRED: Readonly<Record<Command['kind'], readonly string[]>> = {
  dump: ['DATABASE_URL_OWNER', 'BACKUP_PASSPHRASE_FILE', ...bucketKeys(BACKUP_BUCKET)],
  'copy-documents': [...bucketKeys(BACKUP_BUCKET), ...bucketKeys(DOCUMENTS_BUCKET)],
  restore: [
    'DATABASE_URL_OWNER',
    'DATABASE_URL',
    'BACKUP_PASSPHRASE_FILE',
    ...bucketKeys(BACKUP_BUCKET),
  ],
};

/** The keys the command needs that the environment leaves unset or blank, by name. */
export function missingEnv(command: Command, env: Env): string[] {
  return REQUIRED[command.kind].filter((name) => (env[name] ?? '').trim() === '').sort();
}

function missingLine(command: Command, missing: readonly string[]): string {
  return `backup ${command.kind}: refused (missing_env ${missing.join(',')})`;
}

/** The command the arguments name, or null for anything else. */
export function commandOf(args: readonly string[]): Command | null {
  const [name, ...rest] = args;
  try {
    if (name === 'dump' || name === 'copy-documents') {
      parseArgs({ args: rest, options: {}, strict: true, allowPositionals: false });
      return { kind: name };
    }
    if (name === 'restore') {
      const { values } = parseArgs({
        args: rest,
        options: { 'target-url': { type: 'string' }, object: { type: 'string' } },
        strict: true,
        allowPositionals: false,
      });
      if (values.object === undefined) return null;
      return { kind: 'restore', targetUrl: values['target-url'], object: values.object };
    }
  } catch {
    return null;
  }
  return null;
}

/** `db/` and the instant in ISO 8601's basic form, to the second: keys sort as instants do. */
export function dumpKeyAt(now: Date): string {
  const instant = addSeconds(now, 0).replaceAll('-', '').replaceAll(':', '');
  return `${DB_PREFIX}${instant}${DUMP_SUFFIX}`;
}

function isDumpKey(key: string): boolean {
  return key.startsWith(DB_PREFIX) && key.endsWith(DUMP_SUFFIX);
}

/** The keys of the objects written more than RETENTION_DAYS before `now`. */
export function expiredOf(listing: readonly ObjectSummary[], now: Date): string[] {
  const cutoff = new Date(addDays(now, -RETENTION_DAYS));
  return listing.filter((object) => object.lastModified < cutoff).map((object) => object.key);
}

/** The dumps the prune deletes: the expired ones, the newest never. */
export function prunableDumps(listing: readonly ObjectSummary[], now: Date): string[] {
  const newest = listing.reduce<ObjectSummary | undefined>(
    (kept, object) =>
      kept === undefined || object.lastModified > kept.lastModified ? object : kept,
    undefined,
  );
  return expiredOf(
    listing.filter((object) => object !== newest),
    now,
  );
}

/** The documents to copy (source keys with no copy) and the copies whose source is gone. */
export function copyPlan(
  sources: readonly string[],
  copies: readonly string[],
): { readonly missing: string[]; readonly gone: string[] } {
  const present = new Set(sources);
  const copied = new Set(copies.map((key) => key.slice(DOCS_PREFIX.length)));
  return {
    missing: sources.filter((key) => !copied.has(key)),
    gone: [...copied].filter((key) => !present.has(key)),
  };
}

/** A refusal before anything ran. */
class Refused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** A failure partway: its reason code and, when something already happened, what. */
class Failed extends Error {
  constructor(
    readonly reason: string,
    readonly note?: string,
  ) {
    super(reason);
  }
}

// An error is named by its code or name only: a message may carry a URL, a host or a key.
const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function codeOf(error: unknown): string | undefined {
  const { code, name } = (error ?? {}) as { code?: unknown; name?: unknown };
  if (typeof code === 'string' && SAFE_CODE.test(code)) return code;
  if (typeof name === 'string' && SAFE_CODE.test(name) && name !== 'Error') return name;
  return undefined;
}

function detailOf(error: unknown): string {
  const code = codeOf(error);
  return code === undefined ? '' : ` ${code}`;
}

async function stage<T>(reason: string, work: () => Promise<T>, note?: string): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    throw new Failed(`${reason}${detailOf(error)}`, note);
  }
}

async function pipe(
  runner: Runner,
  steps: readonly Step[],
  io: { readonly from?: string; readonly to?: string },
): Promise<void> {
  try {
    await runner.run(steps, io);
  } catch (error: unknown) {
    if (error instanceof StepFailure) {
      throw new Failed(error.failed.map((name) => `${name}_failed`).join('+'));
    }
    throw error;
  }
}

/** Runs `work` in a new directory only this user reads, removed afterwards whatever happened. */
async function withTempDir<T>(root: string, work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await stage('temp_failed', () => mkdtemp(join(root, 'ijazah-backup-')));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A connection URL with its password taken out, and the password. */
function connectionOf(url: string): { readonly dbname: string; readonly password?: string } {
  const parsed = new URL(url);
  const password = parsed.password === '' ? undefined : decodeURIComponent(parsed.password);
  parsed.password = '';
  return password === undefined
    ? { dbname: parsed.toString() }
    : { dbname: parsed.toString(), password };
}

/** The database a Postgres URL names, or undefined for anything that is not one. */
function databaseOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') return undefined;
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return name === '' ? undefined : name;
  } catch {
    return undefined;
  }
}

// What never reaches a program's environment: the bucket keys and the database URLs.
const KEPT_FROM_PROGRAMS = /^(BACKUP_S3_|DOCUMENTS_S3_|DATABASE_URL|PGPASSWORD$)/;

function programEnv(env: Env, password?: string): Env {
  const kept = Object.fromEntries(
    Object.entries(env).filter(([name]) => !KEPT_FROM_PROGRAMS.test(name)),
  );
  return password === undefined ? kept : { ...kept, PGPASSWORD: password };
}

function programOf(
  value: string | undefined,
  fallback: string,
): { readonly program: string; readonly leading: string[] } {
  const [program, ...leading] = (value ?? '')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
  return program === undefined ? { program: fallback, leading: [] } : { program, leading };
}

function gpgArgs(env: Env): string[] {
  return [
    '--batch',
    '--pinentry-mode',
    'loopback',
    '--no-symkey-cache',
    '--passphrase-file',
    env['BACKUP_PASSPHRASE_FILE'] ?? '',
  ];
}

function pgDumpStep(env: Env): Step {
  const { program, leading } = programOf(env['BACKUP_PG_DUMP'], 'pg_dump');
  const { dbname, password } = connectionOf(env['DATABASE_URL_OWNER'] ?? '');
  return {
    name: 'pg_dump',
    program,
    args: [...leading, '--format=custom', '--no-password', `--dbname=${dbname}`],
    env: programEnv(env, password),
  };
}

function gpgEncryptStep(env: Env): Step {
  const { program, leading } = programOf(env['BACKUP_GPG'], 'gpg');
  return {
    name: 'gpg',
    program,
    args: [...leading, ...gpgArgs(env), '--symmetric', '--cipher-algo', 'AES256'],
    env: programEnv(env),
  };
}

function gpgDecryptStep(env: Env): Step {
  const { program, leading } = programOf(env['BACKUP_GPG'], 'gpg');
  return {
    name: 'gpg',
    program,
    args: [...leading, ...gpgArgs(env), '--decrypt'],
    env: programEnv(env),
  };
}

function pgRestoreStep(env: Env, targetUrl: string): Step {
  const { program, leading } = programOf(env['BACKUP_PG_RESTORE'], 'pg_restore');
  const { dbname, password } = connectionOf(targetUrl);
  return {
    name: 'pg_restore',
    program,
    args: [
      ...leading,
      '--exit-on-error',
      '--single-transaction',
      '--no-password',
      `--dbname=${dbname}`,
    ],
    env: programEnv(env, password),
  };
}

function keysOf(keys: readonly string[]): string {
  return keys.length === 0 ? '' : ` (${keys.join(' ')})`;
}

async function dump(deps: Dependencies): Promise<string> {
  const key = dumpKeyAt(deps.now());
  const bytes = await withTempDir(deps.tempRoot, async (dir) => {
    const file = join(dir, 'dump.gpg');
    await pipe(deps.runner, [pgDumpStep(deps.env), gpgEncryptStep(deps.env)], { to: file });
    return stage('upload_failed', () => deps.backup.putFile(key, file));
  });
  const uploaded = `object=${key} is uploaded`;
  const listing = await stage('prune_failed', () => deps.backup.list(DB_PREFIX), uploaded);
  const doomed = prunableDumps(listing, deps.now());
  for (const doomedKey of doomed) {
    await stage('prune_failed', () => deps.backup.remove(doomedKey), uploaded);
  }
  return `object=${key} bytes=${bytes} pruned=${doomed.length}${keysOf(doomed)} kept=${listing.length - doomed.length}`;
}

async function copyDocuments(deps: Dependencies): Promise<string> {
  const { documents, backup } = deps;
  if (documents === undefined) throw new Failed('documents_bucket_missing');
  const [sources, copies, gone] = await stage('list_failed', () =>
    Promise.all([documents.list(''), backup.list(DOCS_PREFIX), backup.list(GONE_PREFIX)]),
  );
  const plan = copyPlan(
    sources.map((object) => object.key),
    copies.map((object) => object.key),
  );
  for (const key of plan.missing) {
    await stage('copy_failed', async () => {
      const object = await documents.read(key);
      await backup.put(`${DOCS_PREFIX}${key}`, object.body, object.contentType);
    });
  }
  for (const key of plan.gone) {
    await stage('move_failed', async () => {
      await backup.copy(`${DOCS_PREFIX}${key}`, `${GONE_PREFIX}${key}`);
      await backup.remove(`${DOCS_PREFIX}${key}`);
    });
  }
  const expired = expiredOf(gone, deps.now());
  for (const key of expired) await stage('gone_prune_failed', () => backup.remove(key));
  const moved = plan.gone.map((key) => `${DOCS_PREFIX}${key}`);
  return `copied=${plan.missing.length} moved_gone=${moved.length}${keysOf(moved)} deleted_gone=${expired.length}${keysOf(expired)}`;
}

async function restore(
  deps: Dependencies,
  command: Extract<Command, { kind: 'restore' }>,
): Promise<string> {
  const { targetUrl, object } = command;
  if (targetUrl === undefined || targetUrl.trim() === '') throw new Refused('target_missing');
  const target = databaseOf(targetUrl);
  if (target === undefined) throw new Refused('target_invalid');
  const runtime = [deps.env['DATABASE_URL_OWNER'], deps.env['DATABASE_URL']].map((url) =>
    databaseOf(url ?? ''),
  );
  if (runtime.includes(target)) throw new Refused('target_is_runtime');
  if (!isDumpKey(object)) throw new Refused('object_not_a_dump');
  await withTempDir(deps.tempRoot, async (dir) => {
    const file = join(dir, 'restore.gpg');
    await stage('download_failed', () => deps.backup.download(object, file));
    await pipe(deps.runner, [gpgDecryptStep(deps.env), pgRestoreStep(deps.env, targetUrl)], {
      from: file,
    });
  });
  return `object=${object} restored into the named target`;
}

/** Runs the command and says what happened in one line; the process's exit code. */
export async function execute(
  command: Command,
  deps: Dependencies,
  output: Output,
): Promise<number> {
  const name = `backup ${command.kind}`;
  const missing = missingEnv(command, deps.env);
  if (missing.length > 0) {
    output.err(missingLine(command, missing));
    return 1;
  }
  try {
    const done =
      command.kind === 'dump'
        ? await dump(deps)
        : command.kind === 'copy-documents'
          ? await copyDocuments(deps)
          : await restore(deps, command);
    output.out(`${name}: ok ${done}`);
    return 0;
  } catch (error: unknown) {
    if (error instanceof Refused) {
      output.err(`${name}: refused (${error.reason})`);
    } else if (error instanceof Failed) {
      output.err(
        `${name}: failed (${error.reason})${error.note === undefined ? '' : `: ${error.note}`}`,
      );
    } else {
      output.err(`${name}: failed (unexpected${detailOf(error)})`);
    }
    return 1;
  }
}

/**
 * The real pipe: each program's output into the next one's input, the first fed from a file or
 * nothing, the last into a file or nothing. Every program is waited for; those that did not exit
 * with 0 (or could not start, or ran past STEP_TIMEOUT_MS) are named together, since one dying
 * usually ends its neighbour too. The programs' own messages are not kept.
 */
async function runPipe(
  steps: readonly Step[],
  io: { readonly from?: string; readonly to?: string },
): Promise<void> {
  const children = steps.map((step) =>
    spawn(step.program, [...step.args], {
      env: { ...step.env },
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: STEP_TIMEOUT_MS,
      windowsHide: true,
    }),
  );
  const exits = children.map(
    (child) =>
      new Promise<boolean>((resolve) => {
        child.once('error', () => resolve(false));
        child.once('close', (code) => resolve(code === 0));
      }),
  );
  for (const child of children) child.stdin.on('error', () => undefined);
  children.forEach((child, index) => {
    const next = children[index + 1];
    if (next === undefined) return;
    child.stdout.pipe(next.stdin);
    // A program that could not start never ends its output; its neighbour still needs an end.
    child.once('close', () => {
      if (!next.stdin.writableEnded) next.stdin.end();
    });
  });
  const [first] = children;
  const last = children[children.length - 1];
  if (first === undefined || last === undefined) return;
  if (io.from === undefined) {
    first.stdin.end();
  } else {
    const input = createReadStream(io.from);
    input.on('error', () => first.stdin.end());
    first.once('close', () => input.destroy());
    input.pipe(first.stdin);
  }
  let written: Promise<void> = Promise.resolve();
  if (io.to === undefined) {
    last.stdout.resume();
  } else {
    const out = createWriteStream(io.to, { mode: OWNER_ONLY_FILE_MODE, flags: 'wx' });
    written = finished(out);
    last.stdout.pipe(out);
    last.once('close', () => {
      if (!out.writableEnded) out.end();
    });
  }
  const ended = await Promise.all(exits);
  await written;
  const failed = steps.filter((_, index) => ended[index] !== true).map((step) => step.name);
  if (failed.length > 0) throw new StepFailure(failed);
}

export const spawnRunner: Runner = { run: runPipe };

function bucketOf(env: Env, prefix: string): BucketAccess {
  const value = (field: string): string => env[`${prefix}_${field}`] ?? '';
  return {
    endpoint: value('ENDPOINT'),
    region: value('REGION'),
    bucket: value('BUCKET'),
    accessKeyId: value('ACCESS_KEY_ID'),
    secretAccessKey: value('SECRET_ACCESS_KEY'),
  };
}

async function main(): Promise<number> {
  const command = commandOf(process.argv.slice(2));
  if (command === null) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const env: Env = process.env;
  const output: Output = {
    out: (line) => void process.stdout.write(`${line}\n`),
    err: (line) => void process.stderr.write(`${line}\n`),
  };
  // The buckets are built only from complete values.
  const missing = missingEnv(command, env);
  if (missing.length > 0) {
    output.err(missingLine(command, missing));
    return 1;
  }
  return execute(
    command,
    {
      env,
      backup: openBucket(bucketOf(env, BACKUP_BUCKET)),
      ...(command.kind === 'copy-documents'
        ? { documents: openBucket(bucketOf(env, DOCUMENTS_BUCKET)) }
        : {}),
      runner: spawnRunner,
      now: () => new Date(),
      tempRoot: tmpdir(),
    },
    output,
  );
}

// Run as a command (tsx), never when a spec imports it; tsx compiles this file as CommonJS.
if (basename(process.argv[1] ?? '') === 'backup.ts') {
  void main().then((code) => {
    process.exitCode = code;
  });
}
