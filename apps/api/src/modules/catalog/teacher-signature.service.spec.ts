// T003 of specs/005-certification — catalog's signature service (FR-601, SRS FR-IJAZAH-12; research
// R-411; R-SEC-2, R-SEC-3): one current `teacher_signatures` row per teacher, replaced on upload.
//
// THE REPLACE PATH. The new file is stored under a key the server mints, outside any transaction;
// then, in one transaction, the teacher's `users` row is locked first (the one order's head; the row
// references it) and the current row read and replaced, its instant the database's clock. Only once
// that transaction has committed is the old file erased: never before, so a transaction refused at
// any point, its commit included, leaves the old file and the old row as they were, and erases the
// new file instead. A failed erasure leaves the new row and the answer, and writes one line of ids.
// No line names a key.
//
// THE LINK. `get` answers a signed link living `document_link_ttl_seconds`, and the instant; the
// null pair while none is held.
//
// Over stand-ins of the store, the transactions, the storage port and the clock that write every
// step into one ordered list, so the order is read, not inferred.
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { createLogger } from '../../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { SignatureRow, SignatureWrite } from './teacher-signature.repository.js';
import { TeacherSignatureService } from './teacher-signature.service.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000005c1';
const OTHER = '0199d0a0-0000-7000-8000-0000000005c2';
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const EARLIER = new Date('2026-11-01T08:00:00.000Z');
const NOW = new Date('2026-11-17T09:30:00.000Z');
const TTL = 300;

interface World {
  readonly service: TeacherSignatureService;
  /** Every step, in order. */
  readonly steps: string[];
  readonly rows: Map<string, SignatureRow & { teacherUserId: string }>;
  readonly files: Map<string, Uint8Array>;
  readonly lines: Record<string, unknown>[];
  readonly links: [string, number][];
}

interface Options {
  /** The write throws inside the transaction. */
  readonly writeFails?: boolean;
  /** The transaction's work resolves, then its commit is refused. */
  readonly commitFails?: boolean;
  /** Removing these keys rejects. */
  readonly removeFails?: (key: string) => boolean;
}

function worldOf(options: Options = {}): World {
  const steps: string[] = [];
  const rows = new Map<string, SignatureRow & { teacherUserId: string }>();
  const files = new Map<string, Uint8Array>();
  const lines: Record<string, unknown>[] = [];
  const links: [string, number][] = [];
  const tx = {} as Transaction;
  let ids = 0;

  const store = {
    lockAccount: async (on: Transaction, userId: string) => {
      expect(on).toBe(tx);
      steps.push(`lock users ${userId}`);
    },
    current: async (on: Transaction, teacherUserId: string) => {
      expect(on).toBe(tx);
      steps.push(`read ${teacherUserId}`);
      const row = rows.get(teacherUserId);
      return row === undefined
        ? null
        : { id: row.id, storageKey: row.storageKey, uploadedAt: row.uploadedAt };
    },
    write: async (on: Transaction, write: SignatureWrite): Promise<SignatureRow> => {
      expect(on).toBe(tx);
      steps.push(`write ${write.teacherUserId}`);
      if (options.writeFails === true) throw new Error('the write was refused');
      const id = rows.get(write.teacherUserId)?.id ?? `0199d0a0-0000-7000-8000-00000000f0${++ids}0`;
      const row = { id, storageKey: write.storageKey, uploadedAt: write.uploadedAt };
      rows.set(write.teacherUserId, { ...row, teacherUserId: write.teacherUserId });
      return row;
    },
  };
  const transactions = {
    run: async <T>(work: (on: Transaction) => Promise<T>): Promise<T> => {
      const before = new Map(rows);
      steps.push('begin');
      try {
        const result = await work(tx);
        if (options.commitFails === true) throw new Error('the commit was refused');
        steps.push('commit');
        return result;
      } catch (error: unknown) {
        rows.clear();
        for (const [key, row] of before) rows.set(key, row);
        steps.push('rollback');
        throw error;
      }
    },
  };
  const storage = {
    put: async (key: string, body: Uint8Array, contentType: string) => {
      steps.push(`put ${key} ${contentType}`);
      files.set(key, body);
    },
    remove: async (key: string) => {
      steps.push(`remove ${key}`);
      if (options.removeFails?.(key) === true) throw new Error('the store is unreachable');
      files.delete(key);
    },
    temporaryLink: async (key: string, seconds: number) => {
      links.push([key, seconds]);
      return `http://link.invalid/files/${encodeURIComponent(key)}?signature=stub`;
    },
  };
  const settings: SettingsReader = {
    read: async (key, schema) => {
      if (key === 'document_link_ttl_seconds') return schema.parse(TTL);
      throw new SettingError(key, 'missing');
    },
  };
  const log = createLogger({
    level: 'info',
    destination: { write: (line) => void lines.push(JSON.parse(line) as Record<string, unknown>) },
  });
  const service = new TeacherSignatureService({
    transactions,
    store,
    storage,
    settings,
    log,
    clock: async (on: Transaction) => {
      expect(on).toBe(tx);
      return NOW;
    },
  });
  return { service, steps, rows, files, lines, links };
}

/** A held signature for `teacher`, its file stored, as an earlier upload left it. */
function holding(world: World, teacher: string, key: string): void {
  world.rows.set(teacher, {
    id: '0199d0a0-0000-7000-8000-00000000f001',
    storageKey: key,
    uploadedAt: EARLIER,
    teacherUserId: teacher,
  });
  world.files.set(key, PNG_BYTES);
}

const OLD_KEY = `signatures/${TEACHER}/0199d0a0-old.png`;

/** The lines a message was logged with, without pino's own fields. */
function linesOf(world: World, message: string): Record<string, unknown>[] {
  return world.lines
    .filter((line) => line['msg'] === message)
    .map(({ msg: _msg, level: _level, time: _time, pid: _pid, hostname: _host, ...rest }) => rest);
}

describe('the replace path (T003 of specs/005-certification)', () => {
  it('stores a first signature under a key the server mints, and writes its one row', async () => {
    const world = worldOf();
    await expect(
      world.service.replace(TEACHER, { type: 'image/png', bytes: PNG_BYTES }),
    ).resolves.toStrictEqual({ uploadedAt: NOW.toISOString() });
    expect(world.rows.size).toBe(1);
    const row = world.rows.get(TEACHER);
    expect(row?.uploadedAt).toEqual(NOW);
    expect(row?.storageKey).toMatch(new RegExp(`^signatures/${TEACHER}/[0-9a-f-]{36}\\.png$`));
    expect(world.files.get(row?.storageKey ?? '')).toEqual(PNG_BYTES);
  });

  it('names a JPEG’s key .jpg and stores it as image/jpeg', async () => {
    const world = worldOf();
    await world.service.replace(TEACHER, { type: 'image/jpeg', bytes: JPEG_BYTES });
    const key = world.rows.get(TEACHER)?.storageKey ?? '';
    expect(key).toMatch(/\.jpg$/);
    expect(world.steps[0]).toBe(`put ${key} image/jpeg`);
  });

  it('replaces the held row, one row with the new key, and erases the old file only after the commit', async () => {
    const world = worldOf();
    holding(world, TEACHER, OLD_KEY);
    await world.service.replace(TEACHER, { type: 'image/png', bytes: PNG_BYTES });
    expect(world.rows.size).toBe(1);
    const key = world.rows.get(TEACHER)?.storageKey ?? '';
    expect(key).not.toBe(OLD_KEY);
    expect(world.steps).toEqual([
      `put ${key} image/png`,
      'begin',
      `lock users ${TEACHER}`,
      `read ${TEACHER}`,
      `write ${TEACHER}`,
      'commit',
      `remove ${OLD_KEY}`,
    ]);
    expect(world.files.has(OLD_KEY)).toBe(false);
    expect(world.files.has(key)).toBe(true);
  });

  it('logs the erasure, an automatic action, by ids alone', async () => {
    const world = worldOf();
    holding(world, TEACHER, OLD_KEY);
    await world.service.replace(TEACHER, { type: 'image/png', bytes: PNG_BYTES });
    expect(linesOf(world, 'The replaced signature file was erased')).toEqual([
      { teacherUserId: TEACHER, signatureId: '0199d0a0-0000-7000-8000-00000000f001' },
    ]);
    expect(JSON.stringify(world.lines)).not.toContain('signatures/');
  });

  it('touches only the caller’s row', async () => {
    const world = worldOf();
    holding(world, OTHER, `signatures/${OTHER}/0199d0a0-other.png`);
    await world.service.replace(TEACHER, { type: 'image/png', bytes: PNG_BYTES });
    expect(world.rows.get(OTHER)?.storageKey).toBe(`signatures/${OTHER}/0199d0a0-other.png`);
    expect(world.files.has(`signatures/${OTHER}/0199d0a0-other.png`)).toBe(true);
  });

  it('erases the new file and keeps the old file and row when the write is refused', async () => {
    const world = worldOf({ writeFails: true });
    holding(world, TEACHER, OLD_KEY);
    await expect(
      world.service.replace(TEACHER, { type: 'image/png', bytes: PNG_BYTES }),
    ).rejects.toThrow('the write was refused');
    expect(world.rows.get(TEACHER)?.storageKey).toBe(OLD_KEY);
    expect([...world.files.keys()]).toEqual([OLD_KEY]);
    expect(world.steps).not.toContain(`remove ${OLD_KEY}`);
  });

  it('erases nothing of the old signature when the commit itself is refused', async () => {
    const world = worldOf({ commitFails: true });
    holding(world, TEACHER, OLD_KEY);
    await expect(
      world.service.replace(TEACHER, { type: 'image/png', bytes: PNG_BYTES }),
    ).rejects.toThrow('the commit was refused');
    expect(world.rows.get(TEACHER)?.storageKey).toBe(OLD_KEY);
    expect(world.files.has(OLD_KEY)).toBe(true);
    expect(world.steps).not.toContain(`remove ${OLD_KEY}`);
    expect(world.files.size).toBe(1);
  });

  it('keeps the new row and answers the upload when the old file cannot be erased, logging ids alone', async () => {
    const world = worldOf({ removeFails: (key) => key === OLD_KEY });
    holding(world, TEACHER, OLD_KEY);
    await expect(
      world.service.replace(TEACHER, { type: 'image/png', bytes: PNG_BYTES }),
    ).resolves.toStrictEqual({ uploadedAt: NOW.toISOString() });
    const key = world.rows.get(TEACHER)?.storageKey ?? '';
    expect(key).not.toBe(OLD_KEY);
    expect(world.files.has(key)).toBe(true);
    expect(linesOf(world, 'The replaced signature file could not be erased')).toEqual([
      { teacherUserId: TEACHER, signatureId: '0199d0a0-0000-7000-8000-00000000f001' },
    ]);
    expect(JSON.stringify(world.lines)).not.toContain('signatures/');
  });
});

describe('the signature’s link (T003 of specs/005-certification)', () => {
  it('answers the null pair while no signature is held, issuing no link', async () => {
    const world = worldOf();
    await expect(world.service.get(TEACHER)).resolves.toStrictEqual({
      link: null,
      uploadedAt: null,
    });
    expect(world.links).toEqual([]);
  });

  it('answers a signed link living document_link_ttl_seconds, and the instant (R-SEC-3)', async () => {
    const world = worldOf();
    holding(world, TEACHER, OLD_KEY);
    await expect(world.service.get(TEACHER)).resolves.toStrictEqual({
      link: `http://link.invalid/files/${encodeURIComponent(OLD_KEY)}?signature=stub`,
      uploadedAt: EARLIER.toISOString(),
    });
    expect(world.links).toEqual([[OLD_KEY, TTL]]);
  });
});
