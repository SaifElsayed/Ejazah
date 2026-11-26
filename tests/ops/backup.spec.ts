// R2 T179 (`specs/002-identity/tasks.md` T179 and its R2 note; SRS DEC-100, DEC-108; ADR 0015):
// `scripts/ops/backup.ts`, the nightly dump, the documents' second copy and the restore.
//
// No network. Both buckets live in one in-memory S3 that answers the real client's commands
// (`S3BackupObjects` over a fake `send`), so the script's calls run end to end down to the request
// the SDK would sign. `pg_dump`, `gpg` and `pg_restore` are a recording runner here; the real
// runner is proved with Node child processes standing in for them. The restore against a real
// database is the drill, run once by hand (the RUNBOOK's «Backups and restore»).
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type ObjectClient,
  S3BackupObjects,
} from '../../apps/api/src/platform/ports/storage/backup-objects';
import {
  type Command,
  commandOf,
  type Dependencies,
  dumpKeyAt,
  execute,
  prunableDumps,
  RETENTION_DAYS,
  type Runner,
  spawnRunner,
  type Step,
  StepFailure,
} from '../../scripts/ops/backup';

const NOW = new Date('2026-11-26T22:03:04.567Z');
const AGE = {
  today: new Date('2026-11-26T22:00:00Z'),
  thirteenDays: new Date('2026-11-13T22:00:00Z'),
  fifteenDays: new Date('2026-11-11T22:00:00Z'),
  twentyDays: new Date('2026-11-06T22:00:00Z'),
  fortyDays: new Date('2026-10-17T22:00:00Z'),
};

const OWNER_PASSWORD = 'owner-pass-in-spec';
const APP_PASSWORD = 'app-pass-in-spec';
const BACKUP_KEY_ID = 'backup-key-id-in-spec';
const BACKUP_SECRET = 'backup-secret-in-spec';
const DOCUMENTS_KEY_ID = 'documents-key-id-in-spec';
const DOCUMENTS_SECRET = 'documents-secret-in-spec';
const SECRETS = [
  OWNER_PASSWORD,
  APP_PASSWORD,
  BACKUP_KEY_ID,
  BACKUP_SECRET,
  DOCUMENTS_KEY_ID,
  DOCUMENTS_SECRET,
];

const ENV: Readonly<Record<string, string>> = {
  DATABASE_URL_OWNER: `postgresql://ijazah_owner:${OWNER_PASSWORD}@db.internal:5432/ijazah?sslmode=disable`,
  DATABASE_URL: `postgresql://ijazah_app:${APP_PASSWORD}@db.internal:5432/ijazah`,
  BACKUP_PASSPHRASE_FILE: '/etc/ijazah/backup.passphrase',
  BACKUP_S3_ENDPOINT: 'https://account.storage.invalid',
  BACKUP_S3_REGION: 'auto',
  BACKUP_S3_BUCKET: 'ijazah-backups',
  BACKUP_S3_ACCESS_KEY_ID: BACKUP_KEY_ID,
  BACKUP_S3_SECRET_ACCESS_KEY: BACKUP_SECRET,
  DOCUMENTS_S3_ENDPOINT: 'https://account.storage.invalid',
  DOCUMENTS_S3_REGION: 'auto',
  DOCUMENTS_S3_BUCKET: 'ijazah-documents',
  DOCUMENTS_S3_ACCESS_KEY_ID: DOCUMENTS_KEY_ID,
  DOCUMENTS_S3_SECRET_ACCESS_KEY: DOCUMENTS_SECRET,
  PATH: '/usr/bin',
};

const RESTORE_TARGET =
  'postgresql://ijazah_owner:target-pass-in-spec@db.internal:5432/ijazah_restored';

interface Stored {
  readonly body: Uint8Array;
  readonly lastModified: Date;
  readonly contentType: string | undefined;
}

interface Sent {
  readonly name: string;
  readonly input: Record<string, unknown>;
}

/** One in-memory S3 for both buckets; each object is dated by this store's own clock. */
class FakeS3 {
  readonly buckets = new Map<string, Map<string, Stored>>();
  readonly sent: Sent[] = [];
  clock: Date = NOW;
  failOn: ((sent: Sent) => Error | undefined) | undefined;

  bucket(name: string): Map<string, Stored> {
    let objects = this.buckets.get(name);
    if (objects === undefined) {
      objects = new Map();
      this.buckets.set(name, objects);
    }
    return objects;
  }

  plant(bucket: string, key: string, lastModified: Date, text = `bytes of ${key}`): void {
    this.bucket(bucket).set(key, {
      body: new TextEncoder().encode(text),
      lastModified,
      contentType: 'application/pdf',
    });
  }

  keys(bucket: string): string[] {
    return [...this.bucket(bucket).keys()].sort();
  }

  text(bucket: string, key: string): string | undefined {
    const stored = this.bucket(bucket).get(key);
    return stored === undefined ? undefined : new TextDecoder().decode(stored.body);
  }

  client(): ObjectClient {
    return { send: (command: unknown) => this.answer(command) } as unknown as ObjectClient;
  }

  private async answer(command: unknown): Promise<unknown> {
    const name = (command as object).constructor.name;
    const input = (command as { input: Record<string, unknown> }).input;
    const sent = { name, input };
    this.sent.push(sent);
    const failure = this.failOn?.(sent);
    if (failure !== undefined) throw failure;
    const objects = this.bucket(String(input['Bucket']));
    const key = String(input['Key']);
    switch (name) {
      case 'ListObjectsV2Command': {
        const all = [...objects.keys()]
          .filter((k) => k.startsWith(String(input['Prefix'] ?? '')))
          .sort();
        const start = Number(input['ContinuationToken'] ?? 0);
        const page = all.slice(start, start + 2);
        const truncated = start + 2 < all.length;
        return {
          Contents: page.map((k) => ({ Key: k, LastModified: objects.get(k)?.lastModified })),
          IsTruncated: truncated,
          NextContinuationToken: truncated ? String(start + 2) : undefined,
        };
      }
      case 'PutObjectCommand': {
        objects.set(key, {
          body: await bytesOf(input['Body']),
          lastModified: this.clock,
          contentType: input['ContentType'] as string | undefined,
        });
        return {};
      }
      case 'GetObjectCommand': {
        const stored = objects.get(key);
        if (stored === undefined) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return {
          Body: Object.assign(Readable.from([Buffer.from(stored.body)]), {
            transformToByteArray: () => Promise.resolve(stored.body),
          }),
          ContentType: stored.contentType,
        };
      }
      case 'CopyObjectCommand': {
        const source = String(input['CopySource']);
        const slash = source.indexOf('/');
        const from = this.bucket(source.slice(0, slash));
        const fromKey = source
          .slice(slash + 1)
          .split('/')
          .map((segment) => decodeURIComponent(segment))
          .join('/');
        const stored = from.get(fromKey);
        if (stored === undefined) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        objects.set(key, { ...stored, lastModified: this.clock });
        return {};
      }
      case 'DeleteObjectCommand': {
        objects.delete(key);
        return {};
      }
      default:
        throw new Error(`the fake S3 does not answer ${name}`);
    }
  }
}

async function bytesOf(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

interface Run {
  readonly steps: readonly Step[];
  readonly from: string | undefined;
  readonly to: string | undefined;
  readonly input: string | undefined;
}

/** Writes `output` where a pipe ends in a file, reads what a pipe starts from, and records both. */
class RecordingRunner implements Runner {
  readonly runs: Run[] = [];
  output = 'ENCRYPTED DUMP BYTES';
  failing: readonly string[] = [];

  async run(steps: readonly Step[], io: { readonly from?: string; readonly to?: string }) {
    const input = io.from === undefined ? undefined : await readFile(io.from, 'utf8');
    this.runs.push({ steps, from: io.from, to: io.to, input });
    if (io.to !== undefined) await writeFile(io.to, this.output);
    if (this.failing.length > 0) throw new StepFailure(this.failing);
  }
}

let s3: FakeS3;
let runner: RecordingRunner;
let tempRoot: string;
let lines: string[];

beforeEach(async () => {
  s3 = new FakeS3();
  runner = new RecordingRunner();
  tempRoot = await mkdtemp(join(tmpdir(), 'backup-spec-'));
  lines = [];
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function depsOf(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    env: ENV,
    backup: new S3BackupObjects(s3.client(), 'ijazah-backups'),
    documents: new S3BackupObjects(s3.client(), 'ijazah-documents'),
    runner,
    now: () => NOW,
    tempRoot,
    ...overrides,
  };
}

const output = {
  out: (line: string) => void lines.push(`out: ${line}`),
  err: (line: string) => void lines.push(`err: ${line}`),
};

function run(command: Command, overrides: Partial<Dependencies> = {}): Promise<number> {
  return execute(command, depsOf(overrides), output);
}

const DUMP: Command = { kind: 'dump' };
const COPY: Command = { kind: 'copy-documents' };

function restore(targetUrl: string | undefined, object = 'db/20261125T220000Z.dump.gpg'): Command {
  return { kind: 'restore', targetUrl, object };
}

describe('the arguments', () => {
  it('reads dump, copy-documents and restore with --target-url and --object; anything else is null', () => {
    expect(commandOf(['dump'])).toEqual({ kind: 'dump' });
    expect(commandOf(['copy-documents'])).toEqual({ kind: 'copy-documents' });
    expect(
      commandOf(['restore', '--target-url', RESTORE_TARGET, '--object', 'db/a.dump.gpg']),
    ).toEqual({ kind: 'restore', targetUrl: RESTORE_TARGET, object: 'db/a.dump.gpg' });
    expect(commandOf(['restore', '--object', 'db/a.dump.gpg'])).toEqual({
      kind: 'restore',
      targetUrl: undefined,
      object: 'db/a.dump.gpg',
    });
    expect(commandOf([])).toBeNull();
    expect(commandOf(['prune'])).toBeNull();
    expect(commandOf(['dump', '--force'])).toBeNull();
    expect(commandOf(['restore', '--target-url', RESTORE_TARGET])).toBeNull();
  });
});

describe('dump', () => {
  it('names the object by its UTC instant to the second, under db/', () => {
    expect(dumpKeyAt(NOW)).toBe('db/20261126T220304Z.dump.gpg');
  });

  it('dumps as the owner role through gpg AES256 with the passphrase file, and uploads the file with its length', async () => {
    expect(await run(DUMP)).toBe(0);

    expect(runner.runs).toHaveLength(1);
    const [dumpStep, gpgStep] = runner.runs[0]?.steps ?? [];
    expect(dumpStep?.name).toBe('pg_dump');
    expect(dumpStep?.program).toBe('pg_dump');
    expect(dumpStep?.args).toEqual([
      '--format=custom',
      '--no-password',
      '--dbname=postgresql://ijazah_owner@db.internal:5432/ijazah?sslmode=disable',
    ]);
    expect(dumpStep?.env['PGPASSWORD']).toBe(OWNER_PASSWORD);
    expect(gpgStep?.name).toBe('gpg');
    expect(gpgStep?.program).toBe('gpg');
    expect(gpgStep?.args).toEqual([
      '--batch',
      '--pinentry-mode',
      'loopback',
      '--no-symkey-cache',
      '--passphrase-file',
      '/etc/ijazah/backup.passphrase',
      '--symmetric',
      '--cipher-algo',
      'AES256',
    ]);
    expect(gpgStep?.env['PGPASSWORD']).toBeUndefined();

    expect(s3.text('ijazah-backups', 'db/20261126T220304Z.dump.gpg')).toBe('ENCRYPTED DUMP BYTES');
    const put = s3.sent.find((sent) => sent.name === 'PutObjectCommand');
    expect(put?.input['ContentLength']).toBe('ENCRYPTED DUMP BYTES'.length);
    expect(lines).toEqual([
      `out: backup dump: ok object=db/20261126T220304Z.dump.gpg bytes=${'ENCRYPTED DUMP BYTES'.length} pruned=0 kept=1`,
    ]);
  });

  it('runs the commands the environment names, with their leading arguments', async () => {
    const env = {
      ...ENV,
      BACKUP_PG_DUMP: 'docker exec -i -e PGPASSWORD db pg_dump',
      BACKUP_GPG: '/usr/local/bin/gpg2',
    };
    expect(await run(DUMP, { env })).toBe(0);
    const [dumpStep, gpgStep] = runner.runs[0]?.steps ?? [];
    expect(dumpStep?.program).toBe('docker');
    expect(dumpStep?.args.slice(0, 5)).toEqual(['exec', '-i', '-e', 'PGPASSWORD', 'db']);
    expect(dumpStep?.args[5]).toBe('pg_dump');
    expect(gpgStep?.program).toBe('/usr/local/bin/gpg2');
  });

  it('keeps the database password out of every argument and the bucket keys out of every step’s environment', async () => {
    expect(await run(DUMP)).toBe(0);
    for (const step of runner.runs[0]?.steps ?? []) {
      expect(step.args.join(' ')).not.toContain(OWNER_PASSWORD);
      for (const name of Object.keys(step.env)) {
        expect(name).not.toMatch(/^(BACKUP_S3_|DOCUMENTS_S3_|DATABASE_URL)/);
      }
    }
    expect(runner.runs[0]?.steps[0]?.env['PATH']).toBe('/usr/bin');
  });

  it(`after the upload deletes the db/ dumps older than ${RETENTION_DAYS} days and keeps the rest`, async () => {
    s3.plant('ijazah-backups', 'db/20261126T020000Z.dump.gpg', AGE.today);
    s3.plant('ijazah-backups', 'db/20261113T220000Z.dump.gpg', AGE.thirteenDays);
    s3.plant('ijazah-backups', 'db/20261111T220000Z.dump.gpg', AGE.fifteenDays);
    s3.plant('ijazah-backups', 'db/20261106T220000Z.dump.gpg', AGE.twentyDays);

    expect(await run(DUMP)).toBe(0);

    expect(s3.keys('ijazah-backups')).toEqual([
      'db/20261113T220000Z.dump.gpg',
      'db/20261126T020000Z.dump.gpg',
      'db/20261126T220304Z.dump.gpg',
    ]);
    expect(lines).toEqual([
      `out: backup dump: ok object=db/20261126T220304Z.dump.gpg bytes=${'ENCRYPTED DUMP BYTES'.length} pruned=2 (db/20261106T220000Z.dump.gpg db/20261111T220000Z.dump.gpg) kept=3`,
    ]);
  });

  it('never deletes an object outside db/, however old', async () => {
    s3.plant('ijazah-backups', 'db/20261006T220000Z.dump.gpg', AGE.fortyDays);
    s3.plant('ijazah-backups', 'docs/verification/a.pdf', AGE.fortyDays);
    s3.plant('ijazah-backups', 'docs-gone/verification/b.pdf', AGE.thirteenDays);
    s3.plant('ijazah-backups', 'dbx/20261006T220000Z.dump.gpg', AGE.fortyDays);

    expect(await run(DUMP)).toBe(0);

    expect(s3.keys('ijazah-backups')).toEqual([
      'db/20261126T220304Z.dump.gpg',
      'dbx/20261006T220000Z.dump.gpg',
      'docs-gone/verification/b.pdf',
      'docs/verification/a.pdf',
    ]);
  });

  it('never deletes the newest dump, even when every dump is older than the retention', async () => {
    const listing = [
      { key: 'db/20261006T220000Z.dump.gpg', lastModified: AGE.fortyDays },
      { key: 'db/20261106T220000Z.dump.gpg', lastModified: AGE.twentyDays },
      { key: 'db/20261111T220000Z.dump.gpg', lastModified: AGE.fifteenDays },
    ];
    expect(prunableDumps(listing, NOW)).toEqual([
      'db/20261006T220000Z.dump.gpg',
      'db/20261106T220000Z.dump.gpg',
    ]);

    // A server clock forty days ahead dates every dump, the new one too, past the retention.
    s3.clock = AGE.today;
    s3.plant('ijazah-backups', 'db/20261106T220000Z.dump.gpg', AGE.twentyDays);
    const ahead = new Date('2027-01-05T22:00:00Z');
    expect(await run(DUMP, { now: () => ahead })).toBe(0);
    expect(s3.keys('ijazah-backups')).toEqual(['db/20270105T220000Z.dump.gpg']);
  });

  it('removes the temporary file after the upload', async () => {
    expect(await run(DUMP)).toBe(0);
    expect(runner.runs[0]?.to?.startsWith(tempRoot)).toBe(true);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('removes the temporary file when gpg fails, and uploads nothing', async () => {
    runner.failing = ['gpg'];
    expect(await run(DUMP)).toBe(1);
    expect(lines).toEqual(['err: backup dump: failed (gpg_failed)']);
    expect(s3.keys('ijazah-backups')).toEqual([]);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('removes the temporary file when the upload fails', async () => {
    s3.failOn = (sent) =>
      sent.name === 'PutObjectCommand'
        ? Object.assign(new Error('denied'), { name: 'AccessDenied' })
        : undefined;
    expect(await run(DUMP)).toBe(1);
    expect(lines).toEqual(['err: backup dump: failed (upload_failed AccessDenied)']);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('says the dump is uploaded when the prune after it fails', async () => {
    s3.failOn = (sent) =>
      sent.name === 'ListObjectsV2Command'
        ? Object.assign(new Error('denied'), { name: 'AccessDenied' })
        : undefined;
    expect(await run(DUMP)).toBe(1);
    expect(lines).toEqual([
      'err: backup dump: failed (prune_failed AccessDenied): object=db/20261126T220304Z.dump.gpg is uploaded',
    ]);
  });
});

describe('copy-documents', () => {
  it('copies only the documents missing under docs/, with their content type', async () => {
    s3.plant('ijazah-documents', 'verification/a.pdf', AGE.twentyDays);
    s3.plant('ijazah-documents', 'verification/b.pdf', AGE.thirteenDays);
    s3.plant('ijazah-documents', 'signatures/c.png', AGE.today);
    s3.plant('ijazah-backups', 'docs/verification/a.pdf', AGE.fifteenDays, 'the copy of a');

    expect(await run(COPY)).toBe(0);

    expect(s3.keys('ijazah-backups')).toEqual([
      'docs/signatures/c.png',
      'docs/verification/a.pdf',
      'docs/verification/b.pdf',
    ]);
    expect(s3.text('ijazah-backups', 'docs/verification/a.pdf')).toBe('the copy of a');
    expect(s3.text('ijazah-backups', 'docs/verification/b.pdf')).toBe(
      'bytes of verification/b.pdf',
    );
    expect(s3.bucket('ijazah-backups').get('docs/signatures/c.png')?.contentType).toBe(
      'application/pdf',
    );
    const reads = s3.sent.filter((sent) => sent.name === 'GetObjectCommand');
    expect(reads.map((sent) => [sent.input['Bucket'], sent.input['Key']])).toEqual([
      ['ijazah-documents', 'signatures/c.png'],
      ['ijazah-documents', 'verification/b.pdf'],
    ]);
    expect(lines).toEqual(['out: backup copy-documents: ok copied=2 moved_gone=0 deleted_gone=0']);
  });

  it('moves the copy of a document gone from the documents bucket to docs-gone/, dated the night it was seen gone', async () => {
    s3.plant('ijazah-documents', 'verification/a.pdf', AGE.twentyDays);
    s3.plant('ijazah-backups', 'docs/verification/a.pdf', AGE.twentyDays);
    s3.plant('ijazah-backups', 'docs/verification/erased.pdf', AGE.twentyDays, 'the erased one');

    expect(await run(COPY)).toBe(0);

    expect(s3.keys('ijazah-backups')).toEqual([
      'docs-gone/verification/erased.pdf',
      'docs/verification/a.pdf',
    ]);
    expect(s3.text('ijazah-backups', 'docs-gone/verification/erased.pdf')).toBe('the erased one');
    expect(
      s3.bucket('ijazah-backups').get('docs-gone/verification/erased.pdf')?.lastModified,
    ).toEqual(NOW);
    expect(lines).toEqual([
      'out: backup copy-documents: ok copied=0 moved_gone=1 (docs/verification/erased.pdf) deleted_gone=0',
    ]);
  });

  it(`deletes docs-gone/ copies older than ${RETENTION_DAYS} days and keeps the younger ones`, async () => {
    s3.plant('ijazah-documents', 'verification/a.pdf', AGE.fortyDays);
    s3.plant('ijazah-backups', 'docs/verification/a.pdf', AGE.fortyDays);
    s3.plant('ijazah-backups', 'docs-gone/verification/old.pdf', AGE.fifteenDays);
    s3.plant('ijazah-backups', 'docs-gone/verification/young.pdf', AGE.thirteenDays);

    expect(await run(COPY)).toBe(0);

    expect(s3.keys('ijazah-backups')).toEqual([
      'docs-gone/verification/young.pdf',
      'docs/verification/a.pdf',
    ]);
    expect(lines).toEqual([
      'out: backup copy-documents: ok copied=0 moved_gone=0 deleted_gone=1 (docs-gone/verification/old.pdf)',
    ]);
  });

  it('fails with a reason code when a document cannot be read, and goes no further', async () => {
    s3.plant('ijazah-documents', 'verification/a.pdf', AGE.today);
    s3.plant('ijazah-backups', 'docs/verification/erased.pdf', AGE.twentyDays);
    s3.failOn = (sent) =>
      sent.name === 'GetObjectCommand'
        ? Object.assign(new Error('denied'), { name: 'AccessDenied' })
        : undefined;
    expect(await run(COPY)).toBe(1);
    expect(lines).toEqual(['err: backup copy-documents: failed (copy_failed AccessDenied)']);
    expect(s3.keys('ijazah-backups')).toEqual(['docs/verification/erased.pdf']);
  });
});

describe('restore', () => {
  beforeEach(() => {
    s3.plant('ijazah-backups', 'db/20261125T220000Z.dump.gpg', AGE.today, 'THE DUMP');
  });

  it('refuses no target, and downloads and runs nothing', async () => {
    expect(await run(restore(undefined))).toBe(1);
    expect(lines).toEqual(['err: backup restore: refused (target_missing)']);
    expect(runner.runs).toEqual([]);
    expect(s3.sent).toEqual([]);
  });

  it('refuses the owner’s database as a target, however the URL is spelled', async () => {
    for (const target of [
      ENV['DATABASE_URL_OWNER'] ?? '',
      'postgresql://someone:other@127.0.0.1:5433/ijazah',
    ]) {
      lines = [];
      expect(await run(restore(target))).toBe(1);
      expect(lines).toEqual(['err: backup restore: refused (target_is_runtime)']);
    }
    expect(runner.runs).toEqual([]);
    expect(s3.sent).toEqual([]);
  });

  it('refuses the application’s database as a target', async () => {
    const env = { ...ENV, DATABASE_URL: 'postgresql://ijazah_app:x@db.internal:5432/ijazah_live' };
    expect(
      await run(restore('postgresql://ijazah_owner:y@db.internal:5432/ijazah_live'), { env }),
    ).toBe(1);
    expect(lines).toEqual(['err: backup restore: refused (target_is_runtime)']);
    expect(runner.runs).toEqual([]);
  });

  it('refuses an object that is not a dump and a target that is not a URL', async () => {
    expect(await run(restore(RESTORE_TARGET, 'docs/verification/a.pdf'))).toBe(1);
    expect(await run(restore('not a url'))).toBe(1);
    expect(lines).toEqual([
      'err: backup restore: refused (object_not_a_dump)',
      'err: backup restore: refused (target_invalid)',
    ]);
    expect(runner.runs).toEqual([]);
  });

  it('downloads the object, decrypts it with the passphrase file and restores into the named target only', async () => {
    expect(await run(restore(RESTORE_TARGET))).toBe(0);

    expect(runner.runs).toHaveLength(1);
    const [only] = runner.runs;
    expect(only?.input).toBe('THE DUMP');
    expect(only?.from?.startsWith(tempRoot)).toBe(true);
    expect(only?.to).toBeUndefined();
    const [gpgStep, restoreStep] = only?.steps ?? [];
    expect(gpgStep?.name).toBe('gpg');
    expect(gpgStep?.args).toEqual([
      '--batch',
      '--pinentry-mode',
      'loopback',
      '--no-symkey-cache',
      '--passphrase-file',
      '/etc/ijazah/backup.passphrase',
      '--decrypt',
    ]);
    expect(restoreStep?.name).toBe('pg_restore');
    expect(restoreStep?.program).toBe('pg_restore');
    expect(restoreStep?.args).toEqual([
      '--exit-on-error',
      '--single-transaction',
      '--no-password',
      '--dbname=postgresql://ijazah_owner@db.internal:5432/ijazah_restored',
    ]);
    expect(restoreStep?.env['PGPASSWORD']).toBe('target-pass-in-spec');
    expect(lines).toEqual([
      'out: backup restore: ok object=db/20261125T220000Z.dump.gpg restored into the named target',
    ]);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('removes the temporary file when pg_restore fails', async () => {
    runner.failing = ['gpg', 'pg_restore'];
    expect(await run(restore(RESTORE_TARGET))).toBe(1);
    expect(lines).toEqual(['err: backup restore: failed (gpg_failed+pg_restore_failed)']);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it('fails with a reason code when the object is missing', async () => {
    expect(await run(restore(RESTORE_TARGET, 'db/20200101T000000Z.dump.gpg'))).toBe(1);
    expect(lines).toEqual(['err: backup restore: failed (download_failed NoSuchKey)']);
    expect(runner.runs).toEqual([]);
    expect(await readdir(tempRoot)).toEqual([]);
  });
});

describe('the environment and the logs', () => {
  it('refuses a command whose environment misses a value, naming the keys, and runs nothing', async () => {
    const { BACKUP_S3_BUCKET: _bucket, BACKUP_PASSPHRASE_FILE: _file, ...dumpEnv } = ENV;
    expect(await run(DUMP, { env: dumpEnv })).toBe(1);
    const { DOCUMENTS_S3_SECRET_ACCESS_KEY: _secret, ...copyEnv } = ENV;
    expect(await run(COPY, { env: copyEnv })).toBe(1);
    const { DATABASE_URL: _app, ...restoreEnv } = ENV;
    expect(await run(restore(RESTORE_TARGET), { env: restoreEnv })).toBe(1);
    expect(lines).toEqual([
      'err: backup dump: refused (missing_env BACKUP_PASSPHRASE_FILE,BACKUP_S3_BUCKET)',
      'err: backup copy-documents: refused (missing_env DOCUMENTS_S3_SECRET_ACCESS_KEY)',
      'err: backup restore: refused (missing_env DATABASE_URL)',
    ]);
    expect(runner.runs).toEqual([]);
    expect(s3.sent).toEqual([]);
  });

  it('puts no password, key or secret in any line, whatever fails', async () => {
    const leaky = (): Error =>
      Object.assign(new Error(`failed with ${SECRETS.join(' ')} ${ENV['DATABASE_URL_OWNER']}`), {
        name: `Leak ${BACKUP_SECRET}`,
        code: `${OWNER_PASSWORD}`,
      });
    s3.plant('ijazah-documents', 'verification/a.pdf', AGE.today);
    s3.plant('ijazah-backups', 'db/20261125T220000Z.dump.gpg', AGE.today);
    for (const failing of [
      'PutObjectCommand',
      'ListObjectsV2Command',
      'GetObjectCommand',
      undefined,
    ]) {
      s3.failOn = (sent) => (sent.name === failing ? leaky() : undefined);
      await run(DUMP);
      await run(COPY);
      await run(restore(RESTORE_TARGET));
    }
    s3.failOn = undefined;
    const throwing: Runner = {
      run: () => Promise.reject(leaky()),
    };
    await run(DUMP, { runner: throwing });
    await run(restore(RESTORE_TARGET), { runner: throwing });

    expect(lines.length).toBeGreaterThan(10);
    for (const line of lines) {
      for (const secret of [...SECRETS, 'target-pass-in-spec']) expect(line).not.toContain(secret);
      expect(line).not.toContain('postgresql://');
    }
    expect(lines).toContain('err: backup dump: failed (unexpected)');
  });
});

describe('the real runner', () => {
  const node = process.execPath;

  function step(name: string, script: string, env: Record<string, string> = {}): Step {
    return {
      name,
      program: node,
      args: ['-e', script],
      env: { ...process.env, ...env } as Record<string, string>,
    };
  }

  it('pipes the first program into the second and the second into the file', async () => {
    const file = join(tempRoot, 'out.bin');
    await spawnRunner.run(
      [
        step('pg_dump', 'process.stdout.write(process.env.WORD)', { WORD: 'dumped' }),
        step(
          'gpg',
          'process.stdin.on("data", (c) => process.stdout.write(String(c).toUpperCase()))',
        ),
      ],
      { to: file },
    );
    expect(await readFile(file, 'utf8')).toBe('DUMPED');
  });

  it('pipes a file into the first program and the first into the second', async () => {
    const from = join(tempRoot, 'in.bin');
    const seen = join(tempRoot, 'seen.txt');
    await writeFile(from, 'encrypted');
    await spawnRunner.run(
      [
        step('gpg', 'process.stdin.pipe(process.stdout)'),
        step(
          'pg_restore',
          `process.stdin.pipe(require("node:fs").createWriteStream(${JSON.stringify(seen)}))`,
        ),
      ],
      { from },
    );
    expect(await readFile(seen, 'utf8')).toBe('encrypted');
  });

  it('names every program that failed, and a program that is not there', async () => {
    const file = join(tempRoot, 'out.bin');
    await expect(
      spawnRunner.run([step('pg_dump', 'process.exit(3)'), step('gpg', 'process.stdin.resume()')], {
        to: file,
      }),
    ).rejects.toEqual(new StepFailure(['pg_dump']));
    await expect(
      spawnRunner.run(
        [
          step('gpg', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(2))'),
          { name: 'pg_restore', program: join(tempRoot, 'no-such-program'), args: [], env: {} },
        ],
        { from: file },
      ),
    ).rejects.toEqual(new StepFailure(['gpg', 'pg_restore']));
  });
});
