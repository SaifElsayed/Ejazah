// T015 of specs/004-sessions/tasks.md (FR-448, FR-449, FR-486; research R-309, R-322) —
// `createCompletion().completeIfDue` over a recorded store and enrollment side: an enrollment is
// completed only when every session is settled and not frozen, no remedy is owed, the last
// session's dispute window has closed and no `student_suspended` or `admin_cancellation` case is
// open (the latter B38's decision under T023, Q3 (a)), and then once,
// through `EnrollmentSide.complete`, answering true; it writes no log line itself, its caller
// writing «Enrollment completed» (PR #129's review, Minor 3: the sweep after its commit, the outage
// record on its transaction). No count is read, and five or more
// Teacher-No-Shows end nothing. Over the real tables: `tests/db-integrity/completion.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CompletionSession } from './completion.repository.js';
import { type CompletionStore, createCompletion } from './completion.service.js';
import type { EnrollmentStatus, EnrollmentTerms, ProgrammeTerms } from './enrollment-side.port.js';

const tx = {} as Transaction;
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000001';
const LAST_END = new Date('2026-11-01T08:00:00Z');
const WINDOW_HOURS = 72;
/** The window's close: 72 hours after the last scheduled end. */
const CLOSES = new Date('2026-11-04T08:00:00Z');

const terms = (status: EnrollmentStatus): EnrollmentTerms => ({
  id: ENROLLMENT,
  status,
  slotId: '0199d0a0-0000-7000-8000-000000000002',
  track: 'recitation',
  timezone: 'Africa/Cairo',
  durationMinutes: 60,
  sessionCount: 4,
  studentUserId: '0199d0a0-0000-7000-8000-0000000000b1',
  teacherUserId: '0199d0a0-0000-7000-8000-0000000000c1',
});

const settled = (
  status: CompletionSession['status'],
  values: Partial<CompletionSession> = {},
): CompletionSession => ({
  status,
  scheduledEndAt: new Date('2026-10-25T08:00:00Z'),
  ...values,
});

/** Four sessions, the last ending at LAST_END, nothing owed. */
const DELIVERED: readonly CompletionSession[] = [
  settled('done'),
  settled('student_no_show'),
  settled('teacher_no_show', { remedyStatus: 'booked' }),
  settled('done', { scheduledEndAt: LAST_END }),
];

function world({
  status = 'confirmed',
  sessions = DELIVERED,
  suspendedCase = false,
  adminCancellationCase = false,
  teacherSuspendedCase = false,
  at = CLOSES,
  moves = true,
  programme,
  generationCase = null,
}: {
  status?: EnrollmentStatus | null;
  sessions?: readonly CompletionSession[];
  suspendedCase?: boolean;
  adminCancellationCase?: boolean;
  /** T071: a `teacher_suspended` case open on the enrollment. */
  teacherSuspendedCase?: boolean;
  at?: Date;
  moves?: boolean;
  /** 006:T010: the enrollment's `programmes` row; none for a package. */
  programme?: ProgrammeTerms;
  /** 006:T015 (Q-6 (a)): the open case a refused generation opened, or none. */
  generationCase?: 'slot_unavailable' | 'party_restricted' | null;
} = {}) {
  const completed: string[] = [];
  const keys: string[] = [];
  const settings: SettingsReader = {
    read: async (key, schema) => {
      keys.push(key);
      return schema.parse(WINDOW_HOURS);
    },
  };
  const store: CompletionStore = {
    sessionsOf: async (_tx, id) => {
      expect(id).toBe(ENROLLMENT);
      return sessions;
    },
    studentSuspendedCaseOpen: async () => suspendedCase,
    adminCancellationCaseOpen: async (_tx, id) => {
      expect(id).toBe(ENROLLMENT);
      return adminCancellationCase;
    },
    teacherSuspendedCaseOpen: async (_tx, id) => {
      expect(id).toBe(ENROLLMENT);
      return teacherSuspendedCase;
    },
    generationCaseOpen: async (_tx, id) => {
      expect(id).toBe(ENROLLMENT);
      return generationCase !== null;
    },
  };
  const completion = createCompletion({
    enrollments: {
      enrollmentFor: async () =>
        status === null
          ? null
          : { ...terms(status), ...(programme === undefined ? {} : { programme }) },
      complete: async (_tx, id) => {
        completed.push(id);
        return moves;
      },
    },
    settings,
    clock: async (given) => {
      // The reader is asked on the call's transaction (the database's clock in production, Q3).
      expect(given).toBe(tx);
      return at;
    },
    store,
  });
  return { completion, completed, keys };
}

describe('completeIfDue (T015, FR-449)', () => {
  it('completes a confirmed enrollment once the last window has closed, through EnrollmentSide.complete, answering true and taking no logger', async () => {
    const { completion, completed, keys } = world();
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
    expect(completed).toEqual([ENROLLMENT]);
    expect(keys).toEqual(['dispute_window_hours']);
  });

  it('does not complete before the last session’s dispute window has closed', async () => {
    const { completion, completed } = world({ at: new Date('2026-11-04T07:59:59Z') });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  it('counts the window from the last session that can be disputed, not a later cancelled one', async () => {
    const { completion } = world({
      sessions: [
        ...DELIVERED,
        settled('cancelled_by_admin', { scheduledEndAt: new Date('2026-11-08T08:00:00Z') }),
      ],
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
  });

  it.each([
    ['a scheduled session', settled('scheduled', { scheduledEndAt: LAST_END })],
    ['a disputed session (its outcome frozen)', settled('disputed')],
    ['an Under-Threshold session in the review queue', settled('under_threshold')],
    ['a Provider-Outage session in the review queue', settled('provider_outage')],
    ['a Teacher-No-Show not yet offered its remedy', settled('teacher_no_show')],
    ['a Both-No-Show not yet offered its remedy', settled('both_no_show')],
    ['a Cancelled-By-Agreement session with no remedy', settled('cancelled_by_agreement')],
    [
      'a remedy awaiting the choice',
      settled('teacher_no_show', { remedyStatus: 'awaiting_choice' }),
    ],
    ['a remedy proposed', settled('both_no_show', { remedyStatus: 'proposed' })],
    [
      'a counter-proposal pending',
      settled('teacher_no_show', { remedyStatus: 'counter_proposed' }),
    ],
    ['a frozen remedy', settled('cancelled_by_admin', { remedyStatus: 'frozen' })],
  ])('holds it while there is %s (postponed)', async (_name, session) => {
    const { completion, completed } = world({ sessions: [...DELIVERED, session] });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  // 003:T112 (SRS FR-POSTPONE-2, DEC-90; the owner's Q-B (a)): a postponed session is settled as an
  // agreed cancellation is: owed its make-up, never disputed.
  it('completes with a postponed session whose make-up is booked (003:T112)', async () => {
    const { completion } = world({
      sessions: [...DELIVERED, settled('postponed', { remedyStatus: 'booked' })],
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
  });

  it('holds it while a postponed session has no remedy yet (003:T112)', async () => {
    const { completion, completed } = world({ sessions: [...DELIVERED, settled('postponed')] });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  it('counts the window from the last session that can be disputed, not a later postponed one (003:T112)', async () => {
    const { completion } = world({
      sessions: [
        ...DELIVERED,
        settled('postponed', {
          remedyStatus: 'booked',
          scheduledEndAt: new Date('2026-11-08T08:00:00Z'),
        }),
      ],
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
  });

  it('completes with a refund handed to its case, or a remedy lapsed: no longer owed by the enrollment', async () => {
    const { completion } = world({
      sessions: [
        ...DELIVERED,
        settled('teacher_no_show', { remedyStatus: 'refund_case' }),
        settled('cancelled_by_agreement', { remedyStatus: 'lapsed' }),
      ],
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
  });

  it('holds it while a student_suspended case is open on it (FR-486)', async () => {
    const { completion, completed } = world({ suspendedCase: true });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  it('holds it while an admin_cancellation case is open on it (the decision under T023, Q3 (a)): a hold can be undone, a completion cannot', async () => {
    const { completion, completed } = world({ adminCancellationCase: true });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  // T071 (FR-504): a paused enrollment is not completed while its teacher is suspended.
  it('holds it while a teacher_suspended case is open on it (T071)', async () => {
    const { completion, completed } = world({ teacherSuspendedCase: true });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  it.each(['pending_payment', 'completed', 'terminated_no_show', 'cancelled', null] as const)(
    'leaves an enrollment %s as it is',
    async (status) => {
      const { completion, completed } = world({ status });
      expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
      expect(completed).toEqual([]);
    },
  );

  it('leaves an enrollment with no session as it is', async () => {
    const { completion, completed } = world({ sessions: [] });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  it('answers false when the move changes nothing', async () => {
    const { completion } = world({ moves: false });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
  });

  it('five or more Teacher-No-Shows, each owed its remedy, end nothing and hold completion while owed (FR-448, SC-404)', async () => {
    const absences = Array.from({ length: 6 }, () =>
      settled('teacher_no_show', { remedyStatus: 'awaiting_choice' }),
    );
    const { completion, completed } = world({ sessions: [...DELIVERED, ...absences] });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });
});

// 006:T010 of specs/006-programme (FR-712; research R-501, V-1; B-P2's conflict check, Q-8 (a)): a
// programme completes only when fully paid (`months_paid` = `month_count`, or `in_full`) and not
// `awaiting_offer`, `offered` or `paused`, read through `enrollmentFor`'s terms; the existing checks
// follow. A month's sessions are generated once it is paid, so every row that exists may be settled
// with a month still unpaid.
describe('completeIfDue on a programme (006:T010, FR-712, R-501 V-1)', () => {
  const programme = (values: Partial<ProgrammeTerms> = {}): ProgrammeTerms => ({
    state: 'active',
    monthCount: 2,
    monthsPaid: 2,
    paymentPlan: 'monthly',
    ...values,
  });

  it('red first: a paid month settled, the next unpaid, 72 h passed: not completed', async () => {
    const { completion, completed } = world({ programme: programme({ monthsPaid: 1 }) });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  it('completes once every month is paid and the rest holds', async () => {
    const { completion, completed } = world({ programme: programme() });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
    expect(completed).toEqual([ENROLLMENT]);
  });

  it('completes a programme paid in full', async () => {
    const { completion, completed } = world({
      programme: programme({ paymentPlan: 'in_full', monthCount: 10, monthsPaid: 10 }),
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
    expect(completed).toEqual([ENROLLMENT]);
  });

  it('takes in_full as fully paid on its own (the gate’s «or in_full»)', async () => {
    const { completion, completed } = world({
      programme: programme({ paymentPlan: 'in_full', monthCount: 10, monthsPaid: 0 }),
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
    expect(completed).toEqual([ENROLLMENT]);
  });

  it('W6: the assessment alone, awaiting its offer, is not completed 72 h after session 1', async () => {
    const { completion, completed } = world({
      sessions: [settled('done', { scheduledEndAt: LAST_END })],
      programme: { state: 'awaiting_offer', monthCount: null, monthsPaid: 0, paymentPlan: null },
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  it('an offered programme, nothing paid yet, is not completed', async () => {
    const { completion, completed } = world({
      programme: programme({ state: 'offered', monthsPaid: 0, paymentPlan: null }),
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  it.each<ProgrammeTerms['state']>(['awaiting_offer', 'offered', 'paused'])(
    'a %s programme is not completed, even with every month paid',
    async (state) => {
      const { completion, completed } = world({ programme: programme({ state }) });
      expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
      expect(completed).toEqual([]);
    },
  );

  it('the existing checks follow the gate: a fully paid programme waits for the last window', async () => {
    const { completion, completed } = world({
      programme: programme(),
      // One millisecond before CLOSES.
      at: new Date('2026-11-04T07:59:59.999Z'),
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
  });

  // 006:T015 (PR #158 r1 Follow-up 2; B-P3's conflict check, Q-6 (a)): a programme paid in full
  // whose rest was never generated (the confirm step refused the generation and opened its case) has
  // only session 1; it waits while that case is open, and completes once the case is resolved.
  it.each(['slot_unavailable', 'party_restricted'] as const)(
    'red first: a programme paid in full with an open %s case is not completed (Q-6 (a))',
    async (generationCase) => {
      const { completion, completed } = world({
        sessions: [settled('done', { scheduledEndAt: LAST_END })],
        programme: programme({ paymentPlan: 'in_full', monthCount: 10, monthsPaid: 10 }),
        generationCase,
      });
      expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
      expect(completed).toEqual([]);
    },
  );

  it('completes the same programme once its case is resolved (Q-6 (a))', async () => {
    const { completion, completed } = world({
      sessions: [settled('done', { scheduledEndAt: LAST_END })],
      programme: programme({ paymentPlan: 'in_full', monthCount: 10, monthsPaid: 10 }),
    });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
    expect(completed).toEqual([ENROLLMENT]);
  });

  it('leaves a package alone: the wait is a programme’s only (Q-6 (a))', async () => {
    const { completion, completed } = world({ generationCase: 'slot_unavailable' });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
    expect(completed).toEqual([ENROLLMENT]);
  });
});
