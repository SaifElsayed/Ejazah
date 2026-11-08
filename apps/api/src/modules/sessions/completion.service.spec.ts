// T015 of specs/004-sessions/tasks.md (FR-448, FR-449, FR-486; research R-309, R-322) —
// `createCompletion().completeIfDue` over a recorded store and enrollment side: an enrollment is
// completed only when every session is settled and not frozen, no remedy is owed, the last
// session's dispute window has closed and no `student_suspended` case is open, and then once,
// through `EnrollmentSide.complete`, with its one log line. No count is read, and five or more
// Teacher-No-Shows end nothing. Over the real tables: `tests/db-integrity/completion.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { CompletionSession } from './completion.repository.js';
import { type CompletionStore, createCompletion } from './completion.service.js';
import type { EnrollmentStatus, EnrollmentTerms } from './enrollment-side.port.js';

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
  at = CLOSES,
  moves = true,
}: {
  status?: EnrollmentStatus | null;
  sessions?: readonly CompletionSession[];
  suspendedCase?: boolean;
  at?: Date;
  moves?: boolean;
} = {}) {
  const completed: string[] = [];
  const logged: unknown[][] = [];
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
  };
  const completion = createCompletion({
    enrollments: {
      enrollmentFor: async () => (status === null ? null : terms(status)),
      complete: async (_tx, id) => {
        completed.push(id);
        return moves;
      },
    },
    settings,
    log: {
      info: (...args: unknown[]) => {
        logged.push(args);
      },
    } as unknown as Parameters<typeof createCompletion>[0]['log'],
    clock: async (given) => {
      // The reader is asked on the call's transaction (the database's clock in production, Q3).
      expect(given).toBe(tx);
      return at;
    },
    store,
  });
  return { completion, completed, logged, keys };
}

describe('completeIfDue (T015, FR-449)', () => {
  it('completes a confirmed enrollment once the last window has closed, through EnrollmentSide.complete, with one log line', async () => {
    const { completion, completed, logged, keys } = world();
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(true);
    expect(completed).toEqual([ENROLLMENT]);
    // One info line, its fields exactly the enrollment's id (the owner's decision of 2026-11-08, Q2).
    expect(logged).toHaveLength(1);
    expect(logged[0]?.[0]).toStrictEqual({ enrollmentId: ENROLLMENT });
    expect(Object.keys(logged[0]?.[0] as object)).toEqual(['enrollmentId']);
    expect(logged[0]?.[1]).toBe('Enrollment completed');
    expect(keys).toEqual(['dispute_window_hours']);
  });

  it('does not complete before the last session’s dispute window has closed', async () => {
    const { completion, completed, logged } = world({ at: new Date('2026-11-04T07:59:59Z') });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
    expect(logged).toEqual([]);
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
    ['a remedy awaiting the choice', settled('teacher_no_show', { remedyStatus: 'awaiting_choice' })],
    ['a remedy proposed', settled('both_no_show', { remedyStatus: 'proposed' })],
    ['a counter-proposal pending', settled('teacher_no_show', { remedyStatus: 'counter_proposed' })],
    ['a frozen remedy', settled('cancelled_by_admin', { remedyStatus: 'frozen' })],
  ])('holds it while there is %s, writing no log line (postponed)', async (_name, session) => {
    const { completion, completed, logged } = world({ sessions: [...DELIVERED, session] });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(completed).toEqual([]);
    expect(logged).toEqual([]);
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

  it('writes no log line when the move changes nothing', async () => {
    const { completion, logged } = world({ moves: false });
    expect(await completion.completeIfDue(tx, ENROLLMENT)).toBe(false);
    expect(logged).toEqual([]);
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
