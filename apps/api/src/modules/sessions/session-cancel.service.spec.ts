// T023 of specs/004-sessions/tasks.md (FR-460, FR-485; SC-413; contracts/kernel.md, the row «an
// administrator's `sessions.cancel`») — `createSessionCancel` over a recorded store: the session
// read with no lock to learn its enrollment, then the enrollment locked, then the session, the
// session read again under them; a `scheduled` one cancelled `cancelled_by_admin`, then its
// enrollment's `admin_cancellation` case opened or joined through moderation's
// `openCompensationCase`, then one `cancelled_by_admin` event carrying that case's id (C4), at the
// database's clock. Any other status, a `disputed` one included (the owner's decision of
// 2026-11-10: its ruling is FR-476's path), is refused `SESSION_NOT_SCHEDULED`, and a session that
// does not exist `NOT_FOUND`, each with one log line of ids and a reason and nothing written. Over
// the real tables: `tests/db-integrity/session-cancel.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SessionToCancel } from './session-cancel.repository.js';
import { createSessionCancel, type SessionCancelStore } from './session-cancel.service.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const CASE = '0199d0a0-0000-7000-8000-0000000000c1';
const AT = new Date('2026-11-10T09:00:00Z');
const INPUT = { sessionId: SESSION, reason: 'المعلم مريض' };

type Status = SessionToCancel['status'];

function world(first: Status | null, again: Status | null = first, opened = true) {
  const journal: string[] = [];
  const logged: { fields: Record<string, unknown>; message: string }[] = [];
  let reads = 0;
  const row = (status: Status | null): SessionToCancel | null =>
    status === null ? null : { id: SESSION, enrollmentId: ENROLLMENT, status };
  const store: SessionCancelStore = {
    sessionToCancel: async (_tx, sessionId) => {
      expect(sessionId).toBe(SESSION);
      reads += 1;
      journal.push(reads === 1 ? 'read' : 'read again');
      return row(reads === 1 ? first : again);
    },
    lockSessions: async (_tx, ids) => {
      journal.push(`lock sessions ${ids.join(',')}`);
    },
    cancelByAdmin: async (_tx, ids) => {
      journal.push(`cancel ${ids.join(',')}`);
    },
    openCase: async (_tx, enrollmentId) => {
      journal.push(`case ${enrollmentId}`);
      return { caseId: CASE, opened };
    },
    recordEvents: async (_tx, events) => {
      journal.push(
        `events ${events
          .map((event) => `${event.kind}:${event.sessionId ?? ''}:${event.caseId ?? ''}`)
          .join(',')}`,
      );
      for (const event of events) {
        expect(event.enrollmentId).toBe(ENROLLMENT);
        expect(event.occurredAt).toEqual(AT);
      }
    },
  };
  const service = createSessionCancel({
    enrollments: {
      lockEnrollments: async (_tx, ids) => {
        journal.push(`lock enrollments ${ids.join(',')}`);
      },
    },
    log: {
      info: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
    } as unknown as Parameters<typeof createSessionCancel>[0]['log'],
    clock: async () => AT,
    store,
  });
  return { service, journal, logged };
}

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  // Logged once, where it was refused (PR #130's review, round 1, Minor 4).
  expect(isRefusalLogged(thrown), `${thrown.code} marked «logged»`).toBe(true);
  return thrown;
}

describe('sessions.cancel (T023, FR-460, kernel.md «an administrator\'s sessions.cancel»)', () => {
  it('locks the enrollment, then the session, reads it again, cancels it, opens the case, and writes one event naming it', async () => {
    const { service, journal } = world('scheduled');
    const answer = await service.cancel(tx, ADMIN, INPUT);
    expect(answer).toEqual({ sessionId: SESSION, status: 'cancelled_by_admin', caseId: CASE });
    expect(journal).toEqual([
      'read',
      `lock enrollments ${ENROLLMENT}`,
      `lock sessions ${SESSION}`,
      'read again',
      `cancel ${SESSION}`,
      `case ${ENROLLMENT}`,
      `events cancelled_by_admin:${SESSION}:${CASE}`,
    ]);
  });

  it("joins the enrollment's open admin_cancellation case, answering its id", async () => {
    const { service, journal } = world('scheduled', 'scheduled', false);
    expect((await service.cancel(tx, ADMIN, INPUT)).caseId).toBe(CASE);
    expect(journal.at(-1)).toBe(`events cancelled_by_admin:${SESSION}:${CASE}`);
  });

  it('logs the cancellation once, with ids and whether the case was opened, never the reason', async () => {
    const { service, logged } = world('scheduled');
    await service.cancel(tx, ADMIN, INPUT);
    expect(logged).toEqual([
      {
        fields: {
          adminId: ADMIN,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          caseId: CASE,
          caseOpened: true,
        },
        message: 'A session was cancelled by an administrator',
      },
    ]);
    expect(JSON.stringify(logged)).not.toContain(INPUT.reason);
  });

  it('refuses a session that does not exist NOT_FOUND, locking and writing nothing, with one log line', async () => {
    const { service, journal, logged } = world(null);
    expect((await refusalOf(service.cancel(tx, ADMIN, INPUT))).code).toBe('NOT_FOUND');
    expect(journal).toEqual(['read']);
    expect(logged).toEqual([
      {
        fields: { adminId: ADMIN, sessionId: SESSION, errorCode: 'NOT_FOUND', reason: 'not_found' },
        message: 'A session cancellation was refused',
      },
    ]);
  });

  it.each<Status>([
    'disputed',
    'done',
    'student_no_show',
    'teacher_no_show',
    'both_no_show',
    'under_threshold',
    'provider_outage',
    'cancelled_by_agreement',
    'cancelled_by_admin',
  ])(
    'refuses a %s session SESSION_NOT_SCHEDULED, read under the locks, writing nothing',
    async (status) => {
      const { service, journal, logged } = world(status);
      expect((await refusalOf(service.cancel(tx, ADMIN, INPUT))).code).toBe(
        'SESSION_NOT_SCHEDULED',
      );
      expect(journal).toEqual([
        'read',
        `lock enrollments ${ENROLLMENT}`,
        `lock sessions ${SESSION}`,
        'read again',
      ]);
      expect(logged).toEqual([
        {
          fields: {
            adminId: ADMIN,
            sessionId: SESSION,
            enrollmentId: ENROLLMENT,
            errorCode: 'SESSION_NOT_SCHEDULED',
            reason: 'not_scheduled',
          },
          message: 'A session cancellation was refused',
        },
      ]);
    },
  );

  it('decides on the read under the locks: a session settled while it waited is refused', async () => {
    const { service, journal } = world('scheduled', 'done');
    expect((await refusalOf(service.cancel(tx, ADMIN, INPUT))).code).toBe(
      'SESSION_NOT_SCHEDULED',
    );
    expect(journal).not.toContain(`cancel ${SESSION}`);
  });
});
