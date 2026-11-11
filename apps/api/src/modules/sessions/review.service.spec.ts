// T033 of specs/004-sessions/tasks.md (FR-446, FR-450, FR-477; R-SESS-6; contracts/admin-surface.md,
// `sessions.review.*`; contracts/kernel.md, «evaluation, a review or dispute resolution») —
// `createSessionReview` over a recorded store. The queue: pages of `admin_list_page_size`, oldest
// first, each session's parties named (a deleted one unnamed), a cursor while more follow. The
// telemetry: a `scheduled` session refused `CONFLICT` `not_settled`, none `NOT_FOUND`, any other
// read. The resolution: the session read with no lock, the enrollment then the session locked and
// the session read again; one of the two review statuses written through the one writer of an
// administrator's outcome (`review_resolved`, the database's clock), then T015's check and its line
// on the transaction; any other status refused `CONFLICT` `not_under_review` (Q2), none `NOT_FOUND`,
// each with one log line of ids and the cause and nothing written. Over the real tables:
// `tests/db-integrity/session-review.spec.ts`.
import type { SessionStatus } from '@ijazah/contracts';
import type { Telemetry } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { AdminOutcomeWrite } from './admin-outcome.service.js';
import type { QueuedSession, TelemetrySession } from './review.repository.js';
import { createSessionReview, type SessionReviewStore } from './review.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000b1';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000b2';
const AT = new Date('2026-11-10T09:00:00Z');
const RESOLVE = { sessionId: SESSION, outcome: 'done' as const, reason: 'انقطع الاتصال' };

const settings = (pageSize: number): SettingsReader => ({
  read: async (key) => {
    expect(key).toBe('admin_list_page_size');
    return pageSize as never;
  },
});

const queued = (n: number): QueuedSession => ({
  id: `0199d0a0-0000-7000-8000-00000000005${String(n)}`,
  enrollmentId: ENROLLMENT,
  status: n % 2 === 0 ? 'under_threshold' : 'provider_outage',
  startsAt: new Date('2026-11-01T06:00:00Z'),
  endsAt: new Date('2026-11-01T07:00:00Z'),
  simultaneousSeconds: 120 * n,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
});

const telemetrySession = (status: SessionStatus): TelemetrySession => ({
  id: SESSION,
  enrollmentId: ENROLLMENT,
  localDate: '2026-11-01' as TelemetrySession['localDate'],
  startTimeLocal: '08:00:00' as TelemetrySession['startTimeLocal'],
  timezone: 'Africa/Cairo',
  startsAt: new Date('2026-11-01T06:00:00Z'),
  endsAt: new Date('2026-11-01T07:00:00Z'),
  status,
  outcomeUnderDispute: null,
  simultaneousSeconds: 0,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
});

const TELEMETRY = { sessionId: SESSION } as Telemetry;

interface World {
  readonly first?: SessionStatus | null;
  readonly again?: SessionStatus | null;
  readonly queue?: readonly QueuedSession[];
  readonly pageSize?: number;
  readonly completes?: boolean;
}

function world({
  first = 'under_threshold',
  again = first,
  queue = [],
  pageSize = 2,
  completes = false,
}: World = {}) {
  const journal: string[] = [];
  const logged: { fields: Record<string, unknown>; message: string }[] = [];
  const written: AdminOutcomeWrite[] = [];
  let reads = 0;
  const row = (status: SessionStatus | null) =>
    status === null
      ? null
      : {
          id: SESSION,
          enrollmentId: ENROLLMENT,
          status,
          outcomeUnderDispute: null,
          studentUserId: STUDENT,
          teacherUserId: TEACHER,
        };
  const store: SessionReviewStore = {
    queuedSessions: async (_tx, after, limit) => {
      journal.push(`queue after ${after ?? '-'} limit ${String(limit)}`);
      return queue.slice(0, limit);
    },
    namesOf: async (_tx, ids) => {
      journal.push(`names ${ids.join(',')}`);
      return new Map([[STUDENT, 'آمال']]);
    },
    telemetrySession: async () => (first === null ? null : telemetrySession(first)),
    sessionToResolve: async (_tx, sessionId) => {
      expect(sessionId).toBe(SESSION);
      reads += 1;
      journal.push(reads === 1 ? 'read' : 'read again');
      return row(reads === 1 ? first : again);
    },
    lockSessions: async (_tx, ids) => {
      journal.push(`lock sessions ${ids.join(',')}`);
    },
    writeOutcome: async (_tx, write) => {
      journal.push(`write ${write.from}->${write.outcome} ${write.event.kind}`);
      written.push(write);
    },
  };
  const service = createSessionReview({
    enrollments: {
      lockEnrollments: async (_tx, ids) => {
        journal.push(`lock enrollments ${ids.join(',')}`);
      },
    },
    completion: {
      completeIfDue: async (_tx, enrollmentId) => {
        journal.push(`completion ${enrollmentId}`);
        return completes;
      },
    },
    telemetry: {
      of: async (_tx, session) => {
        journal.push(`telemetry ${session.id}`);
        return TELEMETRY;
      },
    },
    settings: settings(pageSize),
    log: {
      info: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
    } as unknown as Parameters<typeof createSessionReview>[0]['log'],
    clock: async () => AT,
    store,
  });
  return { service, journal, logged, written };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  expect(isRefusalLogged(thrown), `${thrown.code} marked «logged»`).toBe(true);
  return thrown;
}

describe('sessions.review.list (FR-477)', () => {
  it('answers a page of the setting, parties named, a deleted one unnamed, and a cursor while more follow', async () => {
    const { service, journal } = world({ queue: [queued(1), queued(2), queued(3)], pageSize: 2 });
    const page = await service.list(tx, ADMIN, {});
    expect(journal).toEqual(['queue after - limit 3', `names ${STUDENT},${TEACHER}`]);
    expect(page.items.map(({ sessionId }) => sessionId)).toEqual([queued(1).id, queued(2).id]);
    expect(page.nextCursor).toBe(queued(2).id);
    expect(page.items[0]).toEqual({
      sessionId: queued(1).id,
      enrollmentId: ENROLLMENT,
      status: 'provider_outage',
      startsAt: '2026-11-01T06:00:00.000Z',
      endsAt: '2026-11-01T07:00:00.000Z',
      simultaneousSeconds: 120,
      parties: {
        student: { userId: STUDENT, displayName: 'آمال', deleted: false },
        teacher: { userId: TEACHER, displayName: null, deleted: true },
      },
    });
  });

  it('answers no cursor on the last page and reads after the cursor given', async () => {
    const { service, journal } = world({ queue: [queued(3)], pageSize: 2 });
    const page = await service.list(tx, ADMIN, { cursor: queued(2).id });
    expect(journal[0]).toBe(`queue after ${queued(2).id} limit 3`);
    expect(page.nextCursor).toBeUndefined();
    expect(page.items).toHaveLength(1);
  });
});

describe('sessions.review.get (GAP-2)', () => {
  it.each<SessionStatus>([
    'under_threshold',
    'provider_outage',
    'done',
    'teacher_no_show',
    'disputed',
    'cancelled_by_admin',
    'cancelled_by_agreement',
  ])('reads the telemetry of a %s session', async (status) => {
    const { service, journal, logged } = world({ first: status });
    expect(await service.get(tx, ADMIN, { sessionId: SESSION })).toBe(TELEMETRY);
    expect(journal).toEqual([`telemetry ${SESSION}`]);
    expect(logged).toEqual([]);
  });

  it('refuses a scheduled session CONFLICT not_settled, with one line', async () => {
    const { service, journal, logged } = world({ first: 'scheduled' });
    const refused = await refusalOf(service.get(tx, ADMIN, { sessionId: SESSION }));
    expect(refused.code).toBe('CONFLICT');
    expect(refused.details).toEqual([{ path: 'cause', code: 'not_settled' }]);
    expect(journal).toEqual([]);
    expect(logged).toEqual([
      {
        fields: {
          adminId: ADMIN,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          errorCode: 'CONFLICT',
          cause: 'not_settled',
        },
        message: 'A session review call was refused',
      },
    ]);
  });

  it('refuses a session that does not exist NOT_FOUND, with one line', async () => {
    const { service, logged } = world({ first: null });
    expect((await refusalOf(service.get(tx, ADMIN, { sessionId: SESSION }))).code).toBe(
      'NOT_FOUND',
    );
    expect(logged).toEqual([
      {
        fields: { adminId: ADMIN, sessionId: SESSION, errorCode: 'NOT_FOUND', cause: 'not_found' },
        message: 'A session review call was refused',
      },
    ]);
  });
});

describe('sessions.review.resolve (R-SESS-6, FR-450)', () => {
  it.each<SessionStatus>(['under_threshold', 'provider_outage'])(
    'locks the enrollment then the session, reads again, writes the outcome of a %s session, then checks completion',
    async (status) => {
      const { service, journal, written, logged } = world({ first: status });
      expect(await service.resolve(tx, ADMIN, RESOLVE)).toEqual({
        sessionId: SESSION,
        status: 'done',
      });
      expect(journal).toEqual([
        'read',
        `lock enrollments ${ENROLLMENT}`,
        `lock sessions ${SESSION}`,
        'read again',
        `write ${status}->done review_resolved`,
        `completion ${ENROLLMENT}`,
      ]);
      expect(written).toEqual([
        {
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          from: status,
          outcome: 'done',
          adminId: ADMIN,
          at: AT,
          event: { kind: 'review_resolved' },
        },
      ]);
      // The resolution's line names ids and the outcome, never the reason.
      expect(logged).toEqual([
        {
          fields: { adminId: ADMIN, sessionId: SESSION, enrollmentId: ENROLLMENT, outcome: 'done' },
          message: 'A session under review was resolved',
        },
      ]);
    },
  );

  it('writes the completion line on the transaction when the check completes the enrollment', async () => {
    const { service, logged } = world({ completes: true });
    await service.resolve(tx, ADMIN, { ...RESOLVE, outcome: 'teacher_no_show' });
    expect(logged.at(-1)).toEqual({
      fields: { enrollmentId: ENROLLMENT },
      message: 'Enrollment completed',
    });
  });

  it.each<SessionStatus>([
    'scheduled',
    'done',
    'student_no_show',
    'teacher_no_show',
    'both_no_show',
    'disputed',
    'cancelled_by_admin',
    'cancelled_by_agreement',
  ])(
    'refuses a %s session CONFLICT not_under_review under the locks, writing nothing',
    async (status) => {
      const { service, journal, written, logged } = world({
        first: 'under_threshold',
        again: status,
      });
      const refused = await refusalOf(service.resolve(tx, ADMIN, RESOLVE));
      expect(refused.code).toBe('CONFLICT');
      expect(refused.details).toEqual([{ path: 'cause', code: 'not_under_review' }]);
      expect(journal).toEqual([
        'read',
        `lock enrollments ${ENROLLMENT}`,
        `lock sessions ${SESSION}`,
        'read again',
      ]);
      expect(written).toEqual([]);
      expect(logged).toEqual([
        {
          fields: {
            adminId: ADMIN,
            sessionId: SESSION,
            enrollmentId: ENROLLMENT,
            errorCode: 'CONFLICT',
            cause: 'not_under_review',
          },
          message: 'A session review call was refused',
        },
      ]);
    },
  );

  it('refuses a session that does not exist NOT_FOUND before any lock, writing nothing', async () => {
    const { service, journal, written, logged } = world({ first: null });
    expect((await refusalOf(service.resolve(tx, ADMIN, RESOLVE))).code).toBe('NOT_FOUND');
    expect(journal).toEqual(['read']);
    expect(written).toEqual([]);
    expect(logged).toHaveLength(1);
  });
});
