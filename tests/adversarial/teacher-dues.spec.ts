// 003:T105 (SRS DEC-89; the note under T105, Q-T113-adv (a)'s precedent) — `teacher.dues.get`, the
// teacher's «مستحقاتي», through the real router over the real payouts service and the real owners'
// reads, against Postgres, in both directions: a male teacher and a female teacher asking, beside a
// teacher of the other gender with releases and a refund of his own.
//
// The caller's own rows only: his held release, never the other teacher's written release (a figure
// of its own, 99,999 piasters, that appears nowhere else), nor his refund's share; no order,
// enrollment or student id and no name in the answer; an input naming a teacher is refused; a student
// and an anonymous caller are refused before any read.
//
// Not a registration of `registered-attacks.ts`: B43's completeness check takes the student-facing
// procedures and those of `sessions`, `chat` and `live` only, and fails a teacher-kind path listed
// there; this file is the teacher-kind spec in `package-average-price.spec.ts`'s shape, run by
// `test:adversarial`. Its rows are probes the integrity database keeps, as `confirmation-world.ts`'s.
//
// Observed red first: the two answers against a router asking for another teacher's rows (a stub),
// the other teacher's rows against a service reading every order with its own-teacher filter gone
// (mutant M-B1-21b; the read alone, M-B1-21, stays green behind the filter, held by M-B1-17), and the input's refusal against a router taking any input (mutant M-B1-26). The
// student's and the anonymous caller's refusals are the teacher kind's (`procedures.spec.ts`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPayoutServices,
  teacherDuesRouter,
} from '../../apps/api/src/modules/payments/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import { createAppContext } from '../../apps/api/src/surfaces/context.js';
import {
  createAppCallerFactory,
  createAppRouter,
  toErrorShape,
} from '../../apps/api/src/surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedModerationServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures.js';
import { confirmationWorld, type Gender } from '../db-integrity/confirmation-world.js';

let database: Database;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const { world } = confirmationWorld(() => database);
const log = createLogger({ level: 'info', destination: { write: () => undefined } });
const callerFor = createAppCallerFactory(
  createAppRouter({ teacher: createAppRouter({ dues: teacherDuesRouter }) }),
);

const DIRECTIONS: readonly { readonly name: string; readonly gender: Gender }[] = [
  { name: 'a male teacher', gender: 'male' },
  { name: 'a female teacher', gender: 'female' },
];

const otherGender = (gender: Gender): Gender => (gender === 'male' ? 'female' : 'male');

/** A paid order of the enrollment with a 70,000 share at 70%, refunded by `refunded`; by SQL. */
async function paidOrder(enrollmentId: string, refunded = 0): Promise<void> {
  await database.$executeRaw`
    INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency, status,
                          expires_at, updated_at, teacher_share_rate_percent, teacher_share_piasters,
                          refunded_piasters)
    VALUES (${enrollmentId}::uuid, 'fake', ${`probe-order-${randomUUID()}`}, 100000, 'EGP', 'paid',
            now(), now(), 70, 70000, ${refunded})`;
}

/** The caller's teacher, his enrollment running with a held release; the other's, released. */
async function pair(gender: Gender) {
  const own = await world({ gender });
  await database.enrollment.update({
    where: { id: own.enrollmentId },
    data: { status: 'confirmed' },
  });
  await paidOrder(own.enrollmentId);
  const other = await world({ gender: otherGender(gender) });
  await database.enrollment.update({
    where: { id: other.enrollmentId },
    data: { status: 'completed' },
  });
  await paidOrder(other.enrollmentId, 50_000);
  await database.teacherShareRelease.create({
    data: {
      enrollmentId: other.enrollmentId,
      teacherUserId: other.teacherId,
      milestone: 'recitation_end',
      amountPiasters: 99_999n,
      dueAt: new Date('2026-10-07T10:00:00Z'),
    },
  });
  return { own, other };
}

type Standing = 'teacher' | 'student' | 'anonymous';

function callerAs(userId: string, gender: Gender, standing: Standing = 'teacher') {
  const base = {
    userId,
    sessionId: randomUUID(),
    gender,
    preferredLanguage: 'ar' as const,
    accountStatus: 'active' as const,
  };
  const session =
    standing === 'anonymous'
      ? null
      : standing === 'student'
        ? { ...base, role: 'student' as const }
        : {
            ...base,
            role: 'teacher' as const,
            teacher: {
              verificationStatus: 'approved' as const,
              payoutVerified: true,
              applicationStatus: 'approved' as const,
            },
          };
  const payouts = createPayoutServices({
    database,
    settings: { read: async (_key, schema) => schema.parse(72) },
    idempotency: { runOn: async () => Promise.reject(new Error('no mark in this spec')) },
    cipher: { decrypt: () => '' },
    log,
  });
  return callerFor(
    createAppContext({
      session,
      log,
      rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
      clientAddress: '203.0.113.9',
      services: {
        settings: { read: async () => Promise.reject(new Error('no setting in this case')) },
        publicConfig: { supportEmail: 'support@ijazah.invalid' },
        subjects: { listActive: async () => [] },
        identity: unusedIdentityServices,
        verification: unusedVerificationServices,
        teacherProfile: unusedTeacherProfileServices,
        discovery: unusedDiscoveryServices,
        booking: unusedBookingServices,
        checkout: unusedCheckoutServices,
        sessions: unusedSessionsServices,
        chat: unusedChatServices,
        certification: unusedCertificationServices,
        moderation: unusedModerationServices,
        catalog: unusedCatalogServices,
        teacherDues: payouts.teacher,
      },
    }),
  );
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe.each(DIRECTIONS)('teacher.dues.get asked by $name (003:T105)', ({ gender }) => {
  it('answers his own held release and never the other teacher’s release or refund', async () => {
    const { own, other } = await pair(gender);
    const answer = await callerAs(own.teacherId, gender).teacher.dues.get({});

    expect(answer).toMatchObject({
      held_piasters: 70_000,
      paid_piasters: 0,
      releases: [{ part: 'recitation_end', amount_piasters: 70_000, state: 'held' }],
      deductions: [],
    });
    const text = JSON.stringify(answer);
    for (const leak of [
      '99999',
      '35000',
      other.teacherId,
      other.enrollmentId,
      own.enrollmentId,
      own.studentId,
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it('answers the other teacher his own release, not the caller’s', async () => {
    const { other } = await pair(gender);
    const answer = await callerAs(other.teacherId, otherGender(gender)).teacher.dues.get({});

    expect(answer.releases).toEqual([
      expect.objectContaining({ part: 'recitation_end', amount_piasters: 99_999, state: 'due' }),
    ]);
    expect(answer.deductions).toEqual([{ share_piasters: 35_000 }]);
    expect(answer.held_piasters).toBe(0);
  });

  it('refuses an input naming a teacher, a student and an anonymous caller', async () => {
    const { own, other } = await pair(gender);
    await expect(
      callerAs(own.teacherId, gender).teacher.dues.get({ teacherUserId: other.teacherId } as never),
    ).rejects.toEqual(expect.objectContaining({ code: 'BAD_REQUEST' }));
    expect(await codeOf(callerAs(own.studentId, gender, 'student').teacher.dues.get({}))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(callerAs(own.teacherId, gender, 'anonymous').teacher.dues.get({}))).toBe(
      'UNAUTHENTICATED',
    );
  });
});
