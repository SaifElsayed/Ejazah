// T011 of specs/005-certification — reports over a store, a `Pairings` port and an idempotency held
// in memory (FR-611, FR-612, FR-613; research R-408; R-GENDER-2; the note under T011, Q-R2 (a) as
// amended, Q-R4 (a), Q-R5 (a), Q-R6 (a), Q-R8 (a)).
//
// reports.create
// - session and chat reports: the caller a party (`partyOfSession`, `partyOfEnrollment`) and the
//   reported user the port's counterpart, else NOT_FOUND; the enrollment stored is the port's, never
//   the input's (R-408);
// - profile reports: a student's, of a teacher `visibleTeachers` answers; anything else, a teacher
//   caller's included, NOT_FOUND (Q-R4 (a)); no gender is compared (Q-R5 (a));
// - every NOT_FOUND in one shape, the shape of a session that does not exist (R-GENDER-2);
// - `self` and `open_exists` (CONFLICT); a refused insert rolls the call back;
// - the locks: the two accounts by key share in one call, then the enrollment, then the insert
//   (kernel.md, «a report raised»); a profile report takes the key share and no enrollment;
// - keyed (`reports.create`); the answer `{ received: true }` and nothing else (spec.md:305);
// - each refusal one info line of ids and its reason; no line ever carries the reporter's reason.
//
// reports.list, .get, .resolve (the administrator's)
// - the queue's page under `admin_list_page_size`, a cursor while more follow; `get` the reason and
//   the resolution once there is one; NOT_FOUND for an unknown report;
// - `resolve` keyed on the kind's transaction (`reports.resolve`), one conditional write at the
//   database's instant; `already_resolved` once it is not open; a replay writes nothing.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { Pairings } from './pairings.port.js';
import type { NewUserReport, UserReportRow } from './user-report.repository.js';
import {
  createUserReports,
  type ReportCaller,
  type UserReportStore,
} from './user-report.service.js';

const STUDENT = '0199d0a0-0000-7000-8000-00000000a0a1';
const TEACHER = '0199d0a0-0000-7000-8000-00000000a0a2';
const OTHER_GENDER_STRANGER = '0199d0a0-0000-7000-8000-00000000a0a3';
const VISIBLE_TEACHER = '0199d0a0-0000-7000-8000-00000000a0a4';
const SESSION = '0199d0a0-0000-7000-8000-00000000a0d1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000a0e1';
const FORGED_ENROLLMENT = '0199d0a0-0000-7000-8000-00000000a0e9';
const MISSING = '0199d0a0-0000-7000-8000-00000000a0ff';
const REPORT = '0199d0a0-0000-7000-8000-00000000a0f1';
const ADMIN = '0199d0a0-0000-7000-8000-00000000a0b9';
const KEY = 'report-key-for-the-spec-0001';
const REASON = 'سبّ وشتم في الحصة: سرّ لا يُكتب في السجل';
const AT = new Date('2026-11-18T10:00:00.000Z');
const PAGE_SIZE = 2;

const TX = {} as Transaction;

const student: ReportCaller = {
  userId: STUDENT,
  role: 'student',
  gender: 'male' as RequesterGender,
};
const teacher: ReportCaller = {
  userId: TEACHER,
  role: 'teacher',
  gender: 'male' as RequesterGender,
};

/** Every call into the store and the port, in order, with what it was given. */
let calls: { name: string; args: unknown[] }[];
let lines: { fields: Record<string, unknown>; message: string }[];
let inserted: NewUserReport[];
let keyed: IdempotentRequest[];
let replay: boolean;
let insertAnswers: (string | null)[];
let rows: Map<string, UserReportRow>;
let resolveAnswer: boolean;
let pages: { status: string; after?: string | undefined; take: number }[];

beforeEach(() => {
  calls = [];
  lines = [];
  inserted = [];
  keyed = [];
  replay = false;
  insertAnswers = [REPORT];
  rows = new Map();
  resolveAnswer = true;
  pages = [];
});

const log = {
  info: (fields: Record<string, unknown>, message: string) => void lines.push({ fields, message }),
};

/** The session `SESSION` and the enrollment `ENROLLMENT` join `STUDENT` and `TEACHER`. */
const pairings: Pairings = {
  partyOfSession: async (_tx, sessionId, userId) => {
    calls.push({ name: 'partyOfSession', args: [sessionId, userId] });
    if (sessionId !== SESSION) return null;
    if (userId === STUDENT) return { enrollmentId: ENROLLMENT, counterpartUserId: TEACHER };
    if (userId === TEACHER) return { enrollmentId: ENROLLMENT, counterpartUserId: STUDENT };
    return null;
  },
  partyOfEnrollment: async (_tx, enrollmentId, userId) => {
    calls.push({ name: 'partyOfEnrollment', args: [enrollmentId, userId] });
    if (enrollmentId !== ENROLLMENT) return null;
    if (userId === STUDENT) return { enrollmentId, counterpartUserId: TEACHER };
    if (userId === TEACHER) return { enrollmentId, counterpartUserId: STUDENT };
    return null;
  },
  paired: async () => {
    throw new Error('reports never ask paired');
  },
};

const store: UserReportStore = {
  visibleTeacher: async (_tx, requester, teacherUserId) => {
    calls.push({ name: 'visibleTeacher', args: [requester, teacherUserId] });
    return teacherUserId === VISIBLE_TEACHER || teacherUserId === TEACHER;
  },
  keyShareAccounts: async (_tx, userIds) => {
    calls.push({ name: 'keyShareAccounts', args: [userIds] });
  },
  lockEnrollment: async (_tx, enrollmentId) => {
    calls.push({ name: 'lockEnrollment', args: [enrollmentId] });
  },
  insert: async (_tx, row) => {
    calls.push({ name: 'insert', args: [row] });
    const answer = insertAnswers.shift() ?? null;
    if (answer !== null) inserted.push(row);
    return answer;
  },
  reportOf: async (_tx, reportId) => rows.get(reportId) ?? null,
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

/** The kernel's idempotency, held in memory: a replay answers the stored outcome and runs nothing. */
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
    if (replay) return { outcome: null as T, replayed: true };
    return { outcome: await effect(tx), replayed: false };
  },
};

const service = createUserReports({
  idempotency: idempotency as never,
  pairings,
  settings,
  clock: async () => AT,
  store,
});

const asked = {
  session: { reportedUserId: TEACHER, context: 'session', sessionId: SESSION },
  chat: { reportedUserId: TEACHER, context: 'chat', enrollmentId: ENROLLMENT },
  profile: { reportedUserId: VISIBLE_TEACHER, context: 'profile' },
} as const;

function report(caller: ReportCaller, what: object) {
  return service.create(
    caller,
    { reason: REASON, idempotencyKey: KEY, ...what } as Parameters<typeof service.create>[1],
    log,
  );
}

/** What a session that does not exist answers: the one NOT_FOUND shape (R-GENDER-2). */
async function nonexistentShape(): Promise<unknown> {
  const thrown = await report(student, { ...asked.session, sessionId: MISSING }).catch((e) => e);
  calls = [];
  lines = [];
  return thrown;
}

function shapeOf(error: unknown) {
  expect(error).toBeInstanceOf(DomainError);
  const { code, message, details } = error as DomainError;
  return { code, message, details };
}

describe('reports.create: where a report comes from', () => {
  it('a session report: the key share of both accounts, then the enrollment, then the insert', async () => {
    expect(await report(student, asked.session)).toEqual({ received: true });
    expect(calls.map(({ name }) => name)).toEqual([
      'partyOfSession',
      'keyShareAccounts',
      'lockEnrollment',
      'insert',
    ]);
    expect(calls[1]?.args).toEqual([[STUDENT, TEACHER]]);
    expect(calls[2]?.args).toEqual([ENROLLMENT]);
    expect(inserted).toEqual([
      {
        reporterUserId: STUDENT,
        reportedUserId: TEACHER,
        context: 'session',
        sessionId: SESSION,
        enrollmentId: ENROLLMENT,
        reason: REASON,
      },
    ]);
  });

  it('a teacher reports their student from the session', async () => {
    expect(
      await report(teacher, { reportedUserId: STUDENT, context: 'session', sessionId: SESSION }),
    ).toEqual({ received: true });
    expect(inserted[0]).toMatchObject({ reporterUserId: TEACHER, reportedUserId: STUDENT });
  });

  it('a chat report names its enrollment, read through the port', async () => {
    expect(await report(student, asked.chat)).toEqual({ received: true });
    expect(calls.map(({ name }) => name)).toEqual([
      'partyOfEnrollment',
      'keyShareAccounts',
      'lockEnrollment',
      'insert',
    ]);
    expect(inserted).toEqual([
      {
        reporterUserId: STUDENT,
        reportedUserId: TEACHER,
        context: 'chat',
        sessionId: null,
        enrollmentId: ENROLLMENT,
        reason: REASON,
      },
    ]);
  });

  it('a student reports a teacher they can see: the key share, no enrollment', async () => {
    expect(await report(student, asked.profile)).toEqual({ received: true });
    expect(calls.map(({ name }) => name)).toEqual(['visibleTeacher', 'keyShareAccounts', 'insert']);
    expect(calls[0]?.args).toEqual(['male', VISIBLE_TEACHER]);
    expect(inserted).toEqual([
      {
        reporterUserId: STUDENT,
        reportedUserId: VISIBLE_TEACHER,
        context: 'profile',
        sessionId: null,
        enrollmentId: null,
        reason: REASON,
      },
    ]);
  });

  it('stores the session’s enrollment, never one the input names (R-408)', async () => {
    await report(student, { ...asked.session, enrollmentId: FORGED_ENROLLMENT });
    expect(inserted[0]?.enrollmentId).toBe(ENROLLMENT);
    expect(calls.find(({ name }) => name === 'lockEnrollment')?.args).toEqual([ENROLLMENT]);
  });
});

describe('reports.create: NOT_FOUND in one shape (R-GENDER-2)', () => {
  const cases: readonly [string, ReportCaller, object, string][] = [
    [
      'a session the caller is not a party of',
      student,
      { ...asked.session, sessionId: MISSING },
      'not_a_party',
    ],
    [
      'a chat the caller is not a party of',
      student,
      { ...asked.chat, enrollmentId: MISSING },
      'not_a_party',
    ],
    [
      'a session report of a user who is not the session’s counterpart (#143 r3)',
      student,
      { ...asked.session, reportedUserId: OTHER_GENDER_STRANGER },
      'not_the_counterpart',
    ],
    [
      'a chat report of a user who is not the enrollment’s counterpart',
      teacher,
      { ...asked.chat, reportedUserId: OTHER_GENDER_STRANGER },
      'not_the_counterpart',
    ],
    [
      'a profile the student cannot see',
      student,
      { reportedUserId: OTHER_GENDER_STRANGER, context: 'profile' },
      'not_visible',
    ],
    [
      'a teacher’s profile report, even of a teacher a student would see (Q-R4 (a))',
      teacher,
      asked.profile,
      'not_a_student',
    ],
  ];

  it.each(cases)('%s', async (_name, caller, what, reason) => {
    const expected = shapeOf(await nonexistentShape());
    const thrown = await report(caller, what).catch((e: unknown) => e);
    expect(shapeOf(thrown)).toEqual(expected);
    expect(expected).toEqual({
      code: 'NOT_FOUND',
      message: expect.any(String),
      details: undefined,
    });
    expect(isRefusalLogged(thrown)).toBe(true);
    expect(calls.map(({ name }) => name)).not.toContain('keyShareAccounts');
    expect(calls.map(({ name }) => name)).not.toContain('insert');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toMatchObject({
      userId: caller.userId,
      errorCode: 'NOT_FOUND',
      reason,
    });
  });

  it('never asks the visibility of a teacher caller’s profile report', async () => {
    await report(teacher, asked.profile).catch(() => undefined);
    expect(calls.map(({ name }) => name)).not.toContain('visibleTeacher');
  });
});

describe('reports.create: refusals', () => {
  it('refuses a report of oneself, CONFLICT self, before anything is keyed or read', async () => {
    const thrown = await report(student, { reportedUserId: STUDENT, context: 'profile' }).catch(
      (e: unknown) => e,
    );
    expect(shapeOf(thrown)).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'reportedUserId', code: 'self' }],
    });
    expect(keyed).toEqual([]);
    expect(calls).toEqual([]);
    expect(lines.map(({ fields }) => fields.reason)).toEqual(['self']);
  });

  it('refuses a second open report, CONFLICT open_exists, the call rolled back', async () => {
    insertAnswers = [null];
    const thrown = await report(student, asked.session).catch((e: unknown) => e);
    expect(shapeOf(thrown)).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'reportedUserId', code: 'open_exists' }],
    });
    expect(isRefusalLogged(thrown)).toBe(true);
    expect(inserted).toEqual([]);
    expect(lines.map(({ fields }) => fields.reason)).toEqual(['open_exists']);
  });
});

describe('reports.create: the key and the answer', () => {
  it('keys the call by the caller, the scope and the input without the key', async () => {
    await report(student, asked.session);
    expect(keyed).toEqual([
      {
        scope: 'reports.create',
        key: KEY,
        actorId: STUDENT,
        input: { reportedUserId: TEACHER, context: 'session', sessionId: SESSION, reason: REASON },
      },
    ]);
  });

  it('a replay answers received and writes nothing', async () => {
    replay = true;
    expect(await report(student, asked.session)).toEqual({ received: true });
    expect(calls).toEqual([]);
  });

  it('answers received and nothing else: no id, no status', async () => {
    const answer = await report(student, asked.chat);
    expect(Object.keys(answer)).toEqual(['received']);
  });

  it('logs the report received with ids only', async () => {
    await report(student, asked.chat);
    expect(lines).toEqual([
      {
        fields: {
          reportId: REPORT,
          userId: STUDENT,
          reportedUserId: TEACHER,
          context: 'chat',
          enrollmentId: ENROLLMENT,
        },
        message: expect.any(String),
      },
    ]);
  });

  it('never writes the reason in a log line, received or refused', async () => {
    await report(student, asked.session);
    insertAnswers = [null];
    await report(student, asked.chat).catch(() => undefined);
    await report(student, { ...asked.session, reportedUserId: OTHER_GENDER_STRANGER }).catch(
      () => undefined,
    );
    await report(student, { reportedUserId: STUDENT, context: 'profile' }).catch(() => undefined);
    expect(lines).toHaveLength(4);
    expect(JSON.stringify(lines)).not.toContain(REASON);
    expect(JSON.stringify(lines)).not.toContain('سرّ');
  });
});

function reportRow(change: Partial<UserReportRow> = {}): UserReportRow {
  return {
    id: REPORT,
    context: 'session',
    status: 'open',
    reporterUserId: STUDENT,
    reportedUserId: TEACHER,
    sessionId: SESSION,
    enrollmentId: ENROLLMENT,
    reason: REASON,
    createdAt: new Date('2026-11-18T09:00:00.000Z'),
    resolutionNotes: null,
    resolvedAt: null,
    resolvedByAdminId: null,
    ...change,
  };
}

const ITEM = {
  reportId: REPORT,
  context: 'session',
  status: 'open',
  reporterUserId: STUDENT,
  reportedUserId: TEACHER,
  sessionId: SESSION,
  enrollmentId: ENROLLMENT,
  createdAt: '2026-11-18T09:00:00.000Z',
};

describe('reports.list', () => {
  it('reads a page of `admin_list_page_size` and one more, the cursor the last id while more follow', async () => {
    const second = '0199d0a0-0000-7000-8000-00000000a0f2';
    const third = '0199d0a0-0000-7000-8000-00000000a0f3';
    rows.set(REPORT, reportRow());
    rows.set(second, reportRow({ id: second }));
    rows.set(third, reportRow({ id: third }));
    const page = await service.list(TX, ADMIN, { status: 'open', cursor: MISSING }, log);
    expect(pages).toEqual([{ status: 'open', after: MISSING, take: PAGE_SIZE + 1 }]);
    expect(page).toEqual({
      items: [ITEM, { ...ITEM, reportId: second }],
      nextCursor: second,
    });
  });

  it('answers no cursor on the last page, and never the reason', async () => {
    rows.set(REPORT, reportRow());
    const page = await service.list(TX, ADMIN, { status: 'open' }, log);
    expect(page).toEqual({ items: [ITEM] });
    expect(JSON.stringify(page)).not.toContain(REASON);
  });
});

describe('reports.get', () => {
  it('answers an open report with its reason and no resolution', async () => {
    rows.set(REPORT, reportRow());
    expect(await service.get(TX, ADMIN, { reportId: REPORT }, log)).toEqual({
      ...ITEM,
      reason: REASON,
      resolution: null,
      chatAvailable: true,
    });
  });

  // 005:T034: an open report that names an enrollment opens its chat; nothing else does.
  it.each([
    ['an open session report', {}, true],
    ['an open chat report', { context: 'chat', sessionId: null }, true],
    ['an open profile report', { context: 'profile', sessionId: null, enrollmentId: null }, false],
    [
      'an actioned session report',
      { status: 'actioned', resolutionNotes: 'تم', resolvedAt: AT, resolvedByAdminId: ADMIN },
      false,
    ],
    [
      'a dismissed chat report',
      {
        context: 'chat',
        sessionId: null,
        status: 'dismissed',
        resolutionNotes: 'تم',
        resolvedAt: AT,
        resolvedByAdminId: ADMIN,
      },
      false,
    ],
  ] as const)('answers chatAvailable for %s', async (_name, change, available) => {
    rows.set(REPORT, reportRow(change as Partial<UserReportRow>));
    const detail = await service.get(TX, ADMIN, { reportId: REPORT }, log);
    expect(detail.chatAvailable).toBe(available);
  });

  it('answers a resolved report with its outcome, note, instant and administrator', async () => {
    rows.set(
      REPORT,
      reportRow({
        status: 'dismissed',
        resolutionNotes: 'لا مخالفة',
        resolvedAt: AT,
        resolvedByAdminId: ADMIN,
      }),
    );
    expect(await service.get(TX, ADMIN, { reportId: REPORT }, log)).toEqual({
      ...ITEM,
      status: 'dismissed',
      reason: REASON,
      chatAvailable: false,
      resolution: {
        outcome: 'dismissed',
        note: 'لا مخالفة',
        resolvedAt: AT.toISOString(),
        resolvedByAdminId: ADMIN,
      },
    });
  });

  it('refuses an unknown report NOT_FOUND, logged by ids', async () => {
    const thrown = await service
      .get(TX, ADMIN, { reportId: MISSING }, log)
      .catch((e: unknown) => e);
    expect(shapeOf(thrown)).toMatchObject({ code: 'NOT_FOUND' });
    expect(lines[0]?.fields).toMatchObject({
      adminId: ADMIN,
      reportId: MISSING,
      reason: 'no_report',
    });
  });
});

describe('reports.resolve', () => {
  const resolving = {
    reportId: REPORT,
    outcome: 'actioned',
    note: 'تم التنبيه',
    idempotencyKey: KEY,
  } as const;

  it('keys the call on the kind’s transaction and writes the closing at the database’s instant', async () => {
    rows.set(REPORT, reportRow());
    expect(await service.resolve(TX, ADMIN, resolving, log)).toEqual({ replayed: false });
    expect(keyed).toEqual([
      {
        scope: 'reports.resolve',
        key: KEY,
        actorId: ADMIN,
        input: { reportId: REPORT, outcome: 'actioned', note: 'تم التنبيه' },
      },
    ]);
    expect(calls).toEqual([
      {
        name: 'resolve',
        args: [
          { reportId: REPORT, outcome: 'actioned', note: 'تم التنبيه', adminId: ADMIN, at: AT },
        ],
      },
    ]);
  });

  it('refuses a report no longer open, CONFLICT already_resolved', async () => {
    rows.set(REPORT, reportRow({ status: 'actioned', resolvedAt: AT, resolvedByAdminId: ADMIN }));
    resolveAnswer = false;
    const thrown = await service.resolve(TX, ADMIN, resolving, log).catch((e: unknown) => e);
    expect(shapeOf(thrown)).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'reportId', code: 'already_resolved' }],
    });
    expect(lines[0]?.fields).toMatchObject({
      adminId: ADMIN,
      reportId: REPORT,
      reason: 'already_resolved',
    });
  });

  it('refuses an unknown report NOT_FOUND', async () => {
    resolveAnswer = false;
    const thrown = await service
      .resolve(TX, ADMIN, { ...resolving, reportId: MISSING }, log)
      .catch((e: unknown) => e);
    expect(shapeOf(thrown)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a replay writes nothing', async () => {
    replay = true;
    expect(await service.resolve(TX, ADMIN, resolving, log)).toEqual({ replayed: true });
    expect(calls).toEqual([]);
  });
});
