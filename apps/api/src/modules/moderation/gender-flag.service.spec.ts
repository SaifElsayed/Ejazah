// T013 of specs/005-certification — gender flags over a store, a `Pairings` port and an idempotency
// held in memory (FR-613, FR-614, FR-615; SRS FR-GENDER-3; research R-409; R-GENDER-2, R-GENDER-4;
// the note under T013, Q-G1 (a)). Written before the service, run red against its stub, and each
// negative case red again under its named mutant (lane D's `mutants\`).
//
// genderFlags.raise (the user's)
// - a person the caller is paired with (`Pairings.paired`) or, a student, is shown
//   (`visibleTeachers` for the session's own gender): received; anyone else, a teacher caller's flag
//   of a student they are not paired with included, NOT_FOUND in the shape of a person who does not
//   exist (R-GENDER-2), with no lock and no insert;
// - `open_exists` (CONFLICT) from the one-open rule; a refused insert rolls the call back;
// - the locks: both accounts by key share in one call, then the insert (kernel.md);
// - keyed (`genderFlags.raise`); the answer `{ received: true }`;
// - every line ids and a reason: never the flag's reason or a gender.
//
// The administrator's: `raiseByAdministrator` (a live person; a report about that person; no raiser;
// `open_exists`; keyed, a replay writing nothing), `list`, `detail`, `dismiss` (one conditional write
// at the database's instant; `already_resolved`; NOT_FOUND; keyed).
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { GenderFlagRow, NewGenderFlag } from './gender-flag.repository.js';
import { createGenderFlags, type FlagCaller, type GenderFlagStore } from './gender-flag.service.js';

const STUDENT = '0199d0a0-0000-7000-8000-00000000b0a1';
const TEACHER = '0199d0a0-0000-7000-8000-00000000b0a2';
const VISIBLE_TEACHER = '0199d0a0-0000-7000-8000-00000000b0a4';
const OTHER_GENDER_TEACHER = '0199d0a0-0000-7000-8000-00000000b0a5';
const UNPAIRED_STUDENT = '0199d0a0-0000-7000-8000-00000000b0a6';
const MISSING = '0199d0a0-0000-7000-8000-00000000b0ff';
const FLAG = '0199d0a0-0000-7000-8000-00000000b0f1';
const REPORT = '0199d0a0-0000-7000-8000-00000000b0c1';
const OTHER_REPORT = '0199d0a0-0000-7000-8000-00000000b0c2';
const ADMIN = '0199d0a0-0000-7000-8000-00000000b0b9';
const KEY = 'flag-key-for-the-spec-0001';
const REASON = 'سرّ لا يُكتب في السجل: الصوت لا يطابق';
const AT = new Date('2026-11-18T10:00:00.000Z');
const PAGE_SIZE = 2;

const TX = {} as Transaction;

const student: FlagCaller = { userId: STUDENT, role: 'student', gender: 'male' as RequesterGender };
const teacher: FlagCaller = { userId: TEACHER, role: 'teacher', gender: 'male' as RequesterGender };

let calls: { name: string; args: unknown[] }[];
let lines: { fields: Record<string, unknown>; message: string }[];
let inserted: NewGenderFlag[];
let keyed: IdempotentRequest[];
let replay: boolean;
let replayOutcome: unknown;
let insertAnswers: (string | null)[];
let rows: Map<string, GenderFlagRow>;
let resolveAnswer: boolean;
let pages: { status: string; after?: string | undefined; take: number }[];

beforeEach(() => {
  calls = [];
  lines = [];
  inserted = [];
  keyed = [];
  replay = false;
  replayOutcome = { flagId: FLAG };
  insertAnswers = [FLAG];
  rows = new Map();
  resolveAnswer = true;
  pages = [];
});

const log = {
  info: (fields: Record<string, unknown>, message: string) => void lines.push({ fields, message }),
};

/** `STUDENT` and `TEACHER` are paired; nobody else is. */
const pairings = {
  paired: async (_tx: Transaction, userId: string, otherUserId: string) => {
    calls.push({ name: 'paired', args: [userId, otherUserId] });
    const pair = new Set([userId, otherUserId]);
    return pair.size === 2 && pair.has(STUDENT) && pair.has(TEACHER);
  },
};

const store: GenderFlagStore = {
  visibleTeacher: async (_tx, requester, teacherUserId) => {
    calls.push({ name: 'visibleTeacher', args: [requester, teacherUserId] });
    return teacherUserId === VISIBLE_TEACHER || teacherUserId === TEACHER;
  },
  livePerson: async (_tx, userId) => {
    calls.push({ name: 'livePerson', args: [userId] });
    return userId !== MISSING;
  },
  reportedUserOf: async (_tx, reportId) => {
    calls.push({ name: 'reportedUserOf', args: [reportId] });
    if (reportId === REPORT) return TEACHER;
    if (reportId === OTHER_REPORT) return STUDENT;
    return null;
  },
  keyShareAccounts: async (_tx, userIds) => {
    calls.push({ name: 'keyShareAccounts', args: [userIds] });
  },
  insert: async (_tx, row) => {
    calls.push({ name: 'insert', args: [row] });
    const answer = insertAnswers.shift() ?? null;
    if (answer !== null) inserted.push(row);
    return answer;
  },
  flagOf: async (_tx, flagId) => rows.get(flagId) ?? null,
  page: async (_tx, query) => {
    pages.push(query);
    return [...rows.values()];
  },
  resolve: async (_tx, resolution) => {
    calls.push({ name: 'resolve', args: [resolution] });
    return resolveAnswer;
  },
};

const settings: SettingsReader = {
  read: async (key, schema) => schema.parse(key === 'admin_list_page_size' ? PAGE_SIZE : undefined),
};

/** The kernel's idempotency, held in memory: a replay answers a stored outcome and runs nothing. */
const idempotency = {
  run: async <T>(request: IdempotentRequest, effect: (tx: Transaction) => Promise<T>) => {
    keyed.push(request);
    if (replay) return { received: true } as T;
    return effect(TX);
  },
  runOn: async <T>(
    tx: Transaction,
    request: IdempotentRequest,
    effect: (tx: Transaction) => Promise<T>,
  ) => {
    keyed.push(request);
    if (replay) return { outcome: replayOutcome as T, replayed: true };
    return { outcome: await effect(tx), replayed: false };
  },
};

const service = createGenderFlags({
  idempotency: idempotency as never,
  pairings,
  settings,
  clock: async () => AT,
  store,
});

function raise(caller: FlagCaller, flaggedUserId: string) {
  return service.raise(caller, { flaggedUserId, reason: REASON, idempotencyKey: KEY }, log);
}

function shapeOf(error: unknown) {
  expect(error).toBeInstanceOf(DomainError);
  const { code, message, details } = error as DomainError;
  return { code, message, details };
}

/** What a person who does not exist answers: the one NOT_FOUND shape (R-GENDER-2). */
async function nonexistentShape(): Promise<unknown> {
  const thrown = await raise(student, MISSING).catch((e: unknown) => e);
  calls = [];
  lines = [];
  return shapeOf(thrown);
}

const names = () => calls.map(({ name }) => name);

function noLineCarries(text: string) {
  for (const { fields, message } of lines) {
    expect(JSON.stringify(fields)).not.toContain(text);
    expect(message).not.toContain(text);
  }
}

describe('genderFlags.raise (the user)', () => {
  it('admits a person the caller is paired with: the accounts key-shared, then the insert', async () => {
    expect(await raise(teacher, STUDENT)).toEqual({ received: true });
    expect(names()).toEqual(['paired', 'keyShareAccounts', 'insert']);
    expect(calls[1]?.args).toEqual([[TEACHER, STUDENT]]);
    expect(inserted).toEqual([
      { flaggedUserId: STUDENT, raisedByUserId: TEACHER, reportId: null, reason: REASON },
    ]);
    expect(keyed).toEqual([
      {
        scope: 'genderFlags.raise',
        key: KEY,
        actorId: TEACHER,
        input: { flaggedUserId: STUDENT, reason: REASON },
      },
    ]);
  });

  it("admits a teacher the student is shown, read for the session's own gender", async () => {
    expect(await raise(student, VISIBLE_TEACHER)).toEqual({ received: true });
    expect(calls.find(({ name }) => name === 'visibleTeacher')?.args).toEqual([
      'male',
      VISIBLE_TEACHER,
    ]);
    expect(inserted).toEqual([
      { flaggedUserId: VISIBLE_TEACHER, raisedByUserId: STUDENT, reportId: null, reason: REASON },
    ]);
  });

  it('refuses a teacher the student is neither paired with nor shown, as a person who does not exist', async () => {
    const shape = await nonexistentShape();
    const thrown = await raise(student, OTHER_GENDER_TEACHER).catch((e: unknown) => e);
    expect(shapeOf(thrown)).toEqual(shape);
    expect((thrown as DomainError).code).toBe('NOT_FOUND');
    expect(isRefusalLogged(thrown)).toBe(true);
    expect(names()).not.toContain('keyShareAccounts');
    expect(names()).not.toContain('insert');
    expect(lines).toEqual([
      {
        fields: {
          userId: STUDENT,
          flaggedUserId: OTHER_GENDER_TEACHER,
          errorCode: 'NOT_FOUND',
          reason: 'not_paired_or_visible',
        },
        message: 'A gender flag call was refused',
      },
    ]);
  });

  it("refuses a teacher's flag of a student they are not paired with, never asking visibility", async () => {
    const shape = await nonexistentShape();
    const thrown = await raise(teacher, UNPAIRED_STUDENT).catch((e: unknown) => e);
    expect(shapeOf(thrown)).toEqual(shape);
    expect(names()).toEqual(['paired']);
  });

  it('refuses open_exists when the person already has an open flag', async () => {
    insertAnswers = [null];
    const thrown = await raise(teacher, STUDENT).catch((e: unknown) => e);
    expect(shapeOf(thrown)).toEqual({
      code: 'CONFLICT',
      message: expect.any(String),
      details: [{ path: 'flaggedUserId', code: 'open_exists' }],
    });
    expect(isRefusalLogged(thrown)).toBe(true);
    expect(lines.at(-1)).toEqual({
      fields: {
        userId: TEACHER,
        flaggedUserId: STUDENT,
        errorCode: 'CONFLICT',
        reason: 'open_exists',
      },
      message: 'A gender flag call was refused',
    });
  });

  it('logs a flag received by ids only, and no line ever carries the reason', async () => {
    await raise(teacher, STUDENT);
    expect(lines).toEqual([
      {
        fields: { flagId: FLAG, userId: TEACHER, flaggedUserId: STUDENT },
        message: 'A gender flag was received',
      },
    ]);
    insertAnswers = [null];
    await raise(teacher, STUDENT).catch(() => undefined);
    await raise(student, OTHER_GENDER_TEACHER).catch(() => undefined);
    noLineCarries(REASON);
    noLineCarries('male');
  });
});

describe('genderFlags.raise (an administrator)', () => {
  const raiseAs = (input: object) =>
    service.raiseByAdministrator(
      TX,
      ADMIN,
      { targetUserId: TEACHER, reason: REASON, idempotencyKey: KEY, ...input },
      log,
    );

  it('flags a live person with no raiser, keyed on the transaction', async () => {
    expect(await raiseAs({})).toEqual({ flagId: FLAG, replayed: false });
    expect(names()).toEqual(['livePerson', 'keyShareAccounts', 'insert']);
    expect(calls[1]?.args).toEqual([[TEACHER]]);
    expect(inserted).toEqual([
      { flaggedUserId: TEACHER, raisedByUserId: null, reportId: null, reason: REASON },
    ]);
    expect(keyed).toEqual([
      {
        scope: 'genderFlags.raise',
        key: KEY,
        actorId: ADMIN,
        input: { targetUserId: TEACHER, reason: REASON },
      },
    ]);
  });

  it('stores the report it is raised from when the report is about that person', async () => {
    await raiseAs({ reportId: REPORT });
    expect(inserted).toEqual([
      { flaggedUserId: TEACHER, raisedByUserId: null, reportId: REPORT, reason: REASON },
    ]);
    expect(keyed[0]?.input).toEqual({ targetUserId: TEACHER, reason: REASON, reportId: REPORT });
  });

  it('refuses NOT_FOUND for no person and an unknown report, writing nothing', async () => {
    for (const input of [{ targetUserId: MISSING }, { reportId: MISSING }]) {
      calls = [];
      const thrown = await raiseAs(input).catch((e: unknown) => e);
      expect((thrown as DomainError).code).toBe('NOT_FOUND');
      expect(isRefusalLogged(thrown)).toBe(true);
      expect(names()).not.toContain('insert');
    }
  });

  it('refuses report_target_mismatch for a report about another person, writing nothing', async () => {
    const thrown = await raiseAs({ reportId: OTHER_REPORT }).catch((e: unknown) => e);
    expect(shapeOf(thrown)).toEqual({
      code: 'CONFLICT',
      message: expect.any(String),
      details: [{ path: 'reportId', code: 'report_target_mismatch' }],
    });
    expect(isRefusalLogged(thrown)).toBe(true);
    expect(names()).toEqual(['livePerson', 'reportedUserOf']);
    expect(lines).toEqual([
      {
        fields: {
          adminId: ADMIN,
          flaggedUserId: TEACHER,
          reportId: OTHER_REPORT,
          errorCode: 'CONFLICT',
          reason: 'report_target_mismatch',
        },
        message: 'A gender flag call was refused',
      },
    ]);
  });

  it('refuses open_exists while the person has an open flag', async () => {
    insertAnswers = [null];
    const thrown = await raiseAs({}).catch((e: unknown) => e);
    expect(shapeOf(thrown)).toEqual({
      code: 'CONFLICT',
      message: expect.any(String),
      details: [{ path: 'targetUserId', code: 'open_exists' }],
    });
  });

  it('answers a replay with the first flag and writes nothing', async () => {
    replay = true;
    expect(await raiseAs({})).toEqual({ flagId: FLAG, replayed: true });
    expect(calls).toEqual([]);
    noLineCarries(REASON);
  });
});

const ROW: GenderFlagRow = {
  id: FLAG,
  flaggedUserId: TEACHER,
  raisedByUserId: STUDENT,
  reportId: null,
  status: 'open',
  reason: REASON,
  createdAt: new Date('2026-11-18T09:00:00.000Z'),
  resolutionNotes: null,
  resolvedAt: null,
  resolvedByAdminId: null,
};

describe('genderFlags.list and .get', () => {
  it('pages the queue under the list size, a cursor while more follow, with no reason', async () => {
    rows.set(FLAG, ROW);
    rows.set(`${FLAG}-2`, { ...ROW, id: '0199d0a0-0000-7000-8000-00000000b0f2' });
    rows.set(`${FLAG}-3`, { ...ROW, id: '0199d0a0-0000-7000-8000-00000000b0f3' });
    const page = await service.list(TX, ADMIN, { status: 'open' }, log);
    expect(pages).toEqual([{ status: 'open', after: undefined, take: PAGE_SIZE + 1 }]);
    expect(page.items).toHaveLength(PAGE_SIZE);
    expect(page.nextCursor).toBe('0199d0a0-0000-7000-8000-00000000b0f2');
    expect(JSON.stringify(page)).not.toContain(REASON);
  });

  it('opens a flag with its reason and its resolution, NOT_FOUND for none', async () => {
    rows.set(FLAG, {
      ...ROW,
      status: 'dismissed',
      resolutionNotes: 'سبب',
      resolvedAt: AT,
      resolvedByAdminId: ADMIN,
    });
    expect(await service.detail(TX, ADMIN, { flagId: FLAG }, log)).toEqual({
      flagId: FLAG,
      flaggedUserId: TEACHER,
      raisedByUserId: STUDENT,
      reportId: null,
      status: 'dismissed',
      createdAt: '2026-11-18T09:00:00.000Z',
      reason: REASON,
      resolution: {
        outcome: 'dismissed',
        note: 'سبب',
        resolvedAt: AT.toISOString(),
        resolvedByAdminId: ADMIN,
      },
    });
    const thrown = await service.detail(TX, ADMIN, { flagId: MISSING }, log).catch((e) => e);
    expect((thrown as DomainError).code).toBe('NOT_FOUND');
  });
});

describe('genderFlags.dismiss', () => {
  const dismiss = () =>
    service.dismiss(TX, ADMIN, { flagId: FLAG, reason: 'سبب', idempotencyKey: KEY }, log);

  it('closes the open flag dismissed, with the reason, at the database instant, keyed', async () => {
    rows.set(FLAG, ROW);
    expect(await dismiss()).toEqual({ flaggedUserId: TEACHER, replayed: false });
    expect(calls).toEqual([
      {
        name: 'resolve',
        args: [{ flagId: FLAG, outcome: 'dismissed', note: 'سبب', adminId: ADMIN, at: AT }],
      },
    ]);
    expect(keyed).toEqual([
      {
        scope: 'genderFlags.dismiss',
        key: KEY,
        actorId: ADMIN,
        input: { flagId: FLAG, reason: 'سبب' },
      },
    ]);
    noLineCarries('سبب');
  });

  it('refuses already_resolved once the flag is not open, and NOT_FOUND for none', async () => {
    resolveAnswer = false;
    rows.set(FLAG, { ...ROW, status: 'corrected' });
    const resolved = await dismiss().catch((e: unknown) => e);
    expect(shapeOf(resolved)).toEqual({
      code: 'CONFLICT',
      message: expect.any(String),
      details: [{ path: 'flagId', code: 'already_resolved' }],
    });
    rows.clear();
    const none = await dismiss().catch((e: unknown) => e);
    expect((none as DomainError).code).toBe('NOT_FOUND');
  });

  it('a replay writes nothing and answers the flagged person', async () => {
    replay = true;
    replayOutcome = { flaggedUserId: TEACHER };
    expect(await dismiss()).toEqual({ flaggedUserId: TEACHER, replayed: true });
    expect(calls).toEqual([]);
  });
});
