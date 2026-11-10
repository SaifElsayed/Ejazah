// T030 of specs/004-sessions/tasks.md (FR-463, FR-465, FR-467; SC-410; ADR 0018 D4; R-MONEY-6;
// contracts/kernel.md, the row «`sessions.remedy.choose` … and a counter left unanswered handed to a
// `counter_unanswered` case by the sweep») — `createRemedyCase` over a recorded store: the remedy
// read with no lock to learn its session, enrollment and parties; then both accounts (one call, id
// order), the teacher's `lockKey('teacher-slots')`, the enrollment, the session and the remedy; the
// remedy read again under them; the database's clock; the enrollment's case of the reason opened or
// joined through moderation's `openCompensationCase`; the remedy `refund_case` with that case and
// `decided_at`, `kind` `refund` for `refund_choice` and `counter_unanswered` and left `makeup` for
// `makeup_refused` (Q6 (a)); one `remedy_handed_to_case` row. A remedy no longer in a state its
// reason hands over is refused `REMEDY_NOT_OPEN`, and a remedy that does not exist `NOT_FOUND`, each
// with one log line of ids and a reason and nothing written. The automatic hand-offs' one info line
// (Q11 (a)), written by the caller after its commit. Over the real tables:
// `tests/db-integrity/remedy-case.spec.ts`.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { RemedyToHandOff } from './remedy-case.repository.js';
import {
  createRemedyCase,
  logRemedyHandedOff,
  type RemedyCaseReason,
  type RemedyCaseStore,
} from './remedy-case.service.js';

const tx = {} as Transaction;
const REMEDY = '0199d0a0-0000-7000-8000-0000000000f1';
const SESSION = '0199d0a0-0000-7000-8000-000000000051';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
// The teacher's id sorts before the student's, so «one call, id order» is seen.
const TEACHER = '0199d0a0-0000-7000-8000-0000000000a1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000b1';
const CASE = '0199d0a0-0000-7000-8000-0000000000c1';
const AT = new Date('2026-11-10T09:00:00Z');

type Status = RemedyToHandOff['status'];

function world(first: Status | null, again: Status | null = first, opened = true) {
  const journal: string[] = [];
  const logged: { fields: Record<string, unknown>; message: string }[] = [];
  let reads = 0;
  const row = (status: Status | null): RemedyToHandOff | null =>
    status === null
      ? null
      : {
          id: REMEDY,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          studentUserId: STUDENT,
          teacherUserId: TEACHER,
          status,
          kind: 'makeup',
        };
  const store: RemedyCaseStore = {
    remedyToHandOff: async (_tx, remedyId) => {
      expect(remedyId).toBe(REMEDY);
      reads += 1;
      journal.push(reads === 1 ? 'read' : 'read again');
      return row(reads === 1 ? first : again);
    },
    lockAccounts: async (_tx, ids) => {
      journal.push(`lock users ${ids.join(',')}`);
    },
    lockTeacherSlots: async (_tx, teacherUserId) => {
      journal.push(`lock teacher-slots ${teacherUserId}`);
    },
    lockEnrollments: async (_tx, ids) => {
      journal.push(`lock enrollments ${ids.join(',')}`);
    },
    lockSessions: async (_tx, ids) => {
      journal.push(`lock sessions ${ids.join(',')}`);
    },
    lockRemedies: async (_tx, ids) => {
      journal.push(`lock remedies ${ids.join(',')}`);
    },
    openCase: async (_tx, enrollmentId, reason) => {
      journal.push(`case ${enrollmentId} ${reason}`);
      return { caseId: CASE, opened };
    },
    handOver: async (_tx, remedyId, from, write) => {
      journal.push(
        `hand ${remedyId} from ${from.join('|')} to ${write.caseId} kind ${write.kind ?? 'unchanged'}`,
      );
      expect(write.decidedAt).toEqual(AT);
      return true;
    },
    recordEvents: async (_tx, events) => {
      journal.push(
        `events ${events.map((event) => `${event.kind}:${event.sessionId ?? ''}`).join(',')}`,
      );
      for (const event of events) {
        expect(event.enrollmentId).toBe(ENROLLMENT);
        expect(event.occurredAt).toEqual(AT);
        expect(event.caseId ?? null).toBeNull();
      }
    },
  };
  const service = createRemedyCase({
    log: {
      info: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
    } as unknown as Pick<Logger, 'info'>,
    clock: async () => {
      journal.push('clock');
      return AT;
    },
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
  expect(isRefusalLogged(thrown), `${thrown.code} marked «logged»`).toBe(true);
  return thrown;
}

const LOCKS = [
  'read',
  `lock users ${TEACHER},${STUDENT}`,
  `lock teacher-slots ${TEACHER}`,
  `lock enrollments ${ENROLLMENT}`,
  `lock sessions ${SESSION}`,
  `lock remedies ${REMEDY}`,
  'read again',
];

describe('the refund hand-off (T030, FR-467, SC-410)', () => {
  it.each<[RemedyCaseReason, Status, string, 'refund' | 'makeup']>([
    ['refund_choice', 'awaiting_choice', 'awaiting_choice', 'refund'],
    ['counter_unanswered', 'counter_proposed', 'counter_proposed', 'refund'],
    ['makeup_refused', 'proposed', 'proposed|awaiting_choice', 'makeup'],
    ['makeup_refused', 'awaiting_choice', 'proposed|awaiting_choice', 'makeup'],
  ])(
    "hands a %s remedy from %s to its case in the kernel row's lock order, kind %s",
    async (reason, status, from, kind) => {
      const { service, journal, logged } = world(status);
      const handed = await service.handOff(tx, { remedyId: REMEDY, reason });
      expect(journal).toEqual([
        ...LOCKS,
        'clock',
        `case ${ENROLLMENT} ${reason}`,
        `hand ${REMEDY} from ${from} to ${CASE} kind ${kind === 'refund' ? 'refund' : 'unchanged'}`,
        `events remedy_handed_to_case:${SESSION}`,
      ]);
      expect(handed).toEqual({
        remedyId: REMEDY,
        sessionId: SESSION,
        enrollmentId: ENROLLMENT,
        caseId: CASE,
        caseOpened: true,
        reason,
        kind,
      });
      // The hand-off itself writes no line: an automatic one's is the caller's, after its commit.
      expect(logged).toEqual([]);
    },
  );

  it("joins the enrollment's open case of the reason, as moderation answers it", async () => {
    const { service } = world('awaiting_choice', 'awaiting_choice', false);
    const handed = await service.handOff(tx, { remedyId: REMEDY, reason: 'refund_choice' });
    expect(handed).toMatchObject({ caseId: CASE, caseOpened: false });
  });

  it.each<[RemedyCaseReason, Status]>([
    ['refund_choice', 'proposed'],
    ['refund_choice', 'frozen'],
    ['counter_unanswered', 'proposed'],
    ['counter_unanswered', 'booked'],
    ['makeup_refused', 'counter_proposed'],
    ['makeup_refused', 'refund_case'],
    ['makeup_refused', 'lapsed'],
  ])(
    'refuses %s on a remedy %s under the locks REMEDY_NOT_OPEN, one line, nothing written',
    async (reason, status) => {
      const { service, journal, logged } = world('awaiting_choice', status);
      const refused = await refusalOf(service.handOff(tx, { remedyId: REMEDY, reason }));
      expect(refused.code).toBe('REMEDY_NOT_OPEN');
      expect(journal).toEqual(LOCKS);
      expect(logged).toEqual([
        {
          fields: {
            remedyId: REMEDY,
            sessionId: SESSION,
            enrollmentId: ENROLLMENT,
            caseReason: reason,
            errorCode: 'REMEDY_NOT_OPEN',
            reason: 'not_open',
          },
          message: 'A remedy hand-off was refused',
        },
      ]);
    },
  );

  it('refuses a remedy that does not exist NOT_FOUND, one line, no lock and nothing written', async () => {
    const { service, journal, logged } = world(null);
    const refused = await refusalOf(
      service.handOff(tx, { remedyId: REMEDY, reason: 'refund_choice' }),
    );
    expect(refused.code).toBe('NOT_FOUND');
    expect(journal).toEqual(['read']);
    expect(logged).toEqual([
      {
        fields: {
          remedyId: REMEDY,
          caseReason: 'refund_choice',
          errorCode: 'NOT_FOUND',
          reason: 'not_found',
        },
        message: 'A remedy hand-off was refused',
      },
    ]);
  });
});

describe("an automatic hand-off's one line (Q11 (a))", () => {
  it.each(['counter_unanswered', 'makeup_refused'] as const)(
    'writes %s as one info line of the four ids and the action, nothing else',
    (reason) => {
      const lines: { fields: unknown; message: unknown }[] = [];
      logRemedyHandedOff(
        {
          info: (...args: unknown[]) => {
            lines.push({ fields: args[0], message: args[1] });
          },
        } as unknown as Pick<Logger, 'info'>,
        {
          remedyId: REMEDY,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          caseId: CASE,
          caseOpened: true,
          reason,
          kind: reason === 'makeup_refused' ? 'makeup' : 'refund',
        },
      );
      expect(lines).toEqual([
        {
          fields: {
            remedyId: REMEDY,
            sessionId: SESSION,
            enrollmentId: ENROLLMENT,
            action: reason,
          },
          message: 'A remedy was handed to a case',
        },
      ]);
    },
  );
});
