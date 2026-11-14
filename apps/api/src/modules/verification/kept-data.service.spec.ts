// T077 of specs/004-sessions/tasks.md (FR-509; SRS FR-ADMIN-21, DEC-67; the note under T077, Q-R3 (a),
// Q-R4 (a), Q-R5 (a), Q-R13 (a), N3; contracts/kernel.md, the kept data's row) — the administrator's
// control of a deleted teacher's kept data, over a recorded store (the real tables are
// `tests/db-integrity/kept-data.spec.ts`'). Written before the service, and run red first on a stub.
//
// Each action takes the profile's lock, then its kept documents' in id order, and reads the profile
// and the documents again under them; a person with no kept profile is `NOT_FOUND`, an erased one
// `CONFLICT` `already_erased`, a document not kept for that teacher `NOT_FOUND`, a date less than 24
// hours ahead `CONFLICT` `erase_date_too_soon`; each refusal writes nothing and one info line of ids
// and its cause, never a key or a payout value. The two writes are keyed through `runOn`; a replay
// answers the first outcome and writes nothing.
import { addHours, addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { KeptProfile } from '../identity/index.js';
import {
  createKeptData,
  ERASE_DATE_MIN_HOURS_AHEAD,
  type KeptDataStore,
} from './kept-data.service.js';
import type { KeptDocument } from './verification.repository.js';

const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000c1';
const OTHER = '0199d0a0-0000-7000-8000-0000000000c2';
const PROFILE = '0199d0a0-0000-7000-8000-0000000000f1';
const DOC_A = '0199d0a0-0000-7000-8000-0000000000d1';
const DOC_B = '0199d0a0-0000-7000-8000-0000000000d2';
const OTHER_DOC = '0199d0a0-0000-7000-8000-0000000000d9';
const NOW = new Date('2026-11-14T10:00:00.000Z');
const TX = {} as Transaction;
const KEY = 'kept-data-attempt-000001';

interface World {
  profile: KeptProfile | null;
  documents: KeptDocument[];
  readonly calls: string[];
  readonly lines: { entry: object; message: string }[];
  readonly links: string[];
  readonly keys: Map<string, unknown>;
}

function world(profile: Partial<KeptProfile> | null = {}): World {
  return {
    profile:
      profile === null
        ? null
        : {
            profileId: PROFILE,
            userId: TEACHER,
            keptAt: new Date('2026-11-01T09:00:00.000Z'),
            eraseAt: null,
            erasedAt: null,
            payoutKept: true,
            ...profile,
          },
    documents: [
      {
        id: DOC_A,
        documentType: 'national_id',
        uploadedAt: new Date('2026-10-01T08:00:00.000Z'),
        storageKeyEncrypted: Uint8Array.from([1]),
      },
      {
        id: DOC_B,
        documentType: 'credential',
        uploadedAt: new Date('2026-10-02T08:00:00.000Z'),
        storageKeyEncrypted: Uint8Array.from([2]),
      },
    ],
    calls: [],
    lines: [],
    links: [],
    keys: new Map(),
  };
}

function storeOver(w: World): KeptDataStore {
  return {
    lockProfile: async (_tx, userId) => void w.calls.push(`lock profile ${userId}`),
    profileOf: async (_tx, userId) => {
      w.calls.push('read profile');
      return w.profile?.userId === userId ? w.profile : null;
    },
    documentsOf: async (_tx, userId) => {
      w.calls.push('read documents');
      return w.profile?.userId === userId ? w.documents : [];
    },
    lockDocuments: async (_tx, ids) => void w.calls.push(`lock documents ${ids.join(',')}`),
    setEraseDate: async (_tx, profileId, at) => {
      w.calls.push(`set date ${profileId} ${at === null ? 'null' : at.toISOString()}`);
      if (w.profile !== null) w.profile = { ...w.profile, eraseAt: at };
      return true;
    },
    eraseProfile: async (_tx, profileId, at) => {
      w.calls.push(`erase profile ${profileId} ${at.toISOString()}`);
      if (w.profile !== null) w.profile = { ...w.profile, erasedAt: at, payoutKept: false };
      return true;
    },
    eraseDocuments: async (_tx, ids, at) => {
      w.calls.push(`erase documents ${ids.join(',')} ${at.toISOString()}`);
      w.documents = [];
      return ids.length;
    },
    duePage: async () => [],
    payoutKeptOnDeletedTeacher: async () => false,
  };
}

function serviceOver(w: World) {
  return createKeptData({
    storage: {
      temporaryLink: async (key, ttl) => {
        w.links.push(key);
        return `https://storage.invalid/${key}?ttl=${String(ttl)}`;
      },
    },
    cipher: { decrypt: (_value, column, id) => `${column}:${id}` },
    settings: {
      read: async (key, schema) => {
        if (key !== 'document_link_ttl_seconds') throw new Error(`unexpected setting ${key}`);
        return schema.parse(300);
      },
    },
    log: {
      info: ((entry: object, message: string) => void w.lines.push({ entry, message })) as never,
    },
    idempotency: {
      runOn: async (_tx, request, effect) => {
        const id = `${request.scope}:${request.key}`;
        if (w.keys.has(id)) return { outcome: w.keys.get(id) as never, replayed: true };
        const outcome = await effect(TX);
        w.keys.set(id, outcome);
        return { outcome, replayed: false };
      },
    },
    clock: async () => NOW,
    store: storeOver(w),
  });
}

async function refusalOf(call: Promise<unknown>): Promise<{ code: string; details?: unknown }> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return thrown as { code: string; details?: unknown };
}

const WRITES = /^(set date|erase )/;

describe('teachers.keptData.documentLink (T077, FR-509)', () => {
  it('mints one link to a kept document, its key decrypted for its row, valid document_link_ttl_seconds', async () => {
    const w = world();
    const link = await serviceOver(w).documentLink(TX, ADMIN, {
      teacherUserId: TEACHER,
      documentId: DOC_B,
    });
    expect(link).toEqual({
      url: `https://storage.invalid/verification_documents.storage_key_encrypted:${DOC_B}?ttl=300`,
      expiresAt: '2026-11-14T10:05:00Z',
    });
    expect(w.links).toHaveLength(1);
  });

  it('takes the profile’s lock, then the kept documents’ in id order, and reads both again under them (Q-R4 (a))', async () => {
    const w = world();
    await serviceOver(w).documentLink(TX, ADMIN, { teacherUserId: TEACHER, documentId: DOC_A });
    expect(w.calls).toEqual([
      `lock profile ${TEACHER}`,
      'read documents',
      `lock documents ${DOC_A},${DOC_B}`,
      'read profile',
      'read documents',
    ]);
  });

  it.each([
    ['a person with no kept profile', null, DOC_A, 'NOT_FOUND', 'not_kept'],
    [
      'an erased profile',
      { erasedAt: new Date('2026-11-10T00:00:00Z') },
      DOC_A,
      'CONFLICT',
      'already_erased',
    ],
    ['a document not kept for that teacher', {}, OTHER_DOC, 'NOT_FOUND', 'document_not_kept'],
  ] as const)(
    'refuses %s, minting nothing, with one info line of ids and its cause',
    async (_name, profile, documentId, code, cause) => {
      const w = world(profile);
      const refusal = await refusalOf(
        serviceOver(w).documentLink(TX, ADMIN, { teacherUserId: TEACHER, documentId }),
      );
      expect(refusal.code).toBe(code);
      if (code === 'CONFLICT') expect(refusal.details).toEqual([{ path: 'cause', code: cause }]);
      expect(w.links).toEqual([]);
      expect(w.lines).toEqual([
        {
          entry: { adminId: ADMIN, userId: TEACHER, documentId, errorCode: code, cause },
          message: expect.any(String),
        },
      ]);
    },
  );
});

describe('teachers.keptData.setEraseDate (T077, FR-509; Q-K1 (a))', () => {
  /** The instant `hours` and `seconds` from NOW, as the service answers it. */
  const at = (hours: number, seconds = 0) =>
    new Date(addSeconds(new Date(addHours(NOW, hours)), seconds)).toISOString();
  /** That instant as a wall clock in a zone at UTC+0 with no clock change, to the minute (R-TIME-6). */
  const utc = (hours: number, seconds = 0) => {
    const instant = at(hours, seconds);
    return {
      localDate: instant.slice(0, 10),
      localTime: instant.slice(11, 16),
      timezone: 'Africa/Abidjan',
    };
  };
  const cairo = (localDate: string, localTime: string) => ({
    localDate,
    localTime,
    timezone: 'Africa/Cairo',
  });
  type WallClock = { localDate: string; localTime: string; timezone: string };
  const set = (w: World, eraseAt: WallClock | null, key = KEY) =>
    serviceOver(w).setEraseDate(TX, ADMIN, {
      teacherUserId: TEACHER,
      eraseAt,
      reason: 'انتهت الحاجة',
      idempotencyKey: key,
    });

  it('the line fixes the bound: 24 hours (FR-509, T077)', () => {
    expect(ERASE_DATE_MIN_HOURS_AHEAD).toBe(24);
  });

  it('sets, changes and clears the date, answering it before and after as instants', async () => {
    const w = world();
    expect(await set(w, utc(48), 'k-1')).toEqual({ before: null, after: at(48), replayed: false });
    expect(await set(w, utc(24), 'k-2')).toEqual({
      before: at(48),
      after: at(24),
      replayed: false,
    });
    expect(await set(w, null, 'k-3')).toEqual({ before: at(24), after: null, replayed: false });
    expect(w.calls.filter((call) => WRITES.test(call))).toEqual([
      `set date ${PROFILE} ${at(48)}`,
      `set date ${PROFILE} ${at(24)}`,
      `set date ${PROFILE} null`,
    ]);
  });

  it('resolves a wall clock in its own zone through packages/time: 12:00 in Cairo is 10:00 UTC', async () => {
    const w = world();
    expect(await set(w, cairo('2026-11-16', '12:00'))).toEqual({
      before: null,
      after: '2026-11-16T10:00:00.000Z',
      replayed: false,
    });
  });

  it('judges the 24 hours on the resolved instant against the database clock, not on the wall clock', async () => {
    // NOW is 2026-11-14 10:00 UTC, 12:00 in Cairo: 12:00 the next day there is exactly 24 h ahead.
    const w = world();
    expect((await set(w, cairo('2026-11-15', '12:00'), 'k-1')).after).toBe(
      '2026-11-15T10:00:00.000Z',
    );
    const refusal = await refusalOf(set(w, cairo('2026-11-15', '11:59'), 'k-2'));
    expect(refusal.details).toEqual([{ path: 'cause', code: 'erase_date_too_soon' }]);
  });

  it('answers a replay the first outcome and writes nothing', async () => {
    const w = world();
    await set(w, utc(48));
    expect(await set(w, utc(48))).toEqual({ before: null, after: at(48), replayed: true });
    expect(w.calls.filter((call) => WRITES.test(call))).toHaveLength(1);
  });

  it.each([
    ['a date less than 24 hours ahead', {}, utc(24, -60), 'CONFLICT', 'erase_date_too_soon'],
    ['a date already passed', {}, utc(-1), 'CONFLICT', 'erase_date_too_soon'],
    [
      'a zone packages/time does not know',
      {},
      { ...utc(48), timezone: 'Mars/Olympus' },
      'VALIDATION_FAILED',
      'unknown_zone',
    ],
    ['a person with no kept profile', null, utc(48), 'NOT_FOUND', 'not_kept'],
    [
      'an erased profile',
      { erasedAt: new Date('2026-11-10T00:00:00Z') },
      null,
      'CONFLICT',
      'already_erased',
    ],
  ] as const)(
    'refuses %s, writing nothing, with one info line',
    async (_name, profile, eraseAt, code, cause) => {
      const w = world(profile);
      const refusal = await refusalOf(set(w, eraseAt));
      expect(refusal.code).toBe(code);
      if (code === 'CONFLICT') expect(refusal.details).toEqual([{ path: 'cause', code: cause }]);
      expect(w.calls.filter((call) => WRITES.test(call))).toEqual([]);
      expect(w.lines).toEqual([
        {
          entry: { adminId: ADMIN, userId: TEACHER, errorCode: code, cause },
          message: expect.any(String),
        },
      ]);
    },
  );
});

describe('teachers.keptData.eraseNow (T077, FR-509) ⚠️ final', () => {
  const erase = (w: World, key = KEY) =>
    serviceOver(w).eraseNow(TX, ADMIN, {
      teacherUserId: TEACHER,
      reason: 'طلب الجهات',
      idempotencyKey: key,
    });

  it('erases the kept documents and the payout reference under the locks, with one info line', async () => {
    const w = world();
    expect(await erase(w)).toEqual({ documents: 2, payout: true, replayed: false });
    expect(w.calls).toEqual([
      `lock profile ${TEACHER}`,
      'read documents',
      `lock documents ${DOC_A},${DOC_B}`,
      'read profile',
      'read documents',
      `erase documents ${DOC_A},${DOC_B} ${NOW.toISOString()}`,
      `erase profile ${PROFILE} ${NOW.toISOString()}`,
    ]);
    expect(w.lines).toEqual([
      {
        entry: { userId: TEACHER, reason: 'erase_now', documents: 2, payout: true },
        message: expect.any(String),
      },
    ]);
  });

  it('answers a replay the first outcome, erasing nothing more and writing no second line', async () => {
    const w = world();
    await erase(w);
    expect(await erase(w)).toEqual({ documents: 2, payout: true, replayed: true });
    expect(w.calls.filter((call) => WRITES.test(call))).toHaveLength(2);
    expect(w.lines).toHaveLength(1);
  });

  it.each([
    ['a person with no kept profile', null, 'NOT_FOUND', 'not_kept'],
    [
      'an erased profile',
      { erasedAt: new Date('2026-11-10T00:00:00Z') },
      'CONFLICT',
      'already_erased',
    ],
  ] as const)(
    'refuses %s, erasing nothing, with one info line',
    async (_name, profile, code, cause) => {
      const w = world(profile);
      const refusal = await refusalOf(erase(w));
      expect(refusal.code).toBe(code);
      expect(w.calls.filter((call) => WRITES.test(call))).toEqual([]);
      expect(w.lines).toEqual([
        {
          entry: { adminId: ADMIN, userId: TEACHER, errorCode: code, cause },
          message: expect.any(String),
        },
      ]);
    },
  );
});

describe('users.get’s kept data (T077, N3)', () => {
  it('answers a kept profile’s documents by metadata only, the payout kept, the two dates', async () => {
    const w = world({ eraseAt: new Date('2026-12-01T08:00:00.000Z') });
    expect(await serviceOver(w).keptDataOf(TX, TEACHER)).toEqual({
      documents: [
        { id: DOC_A, kind: 'national_id', uploadedAt: '2026-10-01T08:00:00.000Z' },
        { id: DOC_B, kind: 'credential', uploadedAt: '2026-10-02T08:00:00.000Z' },
      ],
      payoutKept: true,
      eraseAt: '2026-12-01T08:00:00.000Z',
      erasedAt: null,
    });
    expect(w.calls.some((call) => call.startsWith('lock'))).toBe(false);
  });

  it('answers a teacher who keeps nothing as nothing kept', async () => {
    expect(await serviceOver(world(null)).keptDataOf(TX, OTHER)).toEqual({
      documents: [],
      payoutKept: false,
      eraseAt: null,
      erasedAt: null,
    });
  });
});
