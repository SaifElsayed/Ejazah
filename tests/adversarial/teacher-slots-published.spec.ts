// T069 — a suspended teacher's slots answer `published: false` (FR-315, FR-PROFILE-10, FR-PAYG-14;
// SRS §3.7.1 as amended by `002:T143`; R-GENDER-5).
//
// `teacher.slots.list` answers `published` from identity's `isPublishedTeacher`, the visibility
// predicate asked for the teacher as a student of the session's gender would get it, as
// `teacher.packages.list` does. Its caller kind refuses a session already read as suspended
// (ACCOUNT_RESTRICTED, slots.router.spec.ts), so the attack here is the session read while the
// teacher was active and the suspension committed after it: the call reaches the service, and the
// answer must still say the slots are not published. Run in both directions, a male teacher and a
// female teacher, each with an active, approved, payout-verified control of the same gender that
// answers `published: true`, so the case cannot pass on a predicate that answers false to everyone.
// The suspended teacher still sees their own slots: drafting goes on (FR-315).
//
// Called through the real `teacher.slots` router over the real catalog services and identity's
// predicate, against Postgres. NOTHING IS LEFT BEHIND: every case runs inside one Prisma interactive
// transaction that always ends by throwing, and every transaction the services open is that one, so
// its rows roll back, as in `visibility-standing.spec.ts`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { createCatalogUse } from '../../apps/api/src/modules/booking/index.js';
import { createCatalogServices, slotsRouter } from '../../apps/api/src/modules/catalog/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  specDatabaseUrl,
  whenDatabaseSpecs,
} from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import type { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import { createAppContext } from '../../apps/api/src/surfaces/context.js';
import { createAppCallerFactory, createAppRouter } from '../../apps/api/src/surfaces/procedures.js';
import {
  unusedBookingServices,
  unusedCatalogServices,
  unusedCertificationServices,
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures.js';

const database = whenDatabaseSpecs(() =>
  openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 30_000,
  }),
);
afterAll(() => closeDatabase(database));

const ROLLBACK = new Error('rolled back on purpose: the case leaves no row behind');

async function inRollback(attack: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await attack(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

type Gender = 'male' | 'female';

const DIRECTIONS: readonly { readonly name: string; readonly gender: Gender }[] = [
  { name: 'a male teacher', gender: 'male' },
  { name: 'a female teacher', gender: 'female' },
];

/** Booking's port as `main.ts` binds it, the release buffer at its default of 0 weeks. */
const use = createCatalogUse({ settings: { read: async (_key, schema) => schema.parse(0) } });

/** The catalog services as `main.ts` builds them, every transaction they open being `tx`. */
function catalogOn(tx: Transaction) {
  const on = new Proxy(database, {
    get: (target, member) =>
      member === '$transaction'
        ? (work: (inner: Transaction) => Promise<unknown>) => work(tx)
        : Reflect.get(target, member),
  }) as Database;
  return createCatalogServices({
    database: on,
    use,
    idempotency: { run: (_request, effect) => effect(tx) },
    // 003:T113 (rule d): the slots read no setting.
    settings: { read: async () => Promise.reject(new Error('no setting in this probe')) },
  });
}

/** An active, approved teacher of `gender` with a verified payout account. */
async function publishableTeacher(tx: Transaction, gender: Gender): Promise<string> {
  const { id } = await tx.user.create({
    data: {
      email: `adversarial-${randomUUID()}@example.invalid`,
      gender,
      dateOfBirth: new Date('1990-04-12'),
      displayName: 'محمد عبدالله',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: 'active',
    },
    select: { id: true },
  });
  await tx.teacherProfile.create({
    data: {
      userId: id,
      bio: '',
      qualificationSummary: '',
      verificationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-20T09:00:00Z'),
    },
  });
  return id;
}

const callerFor = createAppCallerFactory(
  createAppRouter({ teacher: createAppRouter({ slots: slotsRouter }) }),
);

/**
 * `teacher.slots` over the real services, called with the session the teacher had when it was read:
 * active, approved and payout-verified, so a suspension committed after it reaches the service.
 */
function teacherCaller(tx: Transaction, teacherId: string, gender: Gender) {
  return callerFor(
    createAppContext({
      session: {
        userId: teacherId,
        sessionId: randomUUID(),
        gender,
        preferredLanguage: 'ar',
        role: 'teacher',
        accountStatus: 'active',
        teacher: {
          verificationStatus: 'approved',
          payoutVerified: true,
          applicationStatus: 'approved',
        },
      },
      log: createLogger({ level: 'info', destination: { write: () => undefined } }),
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
        // T003 of specs/005-certification: the signature's service is composed apart, unused here.
        catalog: { ...catalogOn(tx), signature: unusedCatalogServices.signature },
      },
    }),
  );
}

/** A teacher with one free slot, Sunday 19:30 for 45 minutes. */
async function teacherWithSlot(tx: Transaction, gender: Gender) {
  const teacherId = await publishableTeacher(tx, gender);
  const slot = await catalogOn(tx).slots.create(teacherId, {
    dayOfWeek: 0,
    startTimeLocal: '19:30',
    durationMinutes: 45,
    idempotencyKey: `adversarial-slot-${randomUUID()}`,
  });
  return { teacherId, slotId: slot.id };
}

describe.each(DIRECTIONS)(
  'T069, $name: a suspended teacher’s slots are not published',
  ({ gender }) => {
    it('answers `published: false` for the suspended teacher and `published: true` for the control', async () => {
      await inRollback(async (tx) => {
        const control = await teacherWithSlot(tx, gender);
        const suspended = await teacherWithSlot(tx, gender);
        const before = await teacherCaller(tx, suspended.teacherId, gender).teacher.slots.list();
        expect(before.published).toBe(true);

        await tx.user.update({
          where: { id: suspended.teacherId },
          data: { accountStatus: 'suspended' },
        });

        const answer = await teacherCaller(tx, suspended.teacherId, gender).teacher.slots.list();
        expect(answer.published).toBe(false);
        // Drafting goes on: the teacher still reads their own slot.
        expect(answer.slots.map(({ id }) => id)).toEqual([suspended.slotId]);

        const controlAnswer = await teacherCaller(
          tx,
          control.teacherId,
          gender,
        ).teacher.slots.list();
        expect(controlAnswer.published).toBe(true);
        expect(controlAnswer.slots.map(({ id }) => id)).toEqual([control.slotId]);
      });
    });
  },
);
