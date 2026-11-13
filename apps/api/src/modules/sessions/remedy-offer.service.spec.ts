// T028 of specs/004-sessions/tasks.md (FR-424, FR-462 to FR-464; research R-311, "Offering", "The
// proposal" and "Frozen"; plan.md decisions 5 and 9, H1; the notes under T028, Q8, Q10) — one offer
// over a recorded store and enrollment side: what is owed and when (the dispute window by the
// database's clock, a disputed or Student-No-Show session none, a Cancelled-By-Agreement session at
// once, a cleared suspension's only when T036 says so), on a confirmed enrollment only and never to a
// suspended student; the row's `offered_at`, `choice_closes_at` and A and L fixed then; its status by
// the debt; the proposal on the enrollment's slot at its local start in its zone, the first week after
// its last session and its other proposals, at or after C + A + L, skipping a week the slot is taken,
// a week over a session, a reservation or an open hold of either party, resolved per date across a
// DST change; a frozen remedy offered again as a new offer; one `remedy_offered` row; and the offer
// row's locks. Over the real tables: `tests/db-integrity/remedy-offer.spec.ts`.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { EnrollmentSide, EnrollmentTerms, HeldTime } from './enrollment-side.port.js';
import type { ExistingRemedy, OfferedRow, OfferSession } from './remedy-offer.repository.js';
import type { ReservedTime } from './reservations.service.js';
import { createRemedyOffer, type RemedyOfferStore } from './remedy-offer.service.js';
import { remedyViewOf } from './remedy-offer.view.js';
import type { SessionEventRecord } from './session-events.repository.js';
import type { SessionTime } from './sessions.repository.js';

const tx = {} as Transaction;
const CAIRO = 'Africa/Cairo';
const SESSION = '0199d0a0-0000-7000-8000-0000000000d1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a2';
const SLOT = '0199d0a0-0000-7000-8000-0000000000b1';
const REMEDY = '0199d0a0-0000-7000-8000-0000000000c1';

const SETTINGS: Record<string, number> = {
  dispute_window_hours: 72,
  makeup_choice_window_days: 7,
  makeup_counter_answer_hours: 72,
  first_session_lead_hours: 24,
};

let trace: string[];
let session: OfferSession;
let existing: ExistingRemedy | null;
let terms: EnrollmentTerms | null;
let suspended: boolean;
/** T071: the teacher suspended, read under the locks (N2). */
let teacherSuspended: boolean;
let standingReads: string[];
let lastReached: Date | null;
let takenDates: Set<string>;
/** Every week of the slot taken: the bug the search's bound guards against. */
let everyWeekTaken: boolean;
let warnings: { readonly fields: unknown; readonly message: string }[];
let ownSessions: SessionTime[];
let held: HeldTime[];
let reserved: ReservedTime[];
let now: Date;
let inserted: { sessionId: string; row: OfferedRow }[];
let reoffered: { remedyId: string; row: OfferedRow; fromCase?: string }[];
let events: SessionEventRecord[];

const store: RemedyOfferStore = {
  offerSessionOf: async () => session,
  remedyOfSession: async () => existing,
  lockAccounts: async (_tx, ids) => void trace.push(`lock users ${ids.join(',')}`),
  lockTeacherSlots: async (_tx, teacher) => void trace.push(`lock key teacher-slots ${teacher}`),
  lockSessions: async (_tx, ids) => void trace.push(`lock sessions ${ids.join(',')}`),
  lockRemedyOfSession: async (_tx, id) => void trace.push(`lock remedies of ${id}`),
  studentSuspended: async () => suspended,
  teacherSuspended: async (_tx, userId) => {
    standingReads.push(userId);
    return teacherSuspended;
  },
  // Thursday 09:00 Cairo.
  slotOf: async () => ({
    id: SLOT,
    dayOfWeek: 4,
    startTimeLocal: '09:00:00',
    durationMinutes: 60,
    timezone: CAIRO,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }),
  lastReachedDateOf: async () => lastReached,
  sessionsBetween: async (_tx, _parties, window) =>
    ownSessions.filter(({ startsAt, endsAt }) => startsAt < window.to && window.from < endsAt),
  reservedTimesOf: async (_tx, _users, window) =>
    reserved.filter(({ startsAt, endsAt }) => startsAt < window.to && window.from < endsAt),
  insertRemedy: async (_tx, sessionId, row) => {
    trace.push('insert remedy');
    inserted.push({ sessionId, row });
    return REMEDY;
  },
  reofferFrozen: async (_tx, remedyId, row, fromCase) => {
    trace.push('re-offer remedy');
    reoffered.push({ remedyId, row, ...(fromCase === undefined ? {} : { fromCase }) });
    return true;
  },
  recordEvents: async (_tx, records) => {
    trace.push(`record ${records.map(({ kind }) => kind).join(',')}`);
    events.push(...records);
  },
};

const enrollments = {
  enrollmentFor: async () => terms,
  lockEnrollments: async (_tx: Transaction, ids: readonly string[]) =>
    void trace.push(`lock enrollments ${ids.join(',')}`),
  slotWeekTaken: async (_tx: Transaction, _slot: string, date: string) =>
    everyWeekTaken || takenDates.has(date),
  heldTimesOf: async (
    _tx: Transaction,
    _users: readonly string[],
    window: { from: Date; to: Date },
  ) => held.filter(({ startsAt, endsAt }) => startsAt < window.to && window.from < endsAt),
} as unknown as EnrollmentSide;

function offerOf() {
  return createRemedyOffer({
    enrollments,
    settings: { read: async (key, schema) => schema.parse(SETTINGS[key]) },
    clock: async () => now,
    store: { ...store },
    log: {
      warn: (fields: unknown, message: string) => void warnings.push({ fields, message }),
    } as unknown as NonNullable<Parameters<typeof createRemedyOffer>[0]['log']>,
  });
}

beforeEach(() => {
  trace = [];
  // The last of four Thursdays, 2026-11-26 09:00 Cairo, a Teacher-No-Show.
  session = {
    id: SESSION,
    enrollmentId: ENROLLMENT,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
    status: 'teacher_no_show',
    scheduledEndAt: new Date('2026-11-26T08:00:00Z'),
  };
  existing = null;
  terms = {
    id: ENROLLMENT,
    status: 'confirmed',
    slotId: SLOT,
    track: 'recitation',
    timezone: CAIRO,
    durationMinutes: 60,
    sessionCount: 4,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
  };
  suspended = false;
  teacherSuspended = false;
  standingReads = [];
  lastReached = new Date('2026-11-26T00:00:00Z');
  takenDates = new Set();
  everyWeekTaken = false;
  warnings = [];
  ownSessions = [];
  held = [];
  reserved = [];
  // The dispute window's close: the scheduled end plus 72 hours.
  now = new Date('2026-11-29T08:00:00Z');
  inserted = [];
  reoffered = [];
  events = [];
});

describe('remedy offer: what is owed and when (FR-462, G1, A2, C1, C3)', () => {
  it('offers nothing inside the dispute window, and the remedy at its close by the database’s clock', async () => {
    now = new Date('2026-11-29T07:59:59.999Z');
    expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
    expect(inserted).toEqual([]);
    now = new Date('2026-11-29T08:00:00Z');
    expect(await offerOf().offerLocked(tx, SESSION)).toMatchObject({ remedyId: REMEDY });
  });

  it.each(['disputed', 'student_no_show', 'done', 'scheduled', 'cancelled_by_admin'])(
    'offers nothing for a session %s',
    async (status) => {
      session = { ...session, status };
      expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
      expect(inserted).toEqual([]);
    },
  );

  it('offers a Cancelled-By-Agreement session at once, with no window to wait (decision 5)', async () => {
    session = { ...session, status: 'cancelled_by_agreement' };
    now = new Date('2026-11-26T08:00:00Z');
    expect(await offerOf().offerLocked(tx, SESSION)).toMatchObject({ status: 'proposed' });
  });

  it('offers a cancelled_by_admin session only for T036’s cleared suspension, refundable on recitation', async () => {
    session = { ...session, status: 'cancelled_by_admin' };
    expect(await offerOf().offerLocked(tx, SESSION, { clearedSuspension: true })).toMatchObject({
      status: 'awaiting_choice',
    });
  });

  it('offers nothing on an enrollment no longer confirmed, nor to a suspended student', async () => {
    terms = terms === null ? null : { ...terms, status: 'completed' };
    expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
    terms = terms === null ? null : { ...terms, status: 'confirmed' };
    suspended = true;
    expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
    expect(inserted).toEqual([]);
  });

  // T071 (N2): a paused enrollment’s frozen remedy, or any session of it, waits for the teacher’s
  // reinstatement; the sweep tries it again each run.
  it('offers nothing while the teacher is suspended, reading the teacher’s standing, a frozen remedy included (T071, N2)', async () => {
    teacherSuspended = true;
    expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
    existing = { id: REMEDY, status: 'frozen', kind: 'makeup', caseId: null };
    expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
    expect(standingReads).toEqual([TEACHER, TEACHER]);
    expect(inserted).toEqual([]);
    expect(reoffered).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('offers nothing to a session that already has an open or settled remedy', async () => {
    existing = { id: REMEDY, status: 'proposed', kind: 'makeup', caseId: null };
    expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
    expect([inserted, reoffered]).toEqual([[], []]);
  });
});

describe('remedy offer: the row (I3, A1, Q8)', () => {
  it('writes offered_at at the clock, the choice window from it, A and L as read, one remedy_offered row', async () => {
    const offered = await offerOf().offerLocked(tx, SESSION);
    expect(inserted).toEqual([
      {
        sessionId: SESSION,
        row: {
          status: 'awaiting_choice',
          proposedDate: new Date('2026-12-17T00:00:00Z'),
          offeredAt: now,
          choiceClosesAt: new Date('2026-12-06T08:00:00Z'),
          snapshotAnswerWindowHours: 72,
          snapshotFirstSessionLeadHours: 24,
        },
      },
    ]);
    expect(events).toEqual([
      { enrollmentId: ENROLLMENT, sessionId: SESSION, kind: 'remedy_offered', occurredAt: now },
    ]);
    expect(offered).toEqual({
      remedyId: REMEDY,
      sessionId: SESSION,
      enrollmentId: ENROLLMENT,
      status: 'awaiting_choice',
      proposedDate: '2026-12-17',
      reoffered: false,
    });
  });

  it('is proposed after a Both-No-Show, and on the ijazah track after a Teacher-No-Show', async () => {
    session = { ...session, status: 'both_no_show' };
    expect((await offerOf().offerLocked(tx, SESSION))?.status).toBe('proposed');
    session = { ...session, status: 'teacher_no_show' };
    terms = terms === null ? null : { ...terms, track: 'ijazah_track' };
    expect((await offerOf().offerLocked(tx, SESSION))?.status).toBe('proposed');
  });

  it('offers a frozen remedy again as a new offer: a new offered_at, a full choice window, a new proposal', async () => {
    existing = { id: REMEDY, status: 'frozen', kind: 'makeup', caseId: null };
    now = new Date('2027-01-05T10:00:00Z');
    const offered = await offerOf().offerLocked(tx, SESSION);
    expect(offered).toMatchObject({ reoffered: true, proposedDate: '2027-01-21' });
    expect(reoffered).toEqual([
      expect.objectContaining({
        remedyId: REMEDY,
        row: expect.objectContaining({
          offeredAt: now,
          choiceClosesAt: new Date('2027-01-12T10:00:00Z'),
        }),
      }),
    ]);
    expect(inserted).toEqual([]);
  });
});

describe('remedy offer: the proposal (H1, F5, R-TIME-2)', () => {
  it('moves past C + A + L when the unconsumed session was among the last: Dec 3 and Dec 10 start before it', async () => {
    // C = 12-06 08:00Z; C + A + L = 12-10 08:00Z; Thursday 12-10 09:00 Cairo is 07:00Z.
    expect((await offerOf().offerLocked(tx, SESSION))?.proposedDate).toBe('2026-12-17');
  });

  it('is the first week after the last session when the bound is earlier, a make-up or a proposal included', async () => {
    now = new Date('2026-11-08T08:00:00Z');
    session = { ...session, scheduledEndAt: new Date('2026-11-05T08:00:00Z') };
    expect((await offerOf().offerLocked(tx, SESSION))?.proposedDate).toBe('2026-12-03');
    lastReached = new Date('2026-12-03T00:00:00Z');
    expect((await offerOf().offerLocked(tx, SESSION))?.proposedDate).toBe('2026-12-10');
  });

  it('skips a week the slot is taken, one over a session, one over a reservation or a hold of either party', async () => {
    // Four weeks, the snapshot's count: only the week the slot is taken counts toward the bound
    // (PR #132's review, round 1, Minor 2; the owner's amendment of 2026-11-11 under T028).
    takenDates = new Set(['2026-12-17']);
    ownSessions = [
      { startsAt: new Date('2026-12-24T07:30:00Z'), endsAt: new Date('2026-12-24T08:30:00Z') },
    ];
    reserved = [
      {
        remedyId: 'another',
        sessionId: 'another',
        startsAt: new Date('2026-12-31T07:00:00Z'),
        endsAt: new Date('2026-12-31T08:00:00Z'),
      },
    ];
    held = [
      { startsAt: new Date('2027-01-07T06:30:00Z'), endsAt: new Date('2027-01-07T07:30:00Z') },
    ];
    expect((await offerOf().offerLocked(tx, SESSION))?.proposedDate).toBe('2027-01-14');
  });

  // The decision under T028 (the owner's, 2026-11-10): a guard against bugs only, the slot being kept
  // until the package is completed. Four weeks from H1 (the snapshot's count), then nothing now.
  it('stops after the snapshot’s count of weeks from H1 and offers nothing now, with one warn line', async () => {
    everyWeekTaken = true;
    expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
    expect([inserted, reoffered, events]).toEqual([[], [], []]);
    expect(warnings).toEqual([
      {
        fields: { sessionId: SESSION, enrollmentId: ENROLLMENT, reason: 'no_free_week' },
        message: expect.any(String),
      },
    ]);
    everyWeekTaken = false;
    takenDates = new Set(['2026-12-17', '2026-12-24', '2026-12-31']);
    expect((await offerOf().offerLocked(tx, SESSION))?.proposedDate).toBe('2027-01-07');
  }, 3_000);

  // PR #132's review, round 1, Minor 2 (the owner's amendment of 2026-11-11 under T028): the student
  // on another teacher's package at the same weekly time. Weeks its sessions block are stepped over
  // without counting toward the bound: they are finite, a slot taken on every date is not.
  it('steps over the weeks other sessions block without counting them, past the snapshot’s count, and writes no warn line', async () => {
    ownSessions = [
      { startsAt: new Date('2026-12-17T07:00:00Z'), endsAt: new Date('2026-12-17T08:00:00Z') },
      { startsAt: new Date('2026-12-24T07:00:00Z'), endsAt: new Date('2026-12-24T08:00:00Z') },
      { startsAt: new Date('2026-12-31T07:00:00Z'), endsAt: new Date('2026-12-31T08:00:00Z') },
      { startsAt: new Date('2027-01-07T07:00:00Z'), endsAt: new Date('2027-01-07T08:00:00Z') },
      { startsAt: new Date('2027-01-14T07:00:00Z'), endsAt: new Date('2027-01-14T08:00:00Z') },
    ];
    expect((await offerOf().offerLocked(tx, SESSION))?.proposedDate).toBe('2027-01-21');
    expect(warnings).toEqual([]);
  });

  it('takes a week a hold only touches, end to start', async () => {
    held = [
      { startsAt: new Date('2026-12-17T08:00:00Z'), endsAt: new Date('2026-12-17T09:00:00Z') },
    ];
    expect((await offerOf().offerLocked(tx, SESSION))?.proposedDate).toBe('2026-12-17');
  });

  it("resolves each week on its own date across Cairo's April change: 09:00 is 07:00Z before it and 06:00Z after", async () => {
    // Summer time from Friday 2027-04-30. Bound: 04-22 + 7 days + 96 hours = 05-03 → Thursday 05-06.
    now = new Date('2027-04-22T06:00:00Z');
    session = { ...session, scheduledEndAt: new Date('2027-04-15T08:00:00Z') };
    lastReached = new Date('2027-04-15T00:00:00Z');
    held = [
      { startsAt: new Date('2027-05-06T06:00:00Z'), endsAt: new Date('2027-05-06T07:00:00Z') },
    ];
    // The week over the hold at 06:00Z is skipped: the occurrence was resolved at summer time.
    expect((await offerOf().offerLocked(tx, SESSION))?.proposedDate).toBe('2027-05-13');
  });
});

describe('remedy offer: the locks (kernel.md, the offer row)', () => {
  it('offer takes users (both, one call), the teacher’s slots’ key, the enrollment, the session, then its remedies, and decides after', async () => {
    await offerOf().offer(tx, SESSION);
    expect(trace).toEqual([
      `lock users ${[STUDENT, TEACHER].sort().join(',')}`,
      `lock key teacher-slots ${TEACHER}`,
      `lock enrollments ${ENROLLMENT}`,
      `lock sessions ${SESSION}`,
      `lock remedies of ${SESSION}`,
      'insert remedy',
      'record remedy_offered',
    ]);
  });

  it('takes no lock for a session of an enrollment no longer confirmed', async () => {
    terms = terms === null ? null : { ...terms, status: 'cancelled' };
    expect(await offerOf().offer(tx, SESSION)).toBeNull();
    expect(trace).toEqual([]);
  });
});

describe('remedy offer: a settings change after the offer moves no bound of it (I1, D1)', () => {
  it('keeps the offer’s A and L and choice window on the row, and the counter’s answer window reads the row', async () => {
    await offerOf().offerLocked(tx, SESSION);
    const [first] = inserted;
    SETTINGS['makeup_counter_answer_hours'] = 48;
    SETTINGS['first_session_lead_hours'] = 12;
    SETTINGS['makeup_choice_window_days'] = 3;
    try {
      expect(first?.row).toMatchObject({
        choiceClosesAt: new Date('2026-12-06T08:00:00Z'),
        snapshotAnswerWindowHours: 72,
        snapshotFirstSessionLeadHours: 24,
      });
      const view = remedyViewOf(
        {
          id: REMEDY,
          status: 'counter_proposed',
          kind: 'makeup',
          offeredAt: now,
          choiceClosesAt: first?.row.choiceClosesAt ?? now,
          proposedDate: first?.row.proposedDate ?? null,
          counterDate: new Date('2026-12-20T00:00:00Z'),
          counterStartTimeLocal: new Date('1970-01-01T18:00:00Z'),
          counterTimezone: CAIRO,
          counterProposedAt: new Date('2026-11-30T10:00:00Z'),
          snapshotAnswerWindowHours: first?.row.snapshotAnswerWindowHours ?? 0,
          makeupSessionId: null,
        },
        { startTimeLocal: '09:00:00', timezone: CAIRO },
      );
      expect(view?.counter?.answerClosesAt).toBe('2026-12-03T10:00:00.000Z');
    } finally {
      SETTINGS['makeup_counter_answer_hours'] = 72;
      SETTINGS['first_session_lead_hours'] = 24;
      SETTINGS['makeup_choice_window_days'] = 7;
    }
  });
});

// T061 of specs/004-sessions (FR-455; research R-322, «The restore»; R-320's two rows of 2026-11-05;
// B40's conflict check, F8): a remedy the closing's case held (`refund_case`, kind `makeup`) offered
// again by a restore as a frozen remedy is at reinstatement: a new offer with a full choice window, A
// and L read again, a new proposal after the latest of the enrollment's sessions (the recreated ones),
// `case_id` and `decided_at` cleared by the re-offer, one `remedy_offered` row with no case. Any other
// remedy, or one of another case, is offered nothing.
describe('remedy offer: a remedy a restore offers again (T061)', () => {
  const CLOSING = '0199d0a0-0000-7000-8000-0000000000c9';

  it('offers the closing case’s refund_case make-up again: a new offer, a full window, a proposal after the recreated sessions, the case cleared', async () => {
    existing = { id: REMEDY, status: 'refund_case', kind: 'makeup', caseId: CLOSING };
    now = new Date('2027-01-05T10:00:00Z');
    // The last recreated session: Thursday 2027-02-04.
    lastReached = new Date('2027-02-04T00:00:00Z');
    const offered = await offerOf().offerLocked(tx, SESSION, { restoredCase: CLOSING });
    expect(offered).toEqual({
      remedyId: REMEDY,
      sessionId: SESSION,
      enrollmentId: ENROLLMENT,
      status: 'awaiting_choice',
      proposedDate: '2027-02-11',
      reoffered: true,
    });
    expect(reoffered).toEqual([
      {
        remedyId: REMEDY,
        fromCase: CLOSING,
        row: {
          status: 'awaiting_choice',
          proposedDate: new Date('2027-02-11T00:00:00Z'),
          offeredAt: now,
          choiceClosesAt: new Date('2027-01-12T10:00:00Z'),
          snapshotAnswerWindowHours: 72,
          snapshotFirstSessionLeadHours: 24,
        },
      },
    ]);
    expect(inserted).toEqual([]);
    expect(events).toEqual([
      { enrollmentId: ENROLLMENT, sessionId: SESSION, kind: 'remedy_offered', occurredAt: now },
    ]);
  });

  it('is proposed after a Both-No-Show, and awaiting a choice for a cleared suspension’s session on recitation', async () => {
    existing = { id: REMEDY, status: 'refund_case', kind: 'makeup', caseId: CLOSING };
    session = { ...session, status: 'both_no_show' };
    expect(await offerOf().offerLocked(tx, SESSION, { restoredCase: CLOSING })).toMatchObject({
      status: 'proposed',
    });
    session = { ...session, status: 'cancelled_by_admin' };
    expect(await offerOf().offerLocked(tx, SESSION, { restoredCase: CLOSING })).toMatchObject({
      status: 'awaiting_choice',
    });
  });

  it.each([
    ['of another case', { id: REMEDY, status: 'refund_case', kind: 'makeup', caseId: REMEDY }],
    ['of kind refund', { id: REMEDY, status: 'refund_case', kind: 'refund', caseId: CLOSING }],
    ['booked', { id: REMEDY, status: 'booked', kind: 'makeup', caseId: null }],
    ['none', null],
  ] as const)('offers nothing for a remedy %s, writing nothing', async (_name, remedy) => {
    existing = remedy === null ? null : { ...remedy };
    expect(await offerOf().offerLocked(tx, SESSION, { restoredCase: CLOSING })).toBeNull();
    expect([inserted, reoffered, events]).toEqual([[], [], []]);
  });

  it('offers a refund_case remedy nothing without a restore', async () => {
    existing = { id: REMEDY, status: 'refund_case', kind: 'makeup', caseId: CLOSING };
    expect(await offerOf().offerLocked(tx, SESSION)).toBeNull();
    expect([inserted, reoffered]).toEqual([[], []]);
  });
});
