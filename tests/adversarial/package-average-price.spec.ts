// 003:T113 (SRS DEC-88, FR-PROFILE-2 as amended; Q-T113 (a)) — `teacher.packages.averagePrice`, the
// package editor's average-price hint, through the real router over the real catalog services and
// identity's visibility predicate, against Postgres, in both directions: a male teacher and a female
// teacher.
//
// The pool is the other teachers' active packages on the asked track and length whose teacher the
// predicate shows a student of the viewer's own gender; at least three such teachers, or nothing.
// Each exclusion is its own case: two counted teachers and a third whose package is the excluded one
// answer nothing, where a control with a counted third answers the average. So a case cannot pass on
// a read that answers nothing to everyone. The answer names no teacher; an input naming a gender or a
// teacher is refused; a student, an applicant and an anonymous caller are refused before any read.
//
// Not a registration of `registered-attacks.ts`: B43's completeness check takes the student-facing
// procedures and those of `sessions`, `chat` and `live` only (`studentFacingProcedures`), and fails a
// teacher-kind path listed there; this file is the teacher-kind spec in `teacher-slots-published`'s
// shape, run by `test:adversarial`.
//
// NOTHING IS LEFT BEHIND: every case runs inside one Prisma interactive transaction that always ends
// by throwing, and every transaction the services open is that one. Each case first deactivates
// every package already in the database, inside that transaction, so rows other specs left cannot
// enter the pool; that too rolls back.
//
// Observed red: every case against the router before the procedure existed; each exclusion and each
// refusal against its mutant (M-A9 to M-A19 in `ejazah-tools\track2\b-m1\lane-a-report.md`), restored and
// `cmp`-checked.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { createCatalogUse } from '../../apps/api/src/modules/booking/index.js';
import {
  createCatalogServices,
  packagesRouter,
} from '../../apps/api/src/modules/catalog/index.js';
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
import {
  createAppCallerFactory,
  createAppRouter,
  toErrorShape,
} from '../../apps/api/src/surfaces/procedures.js';
import {
  unusedBookingServices,
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

/** Runs `attack` in a transaction that rolls back, every package already there deactivated first. */
async function inRollback(attack: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await tx.package.updateMany({ data: { isActive: false } });
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

const otherGender = (gender: Gender): Gender => (gender === 'male' ? 'female' : 'male');

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
  });
}

/** An active, approved teacher of `gender`; published unless the payout account is unverified. */
async function teacher(
  tx: Transaction,
  gender: Gender,
  options: { readonly payoutVerified?: boolean } = {},
): Promise<string> {
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
      payoutVerifiedAt: options.payoutVerified === false ? null : new Date('2026-10-20T09:00:00Z'),
    },
  });
  return id;
}

/** The asked track and length. */
const ASKED = { track: 'recitation', sessionDurationMinutes: 45 } as const;

interface PackageTerms {
  readonly price: number;
  readonly sessionCount: number;
  readonly track?: 'recitation' | 'ijazah_track';
  readonly sessionDurationMinutes?: 30 | 45 | 60;
  readonly isActive?: boolean;
}

/** A package of the teacher's, on the asked track and length unless told otherwise. */
async function packageOf(tx: Transaction, teacherUserId: string, terms: PackageTerms) {
  const { id: subjectId } = await tx.subject.create({
    data: { nameAr: 'القرآن الكريم', nameEn: "Qur'an", isActive: true },
    select: { id: true },
  });
  await tx.package.create({
    data: {
      teacherUserId,
      subjectId,
      track: terms.track ?? ASKED.track,
      sessionCount: terms.sessionCount,
      sessionDurationMinutes: terms.sessionDurationMinutes ?? ASKED.sessionDurationMinutes,
      pricePiasters: BigInt(terms.price),
      isActive: terms.isActive ?? true,
    },
  });
}

const callerFor = createAppCallerFactory(
  createAppRouter({ teacher: createAppRouter({ packages: packagesRouter }) }),
);

type Standing = 'teacher' | 'student' | 'applicant' | 'anonymous';

/** The session of `userId` in `standing`; none for an anonymous caller. */
function sessionOf(userId: string, gender: Gender, standing: Standing) {
  if (standing === 'anonymous') return null;
  const base = {
    userId,
    sessionId: randomUUID(),
    gender,
    preferredLanguage: 'ar' as const,
    accountStatus: 'active' as const,
  };
  if (standing === 'student') return { ...base, role: 'student' as const };
  const applicant = standing === 'applicant';
  return {
    ...base,
    role: 'teacher' as const,
    teacher: {
      verificationStatus: applicant ? ('pending' as const) : ('approved' as const),
      payoutVerified: !applicant,
      applicationStatus: applicant ? ('in_review' as const) : ('approved' as const),
    },
  };
}

/** `teacher.packages` over the real services, called with the session of `userId` in `standing`. */
function callerAs(tx: Transaction, userId: string, gender: Gender, standing: Standing = 'teacher') {
  return callerFor(
    createAppContext({
      session: sessionOf(userId, gender, standing),
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
        catalog: catalogOn(tx),
      },
    }),
  );
}

/**
 * The viewer and two counted teachers of the viewer's gender: per session 30 000 (90 000 over 3)
 * and 20 000 (40 000 over 2). A third counted teacher at 10 001 over 1 makes the average 20 000
 * (60 001 over 3, rounded half up).
 */
async function twoCounted(tx: Transaction, gender: Gender): Promise<string> {
  const viewer = await teacher(tx, gender);
  await packageOf(tx, await teacher(tx, gender), { price: 90_000, sessionCount: 3 });
  await packageOf(tx, await teacher(tx, gender), { price: 40_000, sessionCount: 2 });
  return viewer;
}

const THIRD = { price: 10_001, sessionCount: 1 } as const;

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

describe.each(DIRECTIONS)(
  '003:T113, $name: the average price per session of the other published teachers',
  ({ gender }) => {
    it('answers the average with a third counted teacher, and names no teacher', async () => {
      await inRollback(async (tx) => {
        const viewer = await twoCounted(tx, gender);
        await packageOf(tx, await teacher(tx, gender), THIRD);

        const answer = await callerAs(tx, viewer, gender).teacher.packages.averagePrice(ASKED);
        expect(answer).toEqual({ averagePerSession_piasters: 20_000 });
        expect(Object.keys(answer)).toEqual(['averagePerSession_piasters']);
      });
    });

    it('leaves out a package on another track', async () => {
      await inRollback(async (tx) => {
        const viewer = await twoCounted(tx, gender);
        await packageOf(tx, await teacher(tx, gender), { ...THIRD, track: 'ijazah_track' });

        expect(await callerAs(tx, viewer, gender).teacher.packages.averagePrice(ASKED)).toEqual({});
      });
    });

    it('leaves out a package of another session length', async () => {
      await inRollback(async (tx) => {
        const viewer = await twoCounted(tx, gender);
        await packageOf(tx, await teacher(tx, gender), { ...THIRD, sessionDurationMinutes: 60 });

        expect(await callerAs(tx, viewer, gender).teacher.packages.averagePrice(ASKED)).toEqual({});
      });
    });

    it('leaves out a paused package', async () => {
      await inRollback(async (tx) => {
        const viewer = await twoCounted(tx, gender);
        await packageOf(tx, await teacher(tx, gender), { ...THIRD, isActive: false });

        expect(await callerAs(tx, viewer, gender).teacher.packages.averagePrice(ASKED)).toEqual({});
      });
    });

    it('leaves out an unpublished teacher (payout account not verified)', async () => {
      await inRollback(async (tx) => {
        const viewer = await twoCounted(tx, gender);
        await packageOf(tx, await teacher(tx, gender, { payoutVerified: false }), THIRD);

        expect(await callerAs(tx, viewer, gender).teacher.packages.averagePrice(ASKED)).toEqual({});
      });
    });

    it("leaves out a teacher published to the other gender only (Q-T113 (a))", async () => {
      await inRollback(async (tx) => {
        const viewer = await twoCounted(tx, gender);
        await packageOf(tx, await teacher(tx, otherGender(gender)), THIRD);

        expect(await callerAs(tx, viewer, gender).teacher.packages.averagePrice(ASKED)).toEqual({});
      });
    });

    it("leaves out the viewing teacher's own packages", async () => {
      await inRollback(async (tx) => {
        const viewer = await twoCounted(tx, gender);
        await packageOf(tx, viewer, THIRD);

        expect(await callerAs(tx, viewer, gender).teacher.packages.averagePrice(ASKED)).toEqual({});
      });
    });

    it.each(['gender', 'teacherId'] as const)(
      'refuses an input naming a %s VALIDATION_FAILED, before any read',
      async (named) => {
        await inRollback(async (tx) => {
          const viewer = await twoCounted(tx, gender);
          await packageOf(tx, await teacher(tx, gender), THIRD);
          const extra = named === 'gender' ? { gender: otherGender(gender) } : { teacherId: viewer };

          const thrown: unknown = await callerAs(tx, viewer, gender)
            .teacher.packages.averagePrice({ ...ASKED, ...extra } as typeof ASKED)
            .catch((error: unknown) => error);
          expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
            'VALIDATION_FAILED',
          );
        });
      },
    );

    it.each([
      { standing: 'student', code: 'FORBIDDEN' },
      { standing: 'applicant', code: 'FORBIDDEN' },
      { standing: 'anonymous', code: 'UNAUTHENTICATED' },
    ] as const)('refuses $standing $code, before any read', async ({ standing, code }) => {
      await inRollback(async (tx) => {
        const viewer = await twoCounted(tx, gender);
        await packageOf(tx, await teacher(tx, gender), THIRD);

        await expect(
          callerAs(tx, viewer, gender, standing).teacher.packages.averagePrice(ASKED),
        ).rejects.toEqual(refused(code));
      });
    });
  },
);
