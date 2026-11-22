// T031 and T032 of specs/004-sessions — the remedy's procedures and the windows' ends as the service
// decides them (FR-463 to FR-469; research R-311; plan.md decision 9; contracts/app-surface.md,
// "`sessions.remedy`"; contracts/kernel.md, the rows «remedy offer … a counter-proposal, its decline,
// its withdrawal», «`sessions.remedy.choose` …» and «make-up booking»; the notes under T028, T029,
// T031 and T032). Written before the service, and run red first.
//
// Over a store that records what it is asked, in order, so the spec reads the locks' order the
// kernel's rows name; the make-up's booking (T029) and the hand-off to a case (T030) are fakes that
// record what they were asked, their own rules being their specs'. What the database refuses or
// writes is tests/db-integrity/remedy-*.spec.ts'.
//
// THE WORLD. A Teacher-No-Show of 2026-10-11 on a recitation enrollment whose slot is Sunday 09:00
// in Cairo (+02:00 from November), an hour. Its remedy was offered 2026-11-01T08:00Z, its choice
// window closing (C) 2026-11-08T08:00Z, A = 72 h and L = 24 h on the row, its proposal Sunday
// 2026-12-06 (07:00Z to 08:00Z). The clock reads 2026-11-03T08:00Z unless a case moves it, so
// now + A + L = 2026-11-07T08:00Z falls before C and the counter options' bound is C (H2).
import { Writable } from 'node:stream';

import { addMinutes } from '@ijazah/time';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import { createLogger, type Logger } from '../../platform/logging/logger.js';
import type { SlotRow } from '../catalog/index.js';
import type { EnrollmentTerms, HeldTime } from './enrollment-side.port.js';
import type { MakeupBookingInput, MakeupRefusal } from './makeup-booking.service.js';
import type { RemedyCaseInput } from './remedy-case.service.js';
import type { RemedyViewRow } from './remedy-offer.repository.js';
import type { CounterWrite, RemedyRow } from './remedy.repository.js';
import {
  createRemedyServices,
  createRemedyWindows,
  type RemedyDependencies,
  type RemedyServices,
  type RemedyStore,
  type RemedyWindows,
  type RemedyWindowsDependencies,
} from './remedy.service.js';
import type { ReservedTime } from './reservations.service.js';
import type { SessionEventRecord } from './session-events.repository.js';
import type { PartySessionRow, SessionTime } from './sessions.repository.js';

const SESSION = '0199d0a0-0000-7000-8000-00000000a001';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e001';
const STUDENT = '0199d0a0-0000-7000-8000-00000000c002';
const TEACHER = '0199d0a0-0000-7000-8000-00000000c001';
const STRANGER = '0199d0a0-0000-7000-8000-00000000c003';
const REMEDY = '0199d0a0-0000-7000-8000-00000000f001';
const OTHER_REMEDY = '0199d0a0-0000-7000-8000-00000000f002';
const MAKEUP = '0199d0a0-0000-7000-8000-00000000a0b1';
const NOWHERE = '0199d0a0-0000-7000-8000-00000000a0ff';
const KEY = 'counter-key-0199d0a0-0001';

/** The enrollment's slot and the teacher's others (this file's head). */
const OWN_SLOT = '0199d0a0-0000-7000-8000-0000000005a0';
const MONDAY_SLOT = '0199d0a0-0000-7000-8000-0000000005a1';
const SHORT_SLOT = '0199d0a0-0000-7000-8000-0000000005a2';
const INACTIVE_SLOT = '0199d0a0-0000-7000-8000-0000000005a3';
const RIYADH_SLOT = '0199d0a0-0000-7000-8000-0000000005a4';

const NOW = new Date('2026-11-03T08:00:00.000Z');
const OFFERED = new Date('2026-11-01T08:00:00.000Z');
const CHOICE_CLOSES = new Date('2026-11-08T08:00:00.000Z');
const PROPOSED = new Date('2026-12-06T00:00:00.000Z');
const COUNTER_DATE = new Date('2026-11-16T00:00:00.000Z');
const COUNTER_TIME = new Date('1970-01-01T18:00:00.000Z');
const COUNTER_AT = new Date('2026-11-04T10:00:00.000Z');
/** COUNTER_AT + A (72 h): the counter's answer window closes (D1). */
const ANSWER_CLOSES = new Date('2026-11-07T10:00:00.000Z');

const TX = { tx: 'the transaction' } as unknown as Transaction;

const slot = (
  id: string,
  dayOfWeek: number,
  startTimeLocal: string,
  values: Partial<SlotRow> = {},
): SlotRow => ({
  id,
  dayOfWeek,
  startTimeLocal,
  durationMinutes: 60,
  timezone: 'Africa/Cairo',
  isActive: true,
  createdAt: OFFERED,
  ...values,
});

const SLOTS: readonly SlotRow[] = [
  slot(OWN_SLOT, 0, '09:00:00'),
  slot(MONDAY_SLOT, 1, '18:00:00'),
  slot(SHORT_SLOT, 2, '10:00:00', { durationMinutes: 45 }),
  slot(INACTIVE_SLOT, 3, '10:00:00', { isActive: false }),
  slot(RIYADH_SLOT, 4, '20:00:00', { timezone: 'Asia/Riyadh' }),
];

const TERMS: EnrollmentTerms = {
  id: ENROLLMENT,
  status: 'confirmed',
  slotId: OWN_SLOT,
  track: 'recitation',
  timezone: 'Africa/Cairo',
  durationMinutes: 60,
  sessionCount: 4,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
};

const SESSION_ROW: PartySessionRow = {
  id: SESSION,
  enrollmentId: ENROLLMENT,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
  sequenceNumber: 1,
  makeupForSequenceNumber: null,
  localDate: '2026-10-11',
  startTimeLocal: '09:00:00',
  timezone: 'Africa/Cairo',
  startsAt: new Date('2026-10-11T06:00:00.000Z'),
  endsAt: new Date('2026-10-11T07:00:00.000Z'),
  status: 'teacher_no_show',
};

const remedyRow = (values: Partial<RemedyRow> = {}): RemedyRow => ({
  id: REMEDY,
  sessionId: SESSION,
  status: 'proposed',
  kind: 'makeup',
  offeredAt: OFFERED,
  choiceClosesAt: CHOICE_CLOSES,
  proposedDate: PROPOSED,
  snapshotAnswerWindowHours: 72,
  snapshotFirstSessionLeadHours: 24,
  counter: null,
  ...values,
});

const PENDING_COUNTER = {
  slotId: MONDAY_SLOT,
  date: COUNTER_DATE,
  startTimeLocal: COUNTER_TIME,
  timezone: 'Africa/Cairo',
  proposedAt: COUNTER_AT,
} as const;

let calls: unknown[][];
let session: PartySessionRow | null;
let remedy: RemedyRow | null;
let genders: Map<string, 'male' | 'female'>;
let terms: EnrollmentTerms;
let now: Date;
let busy: {
  sessions: SessionTime[];
  held: HeldTime[];
  reserved: ReservedTime[];
  /** 006:T005 (N-12): the student's other active programmes' weekly times. */
  programme?: HeldTime[];
};
/** 006:T005: what each programme read asked: the students and the enrollment left out. */
let programmeAsked: unknown[] = [];
/** The slots another package keeps (`slotsFreeFrom`): null on every date, else free from that date. */
let freeFrom: Map<string, string | null>;
let freeFromReads: { slotIds: readonly string[]; enrollmentId: string }[];
let booked: { input: MakeupBookingInput; tx: Transaction }[];
let bookRefusal: unknown;
let proposalRefusal: unknown;
let handedOff: RemedyCaseInput[];
let reported: Error[];
let lines: { level: string; msg: string; [field: string]: unknown }[];
let log: Logger;
let keyed: IdempotentRequest[];

const overlapping = <T extends { startsAt: Date; endsAt: Date }>(
  times: readonly T[],
  window: { from: Date; to: Date },
): T[] => times.filter(({ startsAt, endsAt }) => startsAt < window.to && window.from < endsAt);

const store: RemedyStore = {
  sessionOfParty: async (_tx, sessionId, userId) => {
    calls.push(['sessionOfParty', sessionId]);
    return session !== null &&
      session.id === sessionId &&
      (session.studentUserId === userId || session.teacherUserId === userId)
      ? session
      : null;
  },
  partiesOf: async (_tx, userIds) => {
    calls.push(['partiesOf', userIds]);
    return new Map(
      userIds.flatMap((id) => {
        const gender = genders.get(id);
        return gender === undefined ? [] : [[id, { gender }] as const];
      }),
    );
  },
  remedyOf: async (_tx, sessionId) => {
    calls.push(['remedyOf', sessionId]);
    return remedy?.sessionId === sessionId ? remedy : null;
  },
  remedyById: async (_tx, remedyId) => {
    calls.push(['remedyById', remedyId]);
    return remedy?.id === remedyId
      ? { ...remedy, enrollmentId: ENROLLMENT, studentUserId: STUDENT, teacherUserId: TEACHER }
      : null;
  },
  lockAccounts: async (_tx, ids) => {
    calls.push(['lockAccounts', ids]);
  },
  lockTeacherSlots: async (_tx, teacherUserId) => {
    calls.push(['lockTeacherSlots', teacherUserId]);
  },
  lockSlots: async (_tx, ids) => {
    calls.push(['lockSlots', ids]);
  },
  lockSessions: async (_tx, ids) => {
    calls.push(['lockSessions', ids]);
  },
  lockRemedyOfSession: async (_tx, sessionId) => {
    calls.push(['lockRemedyOfSession', sessionId]);
  },
  slotOf: async (_tx, slotId) => SLOTS.find(({ id }) => id === slotId) ?? null,
  teacherSlotsOf: async (_tx, teacherUserId) => {
    calls.push(['teacherSlotsOf', teacherUserId]);
    return SLOTS;
  },
  sessionsBetween: async (_tx, _parties, window) => overlapping(busy.sessions, window),
  reservedTimesOf: async (_tx, _userIds, window) => overlapping(busy.reserved, window),
  chooseMakeup: async (_tx, remedyId) => {
    calls.push(['chooseMakeup', remedyId]);
    if (remedy === null) return false;
    remedy = { ...remedy, status: 'proposed' };
    return true;
  },
  writeCounter: async (_tx, remedyId, counter: CounterWrite) => {
    calls.push(['writeCounter', remedyId, counter]);
    if (remedy === null) return false;
    remedy = { ...remedy, status: 'counter_proposed', counter };
    return true;
  },
  releaseCounter: async (_tx, remedyId) => {
    calls.push(['releaseCounter', remedyId]);
    if (remedy?.status !== 'counter_proposed') return false;
    remedy = { ...remedy, status: 'proposed', counter: null };
    return true;
  },
  recordEvents: async (_tx, events: readonly SessionEventRecord[]) => {
    calls.push(['recordEvents', events]);
  },
  viewRowOf: async (_tx, sessionId): Promise<RemedyViewRow | null> => {
    if (remedy === null || remedy.sessionId !== sessionId) return null;
    const { counter } = remedy;
    return {
      id: remedy.id,
      status: remedy.status,
      kind: remedy.kind,
      offeredAt: remedy.offeredAt,
      choiceClosesAt: remedy.choiceClosesAt,
      proposedDate: remedy.proposedDate,
      counterDate: counter?.date ?? null,
      counterStartTimeLocal: counter?.startTimeLocal ?? null,
      counterTimezone: counter?.timezone ?? null,
      counterProposedAt: counter?.proposedAt ?? null,
      snapshotAnswerWindowHours: remedy.snapshotAnswerWindowHours,
      makeupSessionId: remedy.status === 'booked' ? MAKEUP : null,
    };
  },
};

const transactions: Transactions = {
  run: async (work) => {
    calls.push(['begin']);
    const value = await work(TX);
    calls.push(['commit']);
    return value;
  },
};

/** A recorded refusal of T029's booking: what `makeupRefusalOf` would read from the real one. */
class RefusedBooking extends DomainError {
  constructor(readonly made: MakeupRefusal) {
    super('MAKEUP_REFUSED');
  }
}

const refusedBy = (error: unknown): MakeupRefusal | null =>
  error instanceof RefusedBooking ? error.made : null;

const OVERLAP: MakeupRefusal = { cause: 'overlap', constraint: 'sessions_teacher_no_overlap' };

function services(): RemedyServices {
  return createRemedyServices(dependencies());
}

function windows(): RemedyWindows {
  return createRemedyWindows({
    ...dependencies(),
    log,
    report: (error) => {
      reported.push(error);
    },
  });
}

function dependencies() {
  return {
    transactions,
    idempotency: {
      run: async (request, effect) => {
        keyed.push(request);
        return transactions.run(effect);
      },
    },
    enrollments: {
      enrollmentFor: async (_tx, id) => (id === ENROLLMENT ? terms : null),
      lockEnrollments: async (_tx, ids) => {
        calls.push(['lockEnrollments', ids]);
      },
      heldTimesOf: async (_tx, _userIds, window) => overlapping(busy.held, window),
      programmeTimesOf: async (_tx, students, window, except) => {
        programmeAsked.push([students, except]);
        return overlapping(busy.programme ?? [], window);
      },
      slotWeekTaken: async () => false,
      slotsFreeFrom: async (_tx, slotIds, enrollmentId) => {
        freeFromReads.push({ slotIds, enrollmentId });
        return new Map([...freeFrom].filter(([id]) => slotIds.includes(id)));
      },
    },
    clock: async () => {
      calls.push(['clock']);
      return now;
    },
    store,
    bookingOf: () => ({
      bookOn: async (tx, input) => {
        calls.push(['bookOn', input]);
        booked.push({ input, tx });
        if (bookRefusal !== undefined) throw bookRefusal;
        if (remedy !== null) remedy = { ...remedy, status: 'booked', counter: null };
        return {
          remedyId: input.remedyId,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          makeupSessionId: MAKEUP,
          startsAt: new Date('2026-12-06T07:00:00.000Z'),
          endsAt: new Date('2026-12-06T08:00:00.000Z'),
        };
      },
      run: async (trace, work) => {
        calls.push(['run', trace]);
        return transactions.run(work);
      },
      book: async (input) => {
        calls.push(['book', input]);
        if (proposalRefusal !== undefined) throw proposalRefusal;
        if (remedy !== null) remedy = { ...remedy, status: 'booked', counter: null };
        return {
          remedyId: input.remedyId,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          makeupSessionId: MAKEUP,
          startsAt: new Date('2026-12-06T07:00:00.000Z'),
          endsAt: new Date('2026-12-06T08:00:00.000Z'),
        };
      },
    }),
    makeupRefusalOf: refusedBy,
    casesOf: () => ({
      handOff: async (tx, input) => {
        calls.push(['handOff', input]);
        handedOff.push(input);
        if (remedy !== null)
          remedy = { ...remedy, status: 'refund_case', kind: 'refund', counter: null };
        return {
          ...input,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          caseId: NOWHERE,
          caseOpened: true,
          kind: 'refund' as const,
        };
      },
    }),
    // T111: the hand-off is the windows' only (`makeup_refused`); the procedures hand nothing over.
  } satisfies RemedyDependencies & Pick<RemedyWindowsDependencies, 'casesOf'>;
}

beforeEach(() => {
  calls = [];
  session = SESSION_ROW;
  remedy = remedyRow();
  genders = new Map([
    [STUDENT, 'female'],
    [TEACHER, 'female'],
  ]);
  terms = TERMS;
  now = NOW;
  busy = { sessions: [], held: [], reserved: [] };
  freeFrom = new Map();
  freeFromReads = [];
  booked = [];
  bookRefusal = undefined;
  proposalRefusal = undefined;
  handedOff = [];
  reported = [];
  lines = [];
  keyed = [];
  log = createLogger({
    level: 'info',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString()) as (typeof lines)[number]);
        done();
      },
    }),
  });
});

/** The refusal's code, its «logged» mark, and the one line it wrote. */
async function refusalOf(call: Promise<unknown>) {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError))
    throw new Error(`expected a refusal, got ${String(thrown)}`);
  return { code: thrown.code, logged: isRefusalLogged(thrown), lines: [...lines] };
}

function refusalLines(): Record<string, unknown>[] {
  return lines
    .filter((line) => typeof line['errorCode'] === 'string')
    .map(({ msg: _msg, level: _level, time: _time, pid: _pid, hostname: _host, ...rest }) => rest);
}

const writes = () =>
  calls.filter(([name]) =>
    [
      'chooseMakeup',
      'writeCounter',
      'releaseCounter',
      'recordEvents',
      'bookOn',
      'handOff',
    ].includes(String(name)),
  );

const locks = () =>
  calls.filter(([name]) => String(name).startsWith('lock')).map(([name, ids]) => [name, ids]);

/** The kernel's choice and counter row: both accounts, the key, the enrollment, the session, the remedy. */
const CHOICE_LOCKS = [
  ['lockAccounts', [TEACHER, STUDENT]],
  ['lockTeacherSlots', TEACHER],
  ['lockEnrollments', [ENROLLMENT]],
  ['lockSessions', [SESSION]],
  ['lockRemedyOfSession', SESSION],
];

const proposalView = {
  localDate: '2026-12-06',
  startTimeLocal: '09:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-12-06T07:00:00Z',
};

describe("each procedure's caller (contracts/README.md, «Callers»; R-GENDER-2)", () => {
  const asStudent = (s: RemedyServices, userId: string, sessionId = SESSION) => [
    () => s.choose({ userId }, { sessionId, choice: 'makeup' }, log),
    () => s.accept({ userId }, { sessionId }, log),
    () => s.counterOptions({ userId }, { sessionId }, log),
    () =>
      s.counter(
        { userId },
        { sessionId, slotId: MONDAY_SLOT, localDate: '2026-11-09', idempotencyKey: KEY },
        log,
      ),
  ];

  it('answers NOT_FOUND to a stranger, to an id that never existed and to the teacher on the student’s four, writing nothing', async () => {
    const s = services();
    for (const [userId, sessionId] of [
      [STRANGER, SESSION],
      [STUDENT, NOWHERE],
      [TEACHER, SESSION],
    ] as const) {
      for (const call of asStudent(s, userId, sessionId)) {
        lines = [];
        const refused = await refusalOf(call());
        expect(refused.code).toBe('NOT_FOUND');
        expect(refused.logged).toBe(true);
        expect(refused.lines).toHaveLength(1);
      }
    }
    expect(writes()).toEqual([]);
  });

  it('answers NOT_FOUND to a student whose teacher is of the other gender by the server’s records', async () => {
    genders.set(TEACHER, 'male');
    const s = services();
    for (const call of asStudent(s, STUDENT)) {
      expect((await refusalOf(call())).code).toBe('NOT_FOUND');
    }
    expect(writes()).toEqual([]);
  });

  it('writes the refusal’s one info line with the ids, the code and the reason, nothing else', async () => {
    await refusalOf(services().accept({ userId: STRANGER }, { sessionId: SESSION }, log));
    genders.set(TEACHER, 'male');
    await refusalOf(services().counterOptions({ userId: STUDENT }, { sessionId: SESSION }, log));
    expect(lines.map(({ level }) => level)).toEqual(['info', 'info']);
    expect(refusalLines()).toEqual([
      { sessionId: SESSION, userId: STRANGER, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
      { sessionId: SESSION, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'gender_differs' },
    ]);
  });
});

describe('sessions.remedy.choose (T031; FR-463, FR-467; the third analysis, A1; Q9 (a))', () => {
  beforeEach(() => {
    remedy = remedyRow({ status: 'awaiting_choice' });
  });

  it('a make-up: the kernel’s locks in order, then `proposed`, answered as the remedy', async () => {
    const view = await services().choose(
      { userId: STUDENT },
      { sessionId: SESSION, choice: 'makeup' },
      log,
    );
    expect(locks()).toEqual(CHOICE_LOCKS);
    expect(writes()).toEqual([['chooseMakeup', REMEDY]]);
    expect(view).toEqual({
      status: 'proposed',
      kind: 'makeup',
      offeredAt: OFFERED.toISOString(),
      choiceClosesAt: CHOICE_CLOSES.toISOString(),
      proposal: proposalView,
      canChooseRefund: false,
    });
  });

  // T111 of specs/003-booking (DEC-84; ADR 0025 D5; FR-MAKEUP-2 and FR-ADMIN-5 as amended): no refund
  // is chosen any more, on an `awaiting_choice` row offered before the change too; nothing is handed
  // to a case, and the remedy stays open for its make-up.
  it('a refund CHOICE_NOT_ALLOWED on every track and debt, a recitation Teacher-No-Show and a cleared suspension’s session included; nothing written, one info line (T111)', async () => {
    for (const [track, status] of [
      ['recitation', 'teacher_no_show'],
      ['recitation', 'cancelled_by_admin'],
      ['ijazah_track', 'teacher_no_show'],
      ['recitation', 'both_no_show'],
    ] as const) {
      terms = { ...TERMS, track };
      session = { ...SESSION_ROW, status };
      lines = [];
      const refused = await refusalOf(
        services().choose({ userId: STUDENT }, { sessionId: SESSION, choice: 'refund' }, log),
      );
      expect(refused.code).toBe('CHOICE_NOT_ALLOWED');
      expect(refused.logged).toBe(true);
      expect(refusalLines()).toEqual([
        {
          sessionId: SESSION,
          userId: STUDENT,
          remedyId: REMEDY,
          errorCode: 'CHOICE_NOT_ALLOWED',
          reason: 'refund_not_owed',
        },
      ]);
    }
    expect(writes()).toEqual([]);
    expect(handedOff).toEqual([]);
    expect(remedy?.status).toBe('awaiting_choice');
  });

  it('an awaiting_choice row offered before the change still chooses its make-up, a cleared suspension’s session included (T111)', async () => {
    for (const status of ['teacher_no_show', 'cancelled_by_admin'] as const) {
      remedy = remedyRow({ status: 'awaiting_choice' });
      session = { ...SESSION_ROW, status };
      const view = await services().choose(
        { userId: STUDENT },
        { sessionId: SESSION, choice: 'makeup' },
        log,
      );
      expect(view).toMatchObject({ status: 'proposed', kind: 'makeup', canChooseRefund: false });
    }
    expect(writes()).toEqual([
      ['chooseMakeup', REMEDY],
      ['chooseMakeup', REMEDY],
    ]);
    expect(handedOff).toEqual([]);
  });

  it('a remedy no longer awaiting a choice CHOICE_NOT_ALLOWED, either choice', async () => {
    for (const status of ['proposed', 'counter_proposed'] as const) {
      remedy = remedyRow({
        status,
        ...(status === 'counter_proposed' ? { counter: PENDING_COUNTER } : {}),
      });
      for (const choice of ['makeup', 'refund'] as const) {
        expect(
          (
            await refusalOf(
              services().choose({ userId: STUDENT }, { sessionId: SESSION, choice }, log),
            )
          ).code,
        ).toBe('CHOICE_NOT_ALLOWED');
      }
    }
    expect(writes()).toEqual([]);
  });

  it('a frozen, final, lapsed or absent remedy REMEDY_NOT_OPEN', async () => {
    for (const status of ['frozen', 'booked', 'refund_case', 'lapsed'] as const) {
      remedy = remedyRow({ status });
      expect(
        (
          await refusalOf(
            services().choose({ userId: STUDENT }, { sessionId: SESSION, choice: 'makeup' }, log),
          )
        ).code,
      ).toBe('REMEDY_NOT_OPEN');
    }
    remedy = null;
    expect(
      (
        await refusalOf(
          services().choose({ userId: STUDENT }, { sessionId: SESSION, choice: 'makeup' }, log),
        )
      ).code,
    ).toBe('REMEDY_NOT_OPEN');
    expect(writes()).toEqual([]);
  });

  it('from choice_closes_at REMEDY_NOT_OPEN (Q9 (a)); one millisecond before, admitted', async () => {
    now = CHOICE_CLOSES;
    expect(
      (
        await refusalOf(
          services().choose({ userId: STUDENT }, { sessionId: SESSION, choice: 'makeup' }, log),
        )
      ).code,
    ).toBe('REMEDY_NOT_OPEN');
    now = new Date('2026-11-08T07:59:59.999Z');
    await services().choose({ userId: STUDENT }, { sessionId: SESSION, choice: 'makeup' }, log);
    expect(writes()).toEqual([['chooseMakeup', REMEDY]]);
  });
});

describe('sessions.remedy.accept (T031; FR-469; the owner’s approval of 2026-11-05)', () => {
  const PROPOSAL_LOCKS = [
    ['lockAccounts', [TEACHER, STUDENT]],
    ['lockTeacherSlots', TEACHER],
    ['lockSlots', [OWN_SLOT]],
    ['lockEnrollments', [ENROLLMENT]],
    ['lockSessions', [SESSION]],
    ['lockRemedyOfSession', SESSION],
  ];

  it('books the proposal through T029 on the booking’s own transaction, as sessions.remedy.accept, its locks first', async () => {
    const view = await services().accept({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(calls.find(([name]) => name === 'run')).toEqual([
      'run',
      { remedyId: REMEDY, operation: 'sessions.remedy.accept' },
    ]);
    expect(locks()).toEqual(PROPOSAL_LOCKS);
    expect(booked).toEqual([
      {
        input: { remedyId: REMEDY, booking: 'proposal', operation: 'sessions.remedy.accept' },
        tx: TX,
      },
    ]);
    expect(writes()).toEqual([['bookOn', booked[0]?.input]]);
    expect(view.status).toBe('booked');
    expect(view.makeupSessionId).toBe(MAKEUP);
  });

  it('from awaiting_choice too, and after choice_closes_at (Q9 (a))', async () => {
    remedy = remedyRow({ status: 'awaiting_choice' });
    now = new Date('2026-11-09T08:00:00.000Z');
    await services().accept({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(booked).toHaveLength(1);
  });

  it('a pending counter-proposal is withdrawn: one counter_withdrawn row before the booking', async () => {
    remedy = remedyRow({ status: 'counter_proposed', counter: PENDING_COUNTER });
    await services().accept({ userId: STUDENT }, { sessionId: SESSION }, log);
    expect(writes()).toEqual([
      [
        'recordEvents',
        [
          {
            enrollmentId: ENROLLMENT,
            sessionId: SESSION,
            kind: 'counter_withdrawn',
            occurredAt: NOW,
          },
        ],
      ],
      ['bookOn', { remedyId: REMEDY, booking: 'proposal', operation: 'sessions.remedy.accept' }],
    ]);
  });

  it('a frozen, final or absent remedy REMEDY_NOT_OPEN, never booked', async () => {
    for (const status of ['frozen', 'booked', 'refund_case', 'lapsed'] as const) {
      remedy = remedyRow({ status });
      expect(
        (await refusalOf(services().accept({ userId: STUDENT }, { sessionId: SESSION }, log))).code,
      ).toBe('REMEDY_NOT_OPEN');
    }
    expect(booked).toEqual([]);
  });

  it('a booking the database refuses answers its MAKEUP_REFUSED, nothing else written', async () => {
    remedy = remedyRow({ status: 'counter_proposed', counter: PENDING_COUNTER });
    bookRefusal = new DomainError('MAKEUP_REFUSED');
    expect(
      (await refusalOf(services().accept({ userId: STUDENT }, { sessionId: SESSION }, log))).code,
    ).toBe('MAKEUP_REFUSED');
    expect(calls.at(-1)).not.toEqual(['commit']);
  });
});

describe('sessions.remedy.counterOptions (T031; H2, H4; Q5 (a))', () => {
  /** The occurrences each slot offers once its earlier weeks are busy (this file's head). */
  const MONDAY_FREE = {
    slotId: MONDAY_SLOT,
    localDate: '2026-11-16',
    startTimeLocal: '18:00',
    timezone: 'Africa/Cairo',
    startsAt: '2026-11-16T16:00:00Z',
  };
  const RIYADH_FREE = {
    slotId: RIYADH_SLOT,
    localDate: '2026-11-19',
    startTimeLocal: '20:00',
    timezone: 'Asia/Riyadh',
    startsAt: '2026-11-19T17:00:00Z',
  };
  const OWN_FREE = {
    slotId: OWN_SLOT,
    localDate: '2026-11-22',
    startTimeLocal: '09:00',
    timezone: 'Africa/Cairo',
    startsAt: '2026-11-22T07:00:00Z',
  };

  beforeEach(() => {
    busy = {
      // The teacher's session on the Monday slot's first week, 2026-11-09 18:00 in Cairo.
      sessions: [
        {
          startsAt: new Date('2026-11-09T16:00:00.000Z'),
          endsAt: new Date('2026-11-09T17:00:00.000Z'),
        },
      ],
      // A hold of either party on the Sunday slot's first week at or after C, 2026-11-15.
      held: [
        {
          startsAt: new Date('2026-11-15T07:00:00.000Z'),
          endsAt: new Date('2026-11-15T08:00:00.000Z'),
        },
      ],
      // Another remedy's reservation over the Riyadh slot's first week, 2026-11-12.
      reserved: [
        {
          remedyId: OTHER_REMEDY,
          sessionId: NOWHERE,
          startsAt: new Date('2026-11-12T17:30:00.000Z'),
          endsAt: new Date('2026-11-12T18:30:00.000Z'),
        },
      ],
    };
  });

  it("another package's slot (the owner's rule of 2026-11-10): one read for every slot, its own enrollment left out; a slot kept on every date no option, one held until a release searched from it", async () => {
    // The Monday slot another confirmed package keeps; the Riyadh slot a completed one holds
    // until Tuesday 2026-11-24, so its first Thursday from then, 2026-11-26.
    freeFrom = new Map([
      [MONDAY_SLOT, null],
      [RIYADH_SLOT, '2026-11-24'],
    ]);
    const { options } = await services().counterOptions(
      { userId: STUDENT },
      { sessionId: SESSION },
      log,
    );
    expect(options).toEqual([
      OWN_FREE,
      { ...RIYADH_FREE, localDate: '2026-11-26', startsAt: '2026-11-26T17:00:00Z' },
    ]);
    expect(freeFromReads).toEqual([
      {
        slotIds: expect.arrayContaining([OWN_SLOT, MONDAY_SLOT, RIYADH_SLOT]),
        enrollmentId: ENROLLMENT,
      },
    ]);
  });

  it('006:T005 (N-12): steps over a week over the student’s other active programme’s weekly time, asking for the student alone, this enrollment’s own left out', async () => {
    programmeAsked = [];
    busy.programme = [
      {
        startsAt: new Date('2026-11-19T17:30:00.000Z'),
        endsAt: new Date('2026-11-19T18:30:00.000Z'),
      },
    ];
    const { options } = await services().counterOptions(
      { userId: STUDENT },
      { sessionId: SESSION },
      log,
    );
    expect(options).toContainEqual({
      ...RIYADH_FREE,
      localDate: '2026-11-26',
      startsAt: '2026-11-26T17:00:00Z',
    });
    expect(programmeAsked.length).toBeGreaterThan(0);
    expect(new Set(programmeAsked.map((asked) => JSON.stringify(asked)))).toEqual(
      new Set([JSON.stringify([[STUDENT], ENROLLMENT])]),
    );
  });

  it('per active slot of the session’s length, its first free occurrence at or after max(now + A + L, C), by start, in each slot’s zone', async () => {
    expect(
      await services().counterOptions({ userId: STUDENT }, { sessionId: SESSION }, log),
    ).toEqual({
      options: [MONDAY_FREE, RIYADH_FREE, OWN_FREE],
    });
    expect(locks()).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it('the bound is now + A + L once it passes C, A and L the remedy’s own (a later settings change moves nothing)', async () => {
    // now + A + L = 2026-11-17T08:00Z: the Monday slot moves to 2026-11-23, the Riyadh to
    // 2026-11-19, the Sunday to 2026-11-22.
    now = new Date('2026-11-07T07:59:59.000Z');
    remedy = remedyRow({ snapshotAnswerWindowHours: 216 });
    const { options } = await services().counterOptions(
      { userId: STUDENT },
      { sessionId: SESSION },
      log,
    );
    expect(options.map(({ slotId, localDate }) => [slotId, localDate])).toEqual([
      [RIYADH_SLOT, '2026-11-19'],
      [OWN_SLOT, '2026-11-22'],
      [MONDAY_SLOT, '2026-11-23'],
    ]);
  });

  it('an occurrence starting at the bound is offered; one a minute before it is not (the lead included)', async () => {
    busy = { sessions: [], held: [], reserved: [] };
    // Bound = now + 72 h + 24 h = 2026-11-16T16:00Z, the Monday slot's start that day.
    now = new Date('2026-11-12T16:00:00.000Z');
    remedy = remedyRow({ choiceClosesAt: new Date('2026-11-13T08:00:00.000Z') });
    let { options } = await services().counterOptions(
      { userId: STUDENT },
      { sessionId: SESSION },
      log,
    );
    expect(options.find(({ slotId }) => slotId === MONDAY_SLOT)?.localDate).toBe('2026-11-16');
    now = new Date(addMinutes(now, 1));
    remedy = remedyRow({ choiceClosesAt: new Date('2026-11-13T08:00:00.000Z') });
    ({ options } = await services().counterOptions(
      { userId: STUDENT },
      { sessionId: SESSION },
      log,
    ));
    expect(options.find(({ slotId }) => slotId === MONDAY_SLOT)?.localDate).toBe('2026-11-23');
  });

  it('a pending counter COUNTER_PENDING; a frozen remedy, or one past C, REMEDY_NOT_OPEN', async () => {
    remedy = remedyRow({ status: 'counter_proposed', counter: PENDING_COUNTER });
    expect(
      (await refusalOf(services().counterOptions({ userId: STUDENT }, { sessionId: SESSION }, log)))
        .code,
    ).toBe('COUNTER_PENDING');
    remedy = remedyRow({ status: 'frozen' });
    expect(
      (await refusalOf(services().counterOptions({ userId: STUDENT }, { sessionId: SESSION }, log)))
        .code,
    ).toBe('REMEDY_NOT_OPEN');
    remedy = remedyRow();
    now = CHOICE_CLOSES;
    expect(
      (await refusalOf(services().counterOptions({ userId: STUDENT }, { sessionId: SESSION }, log)))
        .code,
    ).toBe('REMEDY_NOT_OPEN');
  });
});

describe('sessions.remedy.counter (T031; FR-465; D1; H2)', () => {
  const asked = (localDate: string, slotId = MONDAY_SLOT) => ({
    sessionId: SESSION,
    slotId,
    localDate,
    idempotencyKey: KEY,
  });

  it('keyed as sessions.remedy.counter; the kernel’s locks; the option written with counter_proposed_at = now and one counter_proposed row', async () => {
    const view = await services().counter({ userId: STUDENT }, asked('2026-11-09'), log);
    expect(keyed).toEqual([
      {
        scope: 'sessions.remedy.counter',
        key: KEY,
        actorId: STUDENT,
        input: { sessionId: SESSION, slotId: MONDAY_SLOT, localDate: '2026-11-09' },
      },
    ]);
    expect(locks()).toEqual(CHOICE_LOCKS);
    const counter = {
      slotId: MONDAY_SLOT,
      date: new Date('2026-11-09T00:00:00.000Z'),
      startTimeLocal: new Date('1970-01-01T18:00:00.000Z'),
      timezone: 'Africa/Cairo',
      proposedAt: NOW,
    };
    expect(writes()).toEqual([
      ['writeCounter', REMEDY, counter],
      [
        'recordEvents',
        [
          {
            enrollmentId: ENROLLMENT,
            sessionId: SESSION,
            kind: 'counter_proposed',
            counterSlotId: MONDAY_SLOT,
            counterDate: counter.date,
            counterStartTimeLocal: counter.startTimeLocal,
            counterTimezone: 'Africa/Cairo',
            occurredAt: NOW,
          },
        ],
      ],
    ]);
    expect(view.status).toBe('counter_proposed');
    // The answer window's close is computed, never stored: NOW + A (D1).
    expect(view.counter).toEqual({
      localDate: '2026-11-09',
      startTimeLocal: '18:00',
      timezone: 'Africa/Cairo',
      startsAt: '2026-11-09T16:00:00Z',
      answerClosesAt: '2026-11-06T08:00:00.000Z',
    });
  });

  it('a counter in the slot’s own zone takes that zone (counter_timezone, 003:T077)', async () => {
    await services().counter({ userId: STUDENT }, asked('2026-11-12', RIYADH_SLOT), log);
    expect(calls.find(([name]) => name === 'writeCounter')?.[2]).toMatchObject({
      timezone: 'Asia/Riyadh',
    });
  });

  it('a slot or a date that is not an option SLOT_NOT_OFFERED: a later week, a busy week, another length, an inactive or unknown slot', async () => {
    busy.sessions = [
      {
        startsAt: new Date('2026-11-09T16:00:00.000Z'),
        endsAt: new Date('2026-11-09T17:00:00.000Z'),
      },
    ];
    for (const [localDate, slotId] of [
      ['2026-11-23', MONDAY_SLOT],
      ['2026-11-09', MONDAY_SLOT],
      ['2026-11-10', SHORT_SLOT],
      ['2026-11-11', INACTIVE_SLOT],
      ['2026-11-09', NOWHERE],
    ] as const) {
      expect(
        (await refusalOf(services().counter({ userId: STUDENT }, asked(localDate, slotId), log)))
          .code,
      ).toBe('SLOT_NOT_OFFERED');
    }
    expect(writes()).toEqual([]);
  });

  it('one pending at a time COUNTER_PENDING; past C, or a frozen remedy, REMEDY_NOT_OPEN', async () => {
    remedy = remedyRow({ status: 'counter_proposed', counter: PENDING_COUNTER });
    expect(
      (await refusalOf(services().counter({ userId: STUDENT }, asked('2026-11-09'), log))).code,
    ).toBe('COUNTER_PENDING');
    remedy = remedyRow({ status: 'frozen' });
    expect(
      (await refusalOf(services().counter({ userId: STUDENT }, asked('2026-11-09'), log))).code,
    ).toBe('REMEDY_NOT_OPEN');
    remedy = remedyRow();
    now = CHOICE_CLOSES;
    expect(
      (await refusalOf(services().counter({ userId: STUDENT }, asked('2026-11-09'), log))).code,
    ).toBe('REMEDY_NOT_OPEN');
    expect(writes()).toEqual([]);
  });

  it('a second counter after a decline reads the options again (H4)', async () => {
    remedy = remedyRow({ status: 'proposed' });
    await services().counter({ userId: STUDENT }, asked('2026-11-09'), log);
    remedy = remedyRow({ status: 'proposed' });
    busy.reserved = [];
    busy.sessions = [
      {
        startsAt: new Date('2026-11-09T16:00:00.000Z'),
        endsAt: new Date('2026-11-09T17:00:00.000Z'),
      },
    ];
    expect(
      (await refusalOf(services().counter({ userId: STUDENT }, asked('2026-11-09'), log))).code,
    ).toBe('SLOT_NOT_OFFERED');
    await services().counter({ userId: STUDENT }, asked('2026-11-16'), log);
    expect(calls.filter(([name]) => name === 'writeCounter')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// T032: the teacher's answer and the windows' ends.
// ---------------------------------------------------------------------------------------------

/** The pending counter of this file's head: Monday 2026-11-16 18:00 in Cairo, proposed COUNTER_AT. */
const counterPending = (values: Partial<RemedyRow> = {}) =>
  remedyRow({ status: 'counter_proposed', counter: PENDING_COUNTER, ...values });

/** The lines the teacher's answer or the sweep wrote, by level, their standard fields left out. */
function linesAt(level: string): Record<string, unknown>[] {
  return lines
    .filter((line) => line.level === level)
    .map(({ msg: _msg, level: _level, time: _time, pid: _pid, hostname: _host, ...rest }) => rest);
}

/** The booking's locks for a counter: both slots after the key, in id order (L2). */
const COUNTER_LOCKS = [
  ['lockAccounts', [TEACHER, STUDENT]],
  ['lockTeacherSlots', TEACHER],
  ['lockSlots', [OWN_SLOT, MONDAY_SLOT]],
  ['lockEnrollments', [ENROLLMENT]],
  ['lockSessions', [SESSION]],
  ['lockRemedyOfSession', SESSION],
];

const answer = (accept: boolean, userId = TEACHER) =>
  services().answerCounter({ userId }, { sessionId: SESSION, accept }, log);

describe('sessions.remedy.answerCounter: who and when (T032; D1)', () => {
  beforeEach(() => {
    remedy = counterPending();
  });

  it('the student, a stranger, an id that never existed and the other gender answer NOT_FOUND, writing nothing', async () => {
    for (const userId of [STUDENT, STRANGER]) {
      expect((await refusalOf(answer(true, userId))).code).toBe('NOT_FOUND');
    }
    expect(
      (
        await refusalOf(
          services().answerCounter({ userId: TEACHER }, { sessionId: NOWHERE, accept: true }, log),
        )
      ).code,
    ).toBe('NOT_FOUND');
    genders.set(STUDENT, 'male');
    expect((await refusalOf(answer(false))).code).toBe('NOT_FOUND');
    expect(writes()).toEqual([]);
  });

  it('no counter pending, or a frozen remedy, REMEDY_NOT_OPEN, writing nothing', async () => {
    for (const status of ['proposed', 'awaiting_choice', 'frozen', 'booked'] as const) {
      remedy = remedyRow({ status });
      for (const accept of [true, false]) {
        expect((await refusalOf(answer(accept))).code).toBe('REMEDY_NOT_OPEN');
      }
    }
    expect(writes()).toEqual([]);
  });

  it('at answerClosesAt REMEDY_NOT_OPEN, from the snapshot A and not a later setting; one millisecond before, admitted (D1)', async () => {
    now = ANSWER_CLOSES;
    expect((await refusalOf(answer(false))).code).toBe('REMEDY_NOT_OPEN');
    expect(writes()).toEqual([]);
    now = new Date('2026-11-07T09:59:59.999Z');
    await answer(false);
    expect(writes()[0]).toEqual(['releaseCounter', REMEDY]);
  });
});

describe('sessions.remedy.answerCounter: accept (T032; FR-465, FR-468; A3, A7)', () => {
  beforeEach(() => {
    remedy = counterPending();
  });

  it('books the counter through T029 as sessions.remedy.answerCounter, both slots locked after the key, one counter_accepted row first', async () => {
    const view = await answer(true);
    expect(calls.find(([name]) => name === 'run')).toEqual([
      'run',
      { remedyId: REMEDY, operation: 'sessions.remedy.answerCounter' },
    ]);
    expect(locks()).toEqual(COUNTER_LOCKS);
    expect(writes()).toEqual([
      [
        'recordEvents',
        [
          {
            enrollmentId: ENROLLMENT,
            sessionId: SESSION,
            kind: 'counter_accepted',
            occurredAt: NOW,
          },
        ],
      ],
      [
        'bookOn',
        { remedyId: REMEDY, booking: 'counter', operation: 'sessions.remedy.answerCounter' },
      ],
    ]);
    expect(view.status).toBe('booked');
    expect(view.makeupSessionId).toBe(MAKEUP);
  });

  it('refused by the database inside the choice window: MAKEUP_REFUSED, the counter released in a second transaction under the same locks, one counter_booking_refused row and one warn line naming the constraint', async () => {
    bookRefusal = new RefusedBooking(OVERLAP);
    expect((await refusalOf(answer(true))).code).toBe('MAKEUP_REFUSED');
    const second = calls.slice(
      calls.lastIndexOf(calls.findLast(([name]) => name === 'begin') ?? []),
    );
    expect(
      second.filter(([name]) => String(name).startsWith('lock')).map(([name, ids]) => [name, ids]),
    ).toEqual(COUNTER_LOCKS);
    expect(writes().slice(-2)).toEqual([
      ['releaseCounter', REMEDY],
      [
        'recordEvents',
        [
          {
            enrollmentId: ENROLLMENT,
            sessionId: SESSION,
            kind: 'counter_booking_refused',
            occurredAt: NOW,
          },
        ],
      ],
    ]);
    expect(
      calls.filter(
        ([name, events]) =>
          name === 'recordEvents' &&
          (events as SessionEventRecord[]).some(({ kind }) => kind === 'counter_withdrawn'),
      ),
    ).toEqual([]);
    expect(linesAt('warn')).toEqual([
      { sessionId: SESSION, enrollmentId: ENROLLMENT, constraint: 'sessions_teacher_no_overlap' },
    ]);
    expect(remedy?.status).toBe('proposed');
    expect(calls.filter(([name]) => name === 'book')).toEqual([]);
  });

  it('refused by the database after the choice window: released, then the proposal booked, never a counter_unanswered refund', async () => {
    now = new Date('2026-11-08T09:00:00.000Z');
    remedy = counterPending({
      counter: { ...PENDING_COUNTER, proposedAt: new Date('2026-11-07T12:00:00.000Z') },
    });
    bookRefusal = new RefusedBooking({
      cause: 'overlap',
      constraint: 'sessions_student_no_overlap',
    });
    expect((await refusalOf(answer(true))).code).toBe('MAKEUP_REFUSED');
    expect(calls.filter(([name]) => name === 'book')).toEqual([
      [
        'book',
        { remedyId: REMEDY, booking: 'proposal', operation: 'sessions.remedy.answerCounter' },
      ],
    ]);
    expect(handedOff).toEqual([]);
    expect(linesAt('warn')).toEqual([
      { sessionId: SESSION, enrollmentId: ENROLLMENT, constraint: 'sessions_student_no_overlap' },
    ]);
  });

  it("refused slot_taken (a week another package keeps), inside the choice window: released as the database's refusal is, one counter_booking_refused row, one warn line naming slot_taken (the owner's decision (b) under T032)", async () => {
    bookRefusal = new RefusedBooking({ cause: 'slot_taken' });
    expect((await refusalOf(answer(true))).code).toBe('MAKEUP_REFUSED');
    expect(writes().slice(-2)).toEqual([
      ['releaseCounter', REMEDY],
      [
        'recordEvents',
        [
          {
            enrollmentId: ENROLLMENT,
            sessionId: SESSION,
            kind: 'counter_booking_refused',
            occurredAt: NOW,
          },
        ],
      ],
    ]);
    expect(linesAt('warn')).toEqual([
      { sessionId: SESSION, enrollmentId: ENROLLMENT, constraint: 'slot_taken' },
    ]);
    expect(remedy?.status).toBe('proposed');
    expect(calls.filter(([name]) => name === 'book')).toEqual([]);
  });

  it('refused slot_taken after the choice window: released, then the proposal booked, never a counter_unanswered refund', async () => {
    now = new Date('2026-11-08T09:00:00.000Z');
    remedy = counterPending({
      counter: { ...PENDING_COUNTER, proposedAt: new Date('2026-11-07T12:00:00.000Z') },
    });
    bookRefusal = new RefusedBooking({ cause: 'slot_taken' });
    expect((await refusalOf(answer(true))).code).toBe('MAKEUP_REFUSED');
    expect(calls.filter(([name]) => name === 'book')).toEqual([
      [
        'book',
        { remedyId: REMEDY, booking: 'proposal', operation: 'sessions.remedy.answerCounter' },
      ],
    ]);
    expect(handedOff).toEqual([]);
  });

  it('a reserved time or a second deadlock refuses with the counter left pending, nothing released and no warn line of its own (Q4 (a))', async () => {
    for (const made of [{ cause: 'reserved' }, { cause: 'deadlock' }] as const) {
      remedy = counterPending();
      bookRefusal = new RefusedBooking(made);
      expect((await refusalOf(answer(true))).code).toBe('MAKEUP_REFUSED');
      expect(remedy?.status).toBe('counter_proposed');
    }
    expect(calls.filter(([name]) => name === 'releaseCounter')).toEqual([]);
    expect(linesAt('warn')).toEqual([]);
  });
});

describe('sessions.remedy.answerCounter: decline (T032; FR-465; H4; decision 9)', () => {
  beforeEach(() => {
    remedy = counterPending();
  });

  it('inside the choice window: the counter released, one counter_declined row, the remedy proposed, nothing booked; the kernel’s counter row', async () => {
    const view = await answer(false);
    expect(locks()).toEqual(CHOICE_LOCKS);
    expect(writes()).toEqual([
      ['releaseCounter', REMEDY],
      [
        'recordEvents',
        [
          {
            enrollmentId: ENROLLMENT,
            sessionId: SESSION,
            kind: 'counter_declined',
            occurredAt: NOW,
          },
        ],
      ],
    ]);
    expect(view.status).toBe('proposed');
    expect(view.counter).toBeUndefined();
  });

  it('after the choice window: released, then the proposal booked; a refused booking leaves the remedy proposed for the sweep and the decline answered', async () => {
    now = new Date('2026-11-08T09:00:00.000Z');
    remedy = counterPending({
      counter: { ...PENDING_COUNTER, proposedAt: new Date('2026-11-07T12:00:00.000Z') },
    });
    expect((await answer(false)).status).toBe('booked');
    expect(calls.filter(([name]) => name === 'book')).toHaveLength(1);
    remedy = counterPending({
      counter: { ...PENDING_COUNTER, proposedAt: new Date('2026-11-07T12:00:00.000Z') },
    });
    proposalRefusal = new RefusedBooking(OVERLAP);
    expect((await answer(false)).status).toBe('proposed');
  });
});

describe('advance-remedies: a counter’s answer window ends (T032; FR-465; D1)', () => {
  beforeEach(() => {
    remedy = counterPending();
  });

  // T111 of specs/003-booking (DEC-84; ADR 0025 D5; FR-MAKEUP-3 as amended): a counter left
  // unanswered releases its time and the system's proposal is booked, as after a decline once the
  // choice window has closed; no `counter_unanswered` case is opened.
  it('before answerClosesAt nothing; at it, the counter released under the kernel’s counter row, then the proposal booked as advance-remedies on its own transaction, no case (T111)', async () => {
    now = new Date('2026-11-07T09:59:59.999Z');
    expect(await windows().endAnswerWindow(REMEDY)).toBe('not_due');
    expect(writes()).toEqual([]);
    now = ANSWER_CLOSES;
    expect(await windows().endAnswerWindow(REMEDY)).toBe('booked');
    expect(handedOff).toEqual([]);
    expect(writes()).toEqual([['releaseCounter', REMEDY]]);
    const bookAt = calls.findIndex(([name]) => name === 'book');
    expect(calls[bookAt]).toEqual([
      'book',
      { remedyId: REMEDY, booking: 'proposal', operation: 'advance-remedies' },
    ]);
    const release = calls.slice(
      calls.slice(0, bookAt).findLastIndex(([name]) => name === 'begin'),
      bookAt,
    );
    expect(
      release.filter(([name]) => String(name).startsWith('lock')).map(([name, ids]) => [name, ids]),
    ).toEqual(CHOICE_LOCKS);
    expect(release).toContainEqual(['releaseCounter', REMEDY]);
    expect(release.at(-1)).toEqual(['commit']);
    expect(remedy?.status).toBe('booked');
    expect(linesAt('info')).toEqual([
      {
        remedyId: REMEDY,
        sessionId: SESSION,
        enrollmentId: ENROLLMENT,
        action: 'counter_unanswered',
      },
      { remedyId: REMEDY, sessionId: SESSION, enrollmentId: ENROLLMENT, action: 'booked' },
    ]);
  });

  it('after the choice window too: released, then the proposal booked, no case (T111)', async () => {
    now = new Date('2026-11-08T09:00:00.000Z');
    expect(await windows().endAnswerWindow(REMEDY)).toBe('booked');
    expect(handedOff).toEqual([]);
    expect(calls.filter(([name]) => name === 'book')).toHaveLength(1);
  });

  it('a refused booking leaves the counter released and the remedy proposed for the sweep, one warn line { remedyId, sessionId, constraint }; a second deadlock no line; no case either way (T111)', async () => {
    now = ANSWER_CLOSES;
    proposalRefusal = new RefusedBooking(OVERLAP);
    expect(await windows().endAnswerWindow(REMEDY)).toBe('refused');
    expect(remedy).toMatchObject({ status: 'proposed', counter: null });
    expect(linesAt('warn')).toEqual([
      { remedyId: REMEDY, sessionId: SESSION, constraint: 'sessions_teacher_no_overlap' },
    ]);
    remedy = counterPending();
    proposalRefusal = new RefusedBooking({ cause: 'deadlock' });
    expect(await windows().endAnswerWindow(REMEDY)).toBe('deadlocked');
    expect(remedy).toMatchObject({ status: 'proposed', counter: null });
    expect(linesAt('warn')).toHaveLength(1);
    expect(handedOff).toEqual([]);
    expect(reported).toEqual([]);
  });

  it('a remedy another path settled between the release and the booking (REMEDY_NOT_OPEN) is left as it is, no failure thrown (T111)', async () => {
    now = ANSWER_CLOSES;
    proposalRefusal = new DomainError('REMEDY_NOT_OPEN');
    expect(await windows().endAnswerWindow(REMEDY)).toBe('not_due');
    expect(linesAt('warn')).toEqual([]);
    expect(handedOff).toEqual([]);
  });

  it('a remedy no longer counter_proposed, frozen among them, is left as it is', async () => {
    for (const status of ['proposed', 'frozen', 'booked'] as const) {
      remedy = remedyRow({ status });
      expect(await windows().endAnswerWindow(REMEDY)).toBe('not_due');
    }
    expect(handedOff).toEqual([]);
  });
});

describe('advance-remedies: the choice window ends, and a refused proposal is retried (T032; H5; A3; Q4 (a), Q11 (a))', () => {
  /** The proposal starts 2026-12-06T07:00Z; L = 24 h: retried until 2026-12-05T07:00Z. */
  const RETRIED_UNTIL = new Date('2026-12-05T07:00:00.000Z');
  const PROPOSAL_LOCKS = [
    ['lockAccounts', [TEACHER, STUDENT]],
    ['lockTeacherSlots', TEACHER],
    ['lockSlots', [OWN_SLOT]],
    ['lockEnrollments', [ENROLLMENT]],
    ['lockSessions', [SESSION]],
    ['lockRemedyOfSession', SESSION],
  ];

  beforeEach(() => {
    now = CHOICE_CLOSES;
  });

  it('before choice_closes_at nothing; at it, the proposal booked as advance-remedies under the booking’s locks, one info line after the commit', async () => {
    now = new Date('2026-11-08T07:59:59.999Z');
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('not_due');
    expect(booked).toEqual([]);
    now = CHOICE_CLOSES;
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('booked');
    expect(calls.find(([name]) => name === 'run')).toEqual([
      'run',
      { remedyId: REMEDY, operation: 'advance-remedies' },
    ]);
    expect(booked.map(({ input }) => input)).toEqual([
      { remedyId: REMEDY, booking: 'proposal', operation: 'advance-remedies' },
    ]);
    expect(locks().slice(-PROPOSAL_LOCKS.length)).toEqual(PROPOSAL_LOCKS);
    expect(linesAt('info')).toEqual([
      { remedyId: REMEDY, sessionId: SESSION, enrollmentId: ENROLLMENT, action: 'booked' },
    ]);
  });

  it('an awaiting_choice remedy is booked as well; a counter_proposed or frozen one is left', async () => {
    remedy = remedyRow({ status: 'awaiting_choice' });
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('booked');
    for (const values of [
      { status: 'frozen' as const },
      { status: 'counter_proposed' as const, counter: PENDING_COUNTER },
    ]) {
      remedy = remedyRow(values);
      expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('not_due');
    }
    expect(booked).toHaveLength(1);
  });

  it('a refusal by the database is one warn line { remedyId, sessionId, constraint } and nothing else, nothing reported', async () => {
    bookRefusal = new RefusedBooking(OVERLAP);
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('refused');
    expect(linesAt('warn')).toEqual([
      { remedyId: REMEDY, sessionId: SESSION, constraint: 'sessions_teacher_no_overlap' },
    ]);
    expect(linesAt('info')).toEqual([]);
    expect(reported).toEqual([]);
    expect(remedy?.status).toBe('proposed');
  });

  it('a retry over an open hold or a reservation of either party is refused too, the hold read under the booking’s locks', async () => {
    busy.held = [
      {
        startsAt: new Date('2026-12-06T07:30:00.000Z'),
        endsAt: new Date('2026-12-06T08:30:00.000Z'),
      },
    ];
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('refused');
    expect(booked).toEqual([]);
    busy.held = [];
    bookRefusal = new RefusedBooking({ cause: 'reserved' });
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('refused');
    expect(linesAt('warn')).toEqual([
      { remedyId: REMEDY, sessionId: SESSION, constraint: 'hold' },
      { remedyId: REMEDY, sessionId: SESSION, constraint: 'reservation' },
    ]);
  });

  it('a second deadlock is no refusal: nothing written, no line of its own, tried again next run', async () => {
    bookRefusal = new RefusedBooking({ cause: 'deadlock' });
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('deadlocked');
    expect(linesAt('warn')).toEqual([]);
    expect(handedOff).toEqual([]);
  });

  it('retried up to the last instant L before the proposal’s start; past it, handed to a makeup_refused case, one info line, error tracking told once', async () => {
    bookRefusal = new RefusedBooking(OVERLAP);
    now = RETRIED_UNTIL;
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('refused');
    expect(handedOff).toEqual([]);
    now = new Date('2026-12-05T07:00:00.001Z');
    expect(await windows().bookAtChoiceEnd(REMEDY)).toBe('handed_off');
    expect(handedOff).toEqual([{ remedyId: REMEDY, reason: 'makeup_refused' }]);
    expect(booked).toHaveLength(1);
    expect(linesAt('info')).toEqual([
      { remedyId: REMEDY, sessionId: SESSION, enrollmentId: ENROLLMENT, action: 'makeup_refused' },
    ]);
    expect(reported).toHaveLength(1);
  });
});
