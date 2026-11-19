// T025 of specs/005-certification (FR-625; the note under T025, Q-X1 (a)) — `teacher.signature.get`
// (T003, FR-601, SRS FR-IJAZAH-12; R-SEC-3) attacked in both directions, in the shape of
// `ijazah-requests.attacks.spec.ts`: a male teacher beside a female teacher, then a female teacher
// beside a male one, each holding a signature of their own. A teacher procedure is not
// student-facing, so the procedure harness's coverage does not reach it (`procedure-harness.ts`,
// «WHAT MUST BE REGISTERED»); these cases run on their own, over the real router mounted as
// `app.router.ts` mounts it, on the real signature service and rows in Postgres, the file in an
// in-memory stand-in of the storage port.
//
// The procedure takes no input and reads the caller's own row only (`teacher-signature.router.ts`,
// `ctx.caller.userId`), so nothing names the other teacher: an input naming one is refused by the
// procedure's schema exactly as the same input naming an id that never existed (the same status and
// body, no field naming the id), and the other teacher's signature never appears in an answer. The
// owner is served (its own file's signed link), so no attack passes on a refusal of everything.
//
//   directCall            the owner served its own link; the other gender's teacher served theirs,
//                         never the caller's; a student refused before any read.
//   forgedId              the other teacher's id, their signature's id, a student's id, as input.
//   guessedId             a teacher holding none answers the null pair, never the other's; random
//                         ids, the other teacher's neighbour and its upper-case spelling as input.
//   tamperedToken         a bearer the resolver does not accept is no session (identity's
//                         `resolveUserSession` answers null for it): 401 before anything is read.
//   clientSuppliedGender  a `gender` field naming either gender is refused alike; the answer is the
//                         caller's own.
//
// Sessions are built as the resolver answers them (`teacher-dues.spec.ts`' precedent, 003:T105):
// the discovery world's teachers hold no signature and its services serve none. Rows are probes:
// the signatures deleted (DELETE is granted on `teacher_signatures`, 005:T031) and the accounts
// soft-deleted when the file ends.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTeacherSignatureService,
  type TeacherSignatureService,
  teacherSignatureRouter,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { mapError, type MappedError } from '../../apps/api/src/platform/errors/error-filter.js';
import { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
import { createAppContext, type UserSession } from '../../apps/api/src/surfaces/context.js';
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
import { neighbourOf } from './discovery.attacks.js';
import { type Direction, directions } from './procedure-harness.js';

const HOLDS = 'R-GENDER-2, R-GENDER-4, FR-601, FR-625, R-SEC-3';
const ATTACK_TIMEOUT_MS = 180_000;
const PNG = { type: 'image/png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) } as const;

const SETTINGS: Readonly<Record<string, unknown>> = {
  document_link_ttl_seconds: 300,
  rate_limit_signed_in_default: { limit: 1_000, window_seconds: 60 },
};
const settings: SettingsReader = { read: async (key, schema) => schema.parse(SETTINGS[key]) };
const log = createLogger({ level: 'fatal' });

/** The storage port's stand-in: every signed link it was asked for, by key. */
const linked: string[] = [];
const storage = {
  put: async () => undefined,
  remove: async () => undefined,
  temporaryLink: async (key: string, seconds: number) => {
    linked.push(key);
    return `https://files.invalid/${key}?expires=${String(seconds)}`;
  },
};

const rateLimiter = new RateLimiter({
  settings,
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 1),
});

let database: Database;
let signatures: TeacherSignatureService;
const accounts: string[] = [];

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  signatures = createTeacherSignatureService({ database, storage, settings, log });
});

afterAll(async () => {
  await database.teacherSignature.deleteMany({ where: { teacherUserId: { in: accounts } } });
  await database.user.updateMany({
    where: { id: { in: accounts }, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  await closeDatabase(database);
});

/** An account of `gender`, written as `confirmation-world.ts` writes one. */
async function account(gender: Direction['requester']): Promise<string> {
  const { id } = await database.user.create({
    data: {
      email: `probe-${randomUUID()}@example.invalid`,
      gender,
      dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      displayName: 'Signature probe',
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: 'active',
    },
    select: { id: true },
  });
  accounts.push(id);
  return id;
}

/** The signature row a teacher holds after the upload. */
function rowOf(teacherUserId: string) {
  return database.teacherSignature.findUniqueOrThrow({
    where: { teacherUserId },
    select: { id: true, storageKey: true },
  });
}

/**
 * The direction's world: the caller's teacher (`own`) and the other gender's (`theirs`), each with
 * a signature uploaded through the real service; a teacher of the caller's gender holding none
 * (`bare`); a student of the caller's gender.
 */
async function worldFor(direction: Direction) {
  const [own, theirs, bare, student] = await Promise.all([
    account(direction.requester),
    account(direction.other),
    account(direction.requester),
    account(direction.requester),
  ]);
  await Promise.all([signatures.replace(own, PNG), signatures.replace(theirs, PNG)]);
  const [ownRow, theirRow] = await Promise.all([rowOf(own), rowOf(theirs)]);
  return { own, theirs, bare, student, ownRow, theirRow };
}

const callerFor = createAppCallerFactory(
  createAppRouter({ teacher: createAppRouter({ signature: teacherSignatureRouter }) }),
);

type Standing = 'teacher' | 'student' | 'anonymous';

/** The router as `userId` reaches it, with the session the resolver would answer. */
function callerAs(userId: string, gender: Direction['requester'], standing: Standing = 'teacher') {
  const base = {
    userId,
    sessionId: randomUUID(),
    gender,
    preferredLanguage: 'ar' as const,
    accountStatus: 'active' as const,
  };
  const session: UserSession | null =
    standing === 'anonymous'
      ? null
      : standing === 'student'
        ? { ...base, role: 'student' }
        : {
            ...base,
            role: 'teacher',
            teacher: {
              verificationStatus: 'approved',
              payoutVerified: false,
              applicationStatus: 'approved',
            },
          };
  return callerFor(
    createAppContext({
      session,
      log,
      rateLimiter,
      clientAddress: '203.0.113.25',
      services: {
        settings,
        publicConfig: { supportEmail: 'support@ijazah.invalid' },
        subjects: { listActive: async () => [] },
        identity: unusedIdentityServices,
        verification: unusedVerificationServices,
        // Only `teacher.signature.get` is mounted, so only the signature service is reached.
        catalog: { ...unusedCatalogServices, signature: signatures },
        teacherProfile: unusedTeacherProfileServices,
        discovery: unusedDiscoveryServices,
        booking: unusedBookingServices,
        checkout: unusedCheckoutServices,
        sessions: unusedSessionsServices,
        chat: unusedChatServices,
        certification: unusedCertificationServices,
        moderation: unusedModerationServices,
      },
    }),
  );
}

type Caller = ReturnType<typeof callerAs>;

/** `teacher.signature.get` called with `input`, as a client may send one. */
const getWith = (caller: Caller, input: object) => () =>
  caller.teacher.signature.get(input as never);

/** What the client receives for a refused call: the one formatter's status and body. */
async function refusalOf(call: () => Promise<unknown>): Promise<MappedError> {
  try {
    await call();
  } catch (error) {
    return error instanceof Error && error.name === 'TRPCError'
      ? toErrorShape(error as Parameters<typeof toErrorShape>[0])
      : mapError(error);
  }
  throw new Error('answered where it must be refused');
}

/**
 * Each input field naming `id` is refused exactly as the same field naming an id that never
 * existed: the same status and body, and nothing in it names the id (R-GENDER-2).
 */
async function expectRefusedAlike(caller: Caller, id: string, extra: object = {}): Promise<void> {
  for (const field of ['teacherUserId', 'userId', 'signatureId']) {
    const named = await refusalOf(getWith(caller, { [field]: id, ...extra }));
    const absent = await refusalOf(getWith(caller, { [field]: randomUUID(), ...extra }));
    expect(named.status, `${field}: refused by the schema, never answered`).toBe(400);
    expect(named.body.code).toBe('VALIDATION_FAILED');
    expect(
      { status: named.status, body: named.body },
      `${field}: answered exactly as an id that never existed`,
    ).toStrictEqual({ status: absent.status, body: absent.body });
    expect(JSON.stringify(named.body)).not.toContain(id);
  }
}

/** The caller's own signature: its file's signed link, never the other teacher's. */
async function expectOwnServed(
  caller: Caller,
  ownKey: string,
  otherKey: string,
  otherId: string,
): Promise<void> {
  const answer = await caller.teacher.signature.get();
  expect(answer.link).toBe(`https://files.invalid/${ownKey}?expires=300`);
  expect(answer.uploadedAt).toEqual(expect.any(String));
  const text = JSON.stringify(answer);
  for (const leak of [otherKey, otherId]) expect(text).not.toContain(leak);
}

describe(
  `the attacks on teacher.signature.get (${HOLDS})`,
  { tags: ['database'], timeout: ATTACK_TIMEOUT_MS },
  () => {
    for (const direction of directions) {
      it(`directCall: ${direction.name}`, async () => {
        const world = await worldFor(direction);
        const { own, theirs, ownRow, theirRow } = world;
        await expectOwnServed(
          callerAs(own, direction.requester),
          ownRow.storageKey,
          theirRow.storageKey,
          theirs,
        );
        await expectOwnServed(
          callerAs(theirs, direction.other),
          theirRow.storageKey,
          ownRow.storageKey,
          own,
        );
        const asked = linked.length;
        const refusal = await refusalOf(() =>
          callerAs(world.student, direction.requester, 'student').teacher.signature.get(),
        );
        expect(refusal.status).toBe(403);
        expect(refusal.body.code).toBe('FORBIDDEN');
        expect(linked.length, 'no link asked for a student').toBe(asked);
      });

      it(`forgedId: ${direction.name}`, async () => {
        const { own, theirs, student, ownRow, theirRow } = await worldFor(direction);
        const caller = callerAs(own, direction.requester);
        for (const forged of [theirs, theirRow.id, student]) {
          await expectRefusedAlike(caller, forged);
        }
        await expectOwnServed(caller, ownRow.storageKey, theirRow.storageKey, theirs);
      });

      it(`guessedId: ${direction.name}`, async () => {
        const { theirs, bare, theirRow } = await worldFor(direction);
        const caller = callerAs(bare, direction.requester);
        expect(await caller.teacher.signature.get()).toEqual({ link: null, uploadedAt: null });
        for (const guessed of [randomUUID(), neighbourOf(theirs), theirs.toUpperCase()]) {
          await expectRefusedAlike(caller, guessed);
        }
        expect(linked, 'the other teacher’s file never linked for the caller').not.toContain(
          theirRow.storageKey,
        );
      });

      it(`tamperedToken: ${direction.name}`, async () => {
        const { own } = await worldFor(direction);
        const asked = linked.length;
        for (const call of [
          () => callerAs(own, direction.requester, 'anonymous').teacher.signature.get(),
          getWith(callerAs(own, direction.requester, 'anonymous'), { teacherUserId: own }),
        ]) {
          const refusal = await refusalOf(call);
          expect(refusal.status).toBe(401);
          expect(refusal.body.code).toBe('UNAUTHENTICATED');
        }
        expect(linked.length, 'nothing read before the session').toBe(asked);
      });

      it(`clientSuppliedGender: ${direction.name}`, async () => {
        const { own, theirs, ownRow, theirRow } = await worldFor(direction);
        const caller = callerAs(own, direction.requester);
        const asOther = await refusalOf(getWith(caller, { gender: direction.other }));
        const asOwn = await refusalOf(getWith(caller, { gender: direction.requester }));
        expect(asOther.status).toBe(400);
        expect(asOther.body.code).toBe('VALIDATION_FAILED');
        expect({ status: asOther.status, body: asOther.body }).toStrictEqual({
          status: asOwn.status,
          body: asOwn.body,
        });
        await expectRefusedAlike(caller, theirs, { gender: direction.other });
        await expectOwnServed(caller, ownRow.storageKey, theirRow.storageKey, theirs);
      });
    }
  },
);
