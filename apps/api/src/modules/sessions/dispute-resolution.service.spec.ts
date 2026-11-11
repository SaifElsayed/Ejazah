// T034 of specs/004-sessions/tasks.md (FR-421, FR-422, FR-476; research R-308; contracts/kernel.md,
// «evaluation, a review or dispute resolution» and the `party_*` row; B39's notes under T034: Q2,
// Q3 (a), F1) — `createDisputeResolution` over a recorded store. Each of the six resolutions maps to
// R-308's final status, written through the one writer of an administrator's outcome
// (`dispute_resolved`), then the dispute closed with the resolution, the reason, the administrator
// and the database's instant, then T015's check; `compensation_ordered` records the decision and
// touches nothing else (FR-DISPUTE-6). A ruling with no standing move locks the enrollment, the
// session, then the dispute; a `party_*` ruling the party's account (and a banned teacher's
// application), the slots' keys ascending, the enrollments, the sessions and the remedies in one
// call each, then the dispute, before `StandingService`. Refused, writing nothing and logged once:
// `NOT_FOUND`, `CONFLICT` `not_open`, `CONFLICT` `not_evaluated`, and the standing move refused.
// Over the real tables: `tests/db-integrity/dispute-resolution.spec.ts`.
import type { SessionStatus } from '@ijazah/contracts';
import type { DisputesResolveInput } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { SessionDisputeRow } from '../moderation/index.js';
import {
  createDisputeResolution,
  type DisputeResolutionStore,
  type DisputeStanding,
} from './dispute-resolution.service.js';
import type { EnrollmentPageItem } from './enrollment-side.port.js';

const tx = {} as Transaction;
const ADMIN = '0199d0a0-0000-7000-8000-0000000000a1';
const DISPUTE = '0199d0a0-0000-7000-8000-0000000000d1';
const SESSION = '0199d0a0-0000-7000-8000-000000000055';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e5';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000b5';
const TEACHER = '0199d0a0-0000-7000-8000-0000000000b2';
const OTHER_TEACHER = '0199d0a0-0000-7000-8000-0000000000b9';
const AT = new Date('2026-11-10T09:00:00Z');
/** An active hold on the party's slots, and the enrollment awaiting payment it was placed for. */
const HOLD = '0199d0a0-0000-7000-8000-000000000011';
const PENDING = '0199d0a0-0000-7000-8000-0000000000e3';
const REASON = 'اتضح من السجل غياب المعلم';

type Input = DisputesResolveInput;

const disputeRow = (status: SessionDisputeRow['status'] = 'open'): SessionDisputeRow => ({
  id: DISPUTE,
  enrollmentId: ENROLLMENT,
  sessionId: SESSION,
  raisedByUserId: STUDENT,
  reason: 'لم يحضر المعلم',
  status,
  createdAt: new Date('2026-11-09T09:00:00Z'),
  resolution: null,
  resolutionNotes: null,
  resolvedAt: null,
});

interface World {
  readonly dispute?: SessionDisputeRow['status'] | null;
  readonly frozen?: SessionStatus | null;
  /** The party's confirmed enrollments, each `[enrollmentId, studentUserId, teacherUserId]`. */
  readonly confirmed?: readonly (readonly [string, string, string])[];
  readonly standingRefuses?: boolean;
  readonly completes?: boolean;
}

function world({
  dispute = 'open',
  frozen = 'teacher_no_show',
  confirmed = [],
  standingRefuses = false,
  completes = false,
}: World = {}) {
  const journal: string[] = [];
  const logged: { fields: Record<string, unknown>; message: string }[] = [];
  const session = {
    id: SESSION,
    enrollmentId: ENROLLMENT,
    status: 'disputed' as SessionStatus,
    outcomeUnderDispute: frozen,
    studentUserId: STUDENT,
    teacherUserId: TEACHER,
  };
  const store: DisputeResolutionStore = {
    disputeOf: async () => (dispute === null ? null : disputeRow(dispute)),
    sessionToResolve: async () => session,
    lockAccount: async (_tx, id) => {
      journal.push(`lock users ${id}`);
    },
    lockApplication: async (_tx, id) => {
      journal.push(`lock teacher_profiles ${id}`);
    },
    lockTeacherSlots: async (_tx, id) => {
      journal.push(`key ${id}`);
    },
    scheduledSessionsOf: async (_tx, ids) =>
      ids.map((enrollmentId, i) => ({
        id: `0199d0a0-0000-7000-8000-00000000005${String(i)}`,
        enrollmentId,
      })),
    openRemediesOf: async (_tx, ids) =>
      ids.map((enrollmentId, i) => ({
        id: `0199d0a0-0000-7000-8000-0000000000f${String(i)}`,
        sessionId: SESSION,
        enrollmentId,
      })),
    lockRows: async (_tx, table, ids) => {
      journal.push(`lock ${table} ${ids.join(',')}`);
    },
    lockDispute: async (_tx, id) => {
      journal.push(`lock disputes ${id}`);
    },
    writeOutcome: async (_tx, write) => {
      journal.push(`write ${write.from}->${write.outcome} ${write.event.kind}`);
      expect(write).toMatchObject({
        sessionId: SESSION,
        enrollmentId: ENROLLMENT,
        adminId: ADMIN,
        at: AT,
      });
    },
    closeDispute: async (_tx, ruling) => {
      journal.push(`close ${ruling.resolution}`);
      expect(ruling).toEqual({
        disputeId: DISPUTE,
        resolution: ruling.resolution,
        notes: REASON,
        adminId: ADMIN,
        resolvedAt: AT,
      });
      return true;
    },
  };
  const move =
    (name: string) =>
    async (_tx: Transaction, adminId: string, userId: string): Promise<never> => {
      expect(adminId).toBe(ADMIN);
      journal.push(`standing ${name} ${userId}`);
      if (standingRefuses) {
        throw new DomainError('CONFLICT', undefined, {
          details: [{ path: 'teacherUserId', code: 'suspended' }],
        });
      }
      return { before: {}, after: {} } as never;
    };
  const standing = {
    suspend: move('suspend'),
    ban: move('ban'),
    suspendStudent: move('suspendStudent'),
    banStudent: move('banStudent'),
  } as unknown as DisputeStanding;
  const page = (items: EnrollmentPageItem[]) => ({ items });
  const service = createDisputeResolution({
    enrollments: {
      lockEnrollments: async (_tx, ids) => {
        journal.push(`lock enrollments ${ids.join(',')}`);
      },
      enrollmentPage: async (_tx, filter) => {
        journal.push(`confirmed of ${JSON.stringify(filter)}`);
        return page(
          confirmed.map(([enrollmentId, studentUserId, teacherUserId]) => ({
            enrollmentId,
            studentUserId,
            teacherUserId,
            status: 'confirmed',
            track: 'recitation',
            sessionCount: 4,
          })),
        );
      },
    },
    standing,
    lockActiveHolds: async (_tx, id) => {
      journal.push(`lock slot_holds of ${id}`);
      return { holdIds: [HOLD], enrollmentIds: [PENDING] };
    },
    completion: {
      completeIfDue: async (_tx, enrollmentId) => {
        journal.push(`completion ${enrollmentId}`);
        return completes;
      },
    },
    log: {
      info: (...args: unknown[]) => {
        logged.push({ fields: args[0] as Record<string, unknown>, message: args[1] as string });
      },
    } as unknown as Parameters<typeof createDisputeResolution>[0]['log'],
    clock: async () => AT,
    store,
  });
  return { service, journal, logged };
}

const input = (fields: Partial<Input> & Pick<Input, 'resolution'>): Input => ({
  disputeId: DISPUTE,
  reason: REASON,
  ...fields,
});

async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  expect(isRefusalLogged(thrown), `${thrown.code} marked «logged»`).toBe(true);
  return thrown;
}

const PLAIN_LOCKS = [
  `lock enrollments ${ENROLLMENT}`,
  `lock sessions ${SESSION}`,
  `lock disputes ${DISPUTE}`,
];

describe('disputes.resolve: R-308’s mapping', () => {
  it.each<[string, Input, SessionStatus | null, SessionStatus]>([
    [
      'upheld keeps the frozen outcome',
      input({ resolution: 'upheld' }),
      'teacher_no_show',
      'teacher_no_show',
    ],
    [
      'upheld over a frozen under_threshold returns it to the queue',
      input({ resolution: 'upheld' }),
      'under_threshold',
      'under_threshold',
    ],
    [
      're_marked consumed is done',
      input({ resolution: 're_marked', consumed: true }),
      'teacher_no_show',
      'done',
    ],
    [
      're_marked not consumed is both_no_show',
      input({ resolution: 're_marked', consumed: false }),
      'done',
      'both_no_show',
    ],
    [
      're_marked before the evaluation names its own outcome',
      input({ resolution: 're_marked', consumed: true }),
      null,
      'done',
    ],
    [
      'no_show_recorded against the student',
      input({ resolution: 'no_show_recorded', against: 'student' }),
      'done',
      'student_no_show',
    ],
    [
      'no_show_recorded against the teacher, before the evaluation',
      input({ resolution: 'no_show_recorded', against: 'teacher' }),
      null,
      'teacher_no_show',
    ],
    [
      'compensation_ordered keeps the frozen outcome',
      input({ resolution: 'compensation_ordered' }),
      'both_no_show',
      'both_no_show',
    ],
  ])('%s', async (_name, given, frozen, status) => {
    const { service, journal, logged } = world({ frozen });
    expect(await service.resolve(tx, ADMIN, given)).toEqual({
      disputeId: DISPUTE,
      sessionStatus: status,
    });
    // `compensation_ordered` included: the session's outcome and the dispute's ruling, nothing else
    // written, no amount (FR-DISPUTE-6).
    expect(journal).toEqual([
      ...PLAIN_LOCKS,
      `write disputed->${status} dispute_resolved`,
      `close ${given.resolution}`,
      `completion ${ENROLLMENT}`,
    ]);
    expect(logged).toEqual([
      {
        fields: {
          adminId: ADMIN,
          disputeId: DISPUTE,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          resolution: given.resolution,
          status,
        },
        message: 'A session dispute was resolved',
      },
    ]);
  });

  it('writes the completion line on the transaction when the check completes the enrollment', async () => {
    const { service, logged } = world({ completes: true });
    await service.resolve(tx, ADMIN, input({ resolution: 'upheld' }));
    expect(logged.at(-1)).toEqual({
      fields: { enrollmentId: ENROLLMENT },
      message: 'Enrollment completed',
    });
  });
});

describe('disputes.resolve: party_suspended and party_banned (FR-421, F3, L-A, L1, F1)', () => {
  const CONFIRMED_A = '0199d0a0-0000-7000-8000-0000000000e1';
  const CONFIRMED_B = '0199d0a0-0000-7000-8000-0000000000e9';

  it('against the teacher, suspended: the account, the key, the holds, the enrollments, the sessions and remedies in one call each, the dispute, then StandingService', async () => {
    const { service, journal } = world({
      confirmed: [
        [CONFIRMED_B, STUDENT, TEACHER],
        [CONFIRMED_A, OTHER_TEACHER, TEACHER],
      ],
    });
    expect(
      await service.resolve(tx, ADMIN, input({ resolution: 'party_suspended', party: 'teacher' })),
    ).toEqual({ disputeId: DISPUTE, sessionStatus: 'teacher_no_show' });
    expect(journal).toEqual([
      `lock users ${TEACHER}`,
      `confirmed of ${JSON.stringify({ status: 'confirmed', teacherUserIds: [TEACHER] })}`,
      `key ${TEACHER}`,
      // The holds the subscriber releases, after the keys and before the enrollments (item 3), and
      // their enrollments with the others in one call.
      `lock slot_holds of ${TEACHER}`,
      `lock enrollments ${[CONFIRMED_A, PENDING, ENROLLMENT, CONFIRMED_B].join(',')}`,
      // The dispute's session and the party's remaining ones, one call, id order (F1).
      `lock sessions ${[
        '0199d0a0-0000-7000-8000-000000000050',
        '0199d0a0-0000-7000-8000-000000000051',
        SESSION,
      ].join(',')}`,
      `lock session_remedies ${[
        '0199d0a0-0000-7000-8000-0000000000f0',
        '0199d0a0-0000-7000-8000-0000000000f1',
      ].join(',')}`,
      `lock disputes ${DISPUTE}`,
      `standing suspend ${TEACHER}`,
      'write disputed->teacher_no_show dispute_resolved',
      'close party_suspended',
      `completion ${ENROLLMENT}`,
    ]);
  });

  it('against the teacher, banned: the application after the account and before the key (L-A)', async () => {
    const { service, journal } = world();
    await service.resolve(tx, ADMIN, input({ resolution: 'party_banned', party: 'teacher' }));
    expect(journal.slice(0, 4)).toEqual([
      `lock users ${TEACHER}`,
      `lock teacher_profiles ${TEACHER}`,
      `confirmed of ${JSON.stringify({ status: 'confirmed', teacherUserIds: [TEACHER] })}`,
      `key ${TEACHER}`,
    ]);
    expect(journal).toContain(`standing ban ${TEACHER}`);
  });

  it.each([
    ['party_suspended', 'suspendStudent'],
    ['party_banned', 'banStudent'],
  ] as const)(
    'against the student, %s: every key of the student’s own and their teachers’, ascending (L1), then %s',
    async (resolution, move) => {
      const { service, journal } = world({
        frozen: 'student_no_show',
        confirmed: [
          [CONFIRMED_A, STUDENT, OTHER_TEACHER],
          [CONFIRMED_B, STUDENT, TEACHER],
        ],
      });
      await service.resolve(tx, ADMIN, input({ resolution, party: 'student' }));
      expect(journal.slice(0, 7)).toEqual([
        `lock users ${STUDENT}`,
        `confirmed of ${JSON.stringify({ status: 'confirmed', studentUserIds: [STUDENT] })}`,
        `key ${TEACHER}`,
        `key ${STUDENT}`,
        `key ${OTHER_TEACHER}`,
        `lock slot_holds of ${STUDENT}`,
        `lock enrollments ${[CONFIRMED_A, PENDING, ENROLLMENT, CONFIRMED_B].join(',')}`,
      ]);
      expect(journal).not.toContain(`lock teacher_profiles ${STUDENT}`);
      expect(journal).toContain(`standing ${move} ${STUDENT}`);
    },
  );

  it('a standing move refused refuses the whole ruling with its refusal, writing nothing, logged once (Q3 (a))', async () => {
    const { service, journal, logged } = world({ standingRefuses: true });
    const refused = await refusalOf(
      service.resolve(tx, ADMIN, input({ resolution: 'party_suspended', party: 'teacher' })),
    );
    expect(refused.code).toBe('CONFLICT');
    expect(refused.details).toEqual([{ path: 'teacherUserId', code: 'suspended' }]);
    expect(journal.at(-1)).toBe(`standing suspend ${TEACHER}`);
    expect(journal.some((line) => line.startsWith('write') || line.startsWith('close'))).toBe(
      false,
    );
    expect(logged).toEqual([
      {
        fields: {
          adminId: ADMIN,
          disputeId: DISPUTE,
          sessionId: SESSION,
          enrollmentId: ENROLLMENT,
          errorCode: 'CONFLICT',
          cause: 'standing_refused',
        },
        message: 'A dispute resolution was refused',
      },
    ]);
  });
});

describe('disputes.resolve: refusals, each writing nothing (Q2)', () => {
  const refusedLine = (cause: string, errorCode = 'CONFLICT') => ({
    fields: {
      adminId: ADMIN,
      disputeId: DISPUTE,
      sessionId: SESSION,
      enrollmentId: ENROLLMENT,
      errorCode,
      cause,
    },
    message: 'A dispute resolution was refused',
  });

  it.each<Input>([
    input({ resolution: 'upheld' }),
    input({ resolution: 'compensation_ordered' }),
    input({ resolution: 'party_suspended', party: 'teacher' }),
    input({ resolution: 'party_banned', party: 'student' }),
  ])(
    'refuses $resolution while the outcome is not yet frozen CONFLICT not_evaluated',
    async (given) => {
      const { service, journal, logged } = world({ frozen: null });
      const refused = await refusalOf(service.resolve(tx, ADMIN, given));
      expect(refused.code).toBe('CONFLICT');
      expect(refused.details).toEqual([{ path: 'cause', code: 'not_evaluated' }]);
      expect(journal.at(-1)).toBe(`lock disputes ${DISPUTE}`);
      expect(journal.some((line) => line.startsWith('standing'))).toBe(false);
      expect(logged).toEqual([refusedLine('not_evaluated')]);
    },
  );

  it.each(['resolved', 'dismissed'] as const)(
    'refuses a %s dispute CONFLICT not_open, under its lock',
    async (status) => {
      const { service, journal, logged } = world({ dispute: status });
      const refused = await refusalOf(service.resolve(tx, ADMIN, input({ resolution: 'upheld' })));
      expect(refused.code).toBe('CONFLICT');
      expect(refused.details).toEqual([{ path: 'cause', code: 'not_open' }]);
      expect(journal).toEqual(PLAIN_LOCKS);
      expect(logged).toEqual([refusedLine('not_open')]);
    },
  );

  it('refuses a dispute that is no session dispute, or none, NOT_FOUND before any lock', async () => {
    const { service, journal, logged } = world({ dispute: null });
    expect(
      (await refusalOf(service.resolve(tx, ADMIN, input({ resolution: 'upheld' })))).code,
    ).toBe('NOT_FOUND');
    expect(journal).toEqual([]);
    expect(logged).toEqual([
      {
        fields: { adminId: ADMIN, disputeId: DISPUTE, errorCode: 'NOT_FOUND', cause: 'not_found' },
        message: 'A dispute resolution was refused',
      },
    ]);
  });
});
