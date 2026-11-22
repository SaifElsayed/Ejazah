// T018 — the teacher's packages over the real tables and locks (FR-311, FR-312, FR-314, R-218,
// PR #109's review M3; T005's rules).
//
// The service is the catalog module's, over its real store and booking's real answers to the
// `CatalogUse` port, as `main.ts` binds them. What is probed: a package is written only on one of
// the teacher's `teacher_subjects`, with at most 52 sessions (the owner's decision of 2026-11-02,
// refused by the contract through the surface before anything is written); another teacher's package id answers NOT_FOUND and leaves the
// row exactly as it was; an enrollment freezes the track and the length but not the price, which the
// enrollment's snapshot keeps for itself; and two races, each staged as `account-locks.spec.ts`
// stages its own (A holds, B is seen waiting on a lock in `pg_stat_activity`, A commits):
//
//   - an edit of the length against the package's first enrollment, inserted under the teacher's
//     account lock as T033's hold will insert it (T033's note): the edit locks the same account
//     first, so it reads the enrollment A committed and answers PACKAGE_FROZEN;
//   - a new package against a revocation of the teacher's approval, which takes no lock of its own
//     and moves the application's row before it removes the subjects: the create locks the
//     application's row after the account's, so it reads the subjects A removed and answers
//     SUBJECT_NOT_APPROVED.
//
// The rows are committed, as in `account-locks.spec.ts`: each probe writes people of its own and
// leaves them as the other probes here leave theirs.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { piasters } from '../../packages/money/src/index.js';

import { createCatalogUse } from '../../apps/api/src/modules/booking/index.js';
import {
  lockProgrammeSwitch,
  PackagesService,
  packagesRouter,
  packagesStore,
  PROGRAMME_ENABLED_SETTING,
  retirePreProgrammeIjazahPackages,
  revokeSubjects,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  createTeacherProfileService,
  lockAccount,
  teacherProfileRouter,
} from '../../apps/api/src/modules/identity/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository.js';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service.js';
import type { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import type { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader.js';
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
  unusedModerationServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../apps/api/src/surfaces/services.fixtures.js';
import {
  connectAsApplication,
  type Db,
  insertRow,
  makeAdmin,
  makeSubject,
  makeUser,
} from './harness';

let db: Db;
let watcher: Db;
let database: Database;
let idempotency: IdempotencyService<Transaction>;

/** Booking's port as `main.ts` binds it (T026), the release buffer at its default of 0 weeks. */
const use = createCatalogUse({ settings: { read: async (_key, schema) => schema.parse(0) } });

/**
 * 006:T004 (rule d): the programme's switch off, as seeded, which an edit to the ijazah track reads;
 * any other setting is refused, as before.
 */
const switchOffAsSeeded: SettingsReader = {
  read: async (key, schema) =>
    key === 'programme_enabled'
      ? schema.parse(0)
      : Promise.reject(new Error('no setting in this probe')),
};

beforeAll(async () => {
  [db, watcher] = await Promise.all([connectAsApplication(), connectAsApplication()]);
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  idempotency = new IdempotencyService({
    store: new IdempotencyRepository(database),
    settings: { read: async (_key, schema) => schema.parse(24) },
  });
});

afterAll(async () => {
  await Promise.all([db?.end(), watcher?.end()]);
  await closeDatabase(database);
});

/** The service as `main.ts` builds it, each call in its own transaction. */
function service(): PackagesService {
  return new PackagesService({
    transactions: { run: (work) => database.$transaction(work) },
    store: packagesStore,
    use,
    idempotency,
    // 003:T113 (rule d): the probes never ask the average; 006:T004 (rule d): the switch off.
    settings: switchOffAsSeeded,
  });
}

/** The service run on `tx`, keyed by nothing: for a race's B, whose backend the watcher names. */
function serviceOn(tx: Transaction): PackagesService {
  return new PackagesService({
    transactions: { run: (work) => work(tx) },
    store: packagesStore,
    use,
    idempotency: { run: (_request, effect) => effect(tx) },
    settings: switchOffAsSeeded,
  });
}

const callerFor = createAppCallerFactory(
  createAppRouter({ teacher: createAppRouter({ packages: packagesRouter }) }),
);

/** The namespace as an approved teacher's session calls it, over the real service. */
function surfaceCaller(teacherId: string) {
  const catalog = new Proxy(unusedCatalogServices, {
    get: (target, name) => (name === 'packages' ? service() : Reflect.get(target, name)),
  });
  return callerFor(
    createAppContext({
      session: {
        userId: teacherId,
        sessionId: '0199d0a0-0000-7000-8000-0000000000f9',
        gender: 'female',
        preferredLanguage: 'ar',
        role: 'teacher',
        accountStatus: 'active',
        teacher: {
          verificationStatus: 'approved',
          payoutVerified: false,
          applicationStatus: 'approved',
        },
      },
      log: createLogger({ level: 'info', destination: { write: () => undefined } }),
      rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
      clientAddress: '203.0.113.9',
      services: {
        settings: { read: async () => Promise.reject(new Error('no setting in this probe')) },
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
        catalog,
      },
    }),
  );
}

const publishedCallerFor = createAppCallerFactory(
  createAppRouter({
    teacher: createAppRouter({ profile: teacherProfileRouter, packages: packagesRouter }),
  }),
);

/**
 * `teacher.profile` and `teacher.packages` over their real services, called with the session an
 * active, approved teacher with a verified payout account had when it was read: a suspension that
 * commits after the session was read reaches the services, not the caller kind.
 */
function publishedCaller(teacherId: string, gender: 'male' | 'female') {
  return publishedCallerFor(
    createAppContext({
      session: {
        userId: teacherId,
        sessionId: '0199d0a0-0000-7000-8000-0000000000fa',
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
        settings: { read: async () => Promise.reject(new Error('no setting in this probe')) },
        publicConfig: { supportEmail: 'support@ijazah.invalid' },
        subjects: { listActive: async () => [] },
        identity: unusedIdentityServices,
        verification: unusedVerificationServices,
        teacherProfile: createTeacherProfileService({
          database,
          settings: { read: async () => Promise.reject(new Error('no photo in this probe')) },
          storage: { temporaryLink: async () => Promise.reject(new Error('no photo')) },
        }),
        catalog: new Proxy(unusedCatalogServices, {
          get: (target, name) => (name === 'packages' ? service() : Reflect.get(target, name)),
        }),
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

/**
 * A committed approved teacher holding `subjectId` by an approved credential's grant; `values` adds
 * columns of the account and of the profile.
 */
async function approvedTeacher(
  subjectId: string,
  gender: 'male' | 'female',
  values: {
    readonly user?: Readonly<Record<string, unknown>>;
    readonly profile?: Readonly<Record<string, unknown>>;
  } = {},
): Promise<string> {
  const userId = await makeUser(db, { gender, ...values.user });
  const documentId = await insertRow(db, 'verification_documents', {
    user_id: userId,
    document_type: 'national_id',
    storage_key_encrypted: Buffer.from('probe'),
  });
  await insertRow(db, 'teacher_profiles', {
    user_id: userId,
    bio: '',
    qualification_summary: 'إجازة في حفص',
    verification_status: 'approved',
    application_status: 'approved',
    application_submitted_at: '2026-10-18T09:00:00Z',
    identity_document_id: documentId,
    identity_document_type: 'national_id',
    ...values.profile,
  });
  await insertRow(db, 'teacher_subjects', { teacher_user_id: userId, subject_id: subjectId });
  return userId;
}

let sequence = 0;
/** A fresh idempotency key. */
function key(): string {
  sequence += 1;
  return `probe-packages-${String(Date.now())}-${String(sequence)}`;
}

function creation(subjectId: string) {
  return {
    subjectId,
    track: 'recitation' as const,
    sessionCount: 4,
    sessionDurationMinutes: 60 as const,
    price_piasters: 100_000,
    isActive: true,
    idempotencyKey: key(),
  };
}

/** The package's row as stored, every column. */
async function rowOf(packageId: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM packages WHERE id = $1', [
    packageId,
  ]);
  return rows[0];
}

async function packagesOfTeacher(teacherId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM packages WHERE teacher_user_id = $1',
    [teacherId],
  );
  return Number(rows[0]?.count ?? '0');
}

/** A committed weekly slot of the teacher. */
function slotOf(teacherId: string): Promise<string> {
  return insertRow(db, 'availability_slots', {
    teacher_user_id: teacherId,
    day_of_week: 0,
    start_time_local: '09:00:00',
    duration_minutes: 60,
    timezone: 'Africa/Cairo',
    is_active: true,
  });
}

/** The columns of one enrollment on the package by a fresh student, in `status`. */
async function enrollmentData(
  on: { teacherId: string; subjectId: string; packageId: string; slotId: string },
  status: 'pending_payment' | 'confirmed',
) {
  const studentId = await makeUser(db);
  return {
    studentUserId: studentId,
    teacherUserId: on.teacherId,
    packageId: on.packageId,
    slotId: on.slotId,
    snapshotPricePiasters: 100_000n,
    snapshotSessionCount: 4,
    snapshotDurationMinutes: 60,
    snapshotSubjectId: on.subjectId,
    snapshotSlotTimezone: 'Africa/Cairo',
    status,
    ...(status === 'confirmed' ? { confirmedAt: new Date('2026-10-04T07:01:00Z') } : {}),
    purchasedAt: new Date('2026-10-04T07:00:00Z'),
    quotedFirstSessionLocalDate: new Date('2026-10-11T00:00:00Z'),
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw thrown;
  return thrown.code;
}

/** Resolves once backend `pid` waits on a lock; fails after about two seconds. */
async function seenWaiting(pid: number): Promise<void> {
  for (let look = 0; look < 100; look += 1) {
    const { rows } = await watcher.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${String(pid)} never waited on a lock`);
}

const OPTIONS = { maxWait: 5_000, timeout: 15_000 };

/**
 * A runs `first` and stays open; B runs `second` and is seen waiting; A commits. Answers how B
 * ended: its value, or what it threw.
 */
async function race<T>(
  first: (tx: Transaction) => Promise<unknown>,
  second: (tx: Transaction) => Promise<T>,
): Promise<{ readonly value: T } | { readonly thrown: unknown }> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ran = (): void => undefined;
  const firstRan = new Promise<void>((resolve) => {
    ran = resolve;
  });
  const a = database.$transaction(async (tx) => {
    await first(tx);
    ran();
    await released;
  }, OPTIONS);
  await Promise.race([firstRan, a]);
  let pidOfB = (_pid: number): void => undefined;
  const bStarted = new Promise<number>((resolve) => {
    pidOfB = resolve;
  });
  const b = database
    .$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      pidOfB(row?.pid ?? 0);
      return second(tx);
    }, OPTIONS)
    .then(
      (value) => ({ value }),
      (thrown: unknown) => ({ thrown }),
    );
  try {
    await seenWaiting(await bStarted);
  } finally {
    release();
    await a;
  }
  return b;
}

function refusalOf(outcome: { readonly value: unknown } | { readonly thrown: unknown }): string {
  if (!('thrown' in outcome)) return 'no refusal';
  return outcome.thrown instanceof DomainError ? outcome.thrown.code : String(outcome.thrown);
}

describe('create and list (T018, FR-311)', () => {
  it('writes a package on one of the teacher’s subjects, keyed, and lists it with its price per session', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');
    const input = creation(subjectId);
    const created = await service().create(teacherId, input);
    // A retry with the same key answers the first outcome and writes no second row.
    await expect(service().create(teacherId, input)).resolves.toEqual(created);
    expect(await packagesOfTeacher(teacherId)).toBe(1);
    expect(await rowOf(created.id)).toMatchObject({
      teacher_user_id: teacherId,
      subject_id: subjectId,
      track: 'recitation',
      session_count: 4,
      session_duration_minutes: 60,
      price_piasters: '100000',
      is_active: true,
    });
    await expect(service().list(teacherId, 'female' as RequesterGender)).resolves.toEqual({
      published: false,
      packages: [
        {
          ...created,
          perSession_piasters: 25_000,
          activeEnrollmentCount: 0,
          frozen: false,
        },
      ],
    });
  });

  it('refuses a create of 53 sessions through the surface VALIDATION_FAILED and writes nothing (the owner’s decision of 2026-11-02)', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');
    const caller = surfaceCaller(teacherId);
    const thrown: unknown = await caller.teacher.packages
      .create({ ...creation(subjectId), sessionCount: 53 })
      .catch((error: unknown) => error);
    expect(toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body.code).toBe(
      'VALIDATION_FAILED',
    );
    expect(await packagesOfTeacher(teacherId)).toBe(0);
    // The same call with 52 is written: the refusal was the count's.
    await expect(
      caller.teacher.packages.create({ ...creation(subjectId), sessionCount: 52 }),
    ).resolves.toMatchObject({ sessionCount: 52 });
    expect(await packagesOfTeacher(teacherId)).toBe(1);
  });

  it('refuses a subject that is not one of the teacher’s SUBJECT_NOT_APPROVED and writes nothing', async () => {
    const held = await makeSubject(db);
    const notHeld = await makeSubject(db);
    const teacherId = await approvedTeacher(held, 'male');
    // Another teacher's subject is not this teacher's.
    await approvedTeacher(notHeld, 'male');
    expect(await codeOf(service().create(teacherId, creation(notHeld)))).toBe(
      'SUBJECT_NOT_APPROVED',
    );
    expect(await packagesOfTeacher(teacherId)).toBe(0);
  });
});

describe('published, the visibility predicate’s answer (the owner’s decision of 2026-11-02)', () => {
  const VERIFIED = {
    payout_configured_at: '2026-10-20T09:00:00Z',
    payout_verified_at: '2026-10-21T09:00:00Z',
  };

  it('an active, approved teacher with a verified payout account is published in the profile and in the packages', async () => {
    for (const gender of ['female', 'male'] as const) {
      const subjectId = await makeSubject(db);
      const teacherId = await approvedTeacher(subjectId, gender, { profile: VERIFIED });
      const caller = publishedCaller(teacherId, gender);
      await expect(caller.teacher.profile.get()).resolves.toMatchObject({ published: true });
      await expect(caller.teacher.packages.list()).resolves.toMatchObject({ published: true });
    }
  });

  it('a suspended teacher is published in neither, though the payout account is verified', async () => {
    for (const gender of ['female', 'male'] as const) {
      const subjectId = await makeSubject(db);
      const teacherId = await approvedTeacher(subjectId, gender, {
        user: { account_status: 'suspended' },
        profile: VERIFIED,
      });
      const caller = publishedCaller(teacherId, gender);
      await expect(caller.teacher.profile.get()).resolves.toMatchObject({ published: false });
      await expect(caller.teacher.packages.list()).resolves.toMatchObject({ published: false });
    }
  });
});

describe('update (T018, FR-312, FR-314, M3)', () => {
  it('answers another teacher’s package id NOT_FOUND and leaves the row exactly as it was', async () => {
    const subjectId = await makeSubject(db);
    const owner = await approvedTeacher(subjectId, 'female');
    const intruder = await approvedTeacher(subjectId, 'female');
    const { id } = await service().create(owner, creation(subjectId));
    const before = await rowOf(id);
    for (const change of [
      { price_piasters: 1 },
      { isActive: false },
      { track: 'ijazah_track' as const, sessionDurationMinutes: 30 as const, sessionCount: 9 },
    ]) {
      expect(await codeOf(service().update(intruder, { packageId: id, ...change }))).toBe(
        'NOT_FOUND',
      );
    }
    expect(await rowOf(id)).toEqual(before);
  });

  it('freezes the track and the length once enrolled; the price, the count and the state still change, and the enrollment keeps its snapshot', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'male');
    const { id: packageId } = await service().create(teacherId, creation(subjectId));
    const on = { teacherId, subjectId, packageId, slotId: await slotOf(teacherId) };
    const enrolled = await database.enrollment.create({
      data: await enrollmentData(on, 'pending_payment'),
      select: { id: true },
    });
    await database.enrollment.create({ data: await enrollmentData(on, 'confirmed') });

    expect(
      await codeOf(service().update(teacherId, { packageId, sessionDurationMinutes: 30 })),
    ).toBe('PACKAGE_FROZEN');
    expect(await codeOf(service().update(teacherId, { packageId, track: 'ijazah_track' }))).toBe(
      'PACKAGE_FROZEN',
    );
    await expect(
      service().update(teacherId, {
        packageId,
        price_piasters: 140_000,
        sessionCount: 7,
        isActive: false,
      }),
    ).resolves.toMatchObject({
      price_piasters: 140_000,
      perSession_piasters: 20_000,
      sessionCount: 7,
      isActive: false,
      track: 'recitation',
      sessionDurationMinutes: 60,
      activeEnrollmentCount: 1,
      frozen: true,
    });
    const { rows } = await db.query<{ snapshot_price_piasters: string }>(
      'SELECT snapshot_price_piasters FROM enrollments WHERE id = $1',
      [enrolled.id],
    );
    expect(rows[0]?.snapshot_price_piasters).toBe('100000');
  });
});

describe('the locks (T005’s rules)', () => {
  it('an edit of the length waits for the first enrollment inserted under the teacher’s account lock, then answers PACKAGE_FROZEN', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');
    const { id: packageId } = await service().create(teacherId, creation(subjectId));
    const on = { teacherId, subjectId, packageId, slotId: await slotOf(teacherId) };
    const data = await enrollmentData(on, 'pending_payment');
    const before = await rowOf(packageId);

    const outcome = await race(
      async (tx) => {
        await lockAccount(tx, teacherId);
        await tx.enrollment.create({ data });
      },
      (tx) => serviceOn(tx).update(teacherId, { packageId, sessionDurationMinutes: 30 }),
    );

    expect(refusalOf(outcome)).toBe('PACKAGE_FROZEN');
    expect(await rowOf(packageId)).toEqual(before);
  });

  it('a new package waits for a revocation moving the application, then answers SUBJECT_NOT_APPROVED', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'male');

    const outcome = await race(
      async (tx) => {
        await tx.teacherProfile.updateMany({
          where: { userId: teacherId, verificationStatus: 'approved' },
          data: { verificationStatus: 'revoked', applicationStatus: 'rejected' },
        });
        await revokeSubjects(tx, teacherId);
      },
      (tx) => serviceOn(tx).create(teacherId, creation(subjectId)),
    );

    expect(refusalOf(outcome)).toBe('SUBJECT_NOT_APPROVED');
    expect(await packagesOfTeacher(teacherId)).toBe(0);
  });
});

// 006:T002 (SRS DEC-110; the note under T002, Q-3 (a)(a)): the programme's switch over the real
// tables. Its turn-on (`retirePreProgrammeIjazahPackages`, on the setting change's transaction)
// deactivates every active old-style ijazah-track package (`is_programme = false`) and no other: a
// recitation package, a programme package and an inactive one stay as they are; it answers how many
// it changed. Two races, staged as above (A holds, B is seen waiting on a lock, A commits):
//
//   - the turn-on first: it locks the account of every teacher holding an old-style ijazah package,
//     so a reactivation of one waits on the account's lock and then reads the switch on, answering
//     CONFLICT `programme_switch_on`, the package left inactive;
//   - the reactivation first: it read the switch off and wrote the package active under the
//     account's lock; the turn-on waits on that lock, then deactivates it, so no old-style package
//     is active once the switch is on.
//
// The switch's row is planted where none holds it (CI migrates and never seeds), at 0, and put back
// to 0 after each case, deleted at the end if this file planted it. The turn-on deactivates the
// old-style ijazah packages other probes left too, committed as theirs are: the count is checked
// against the active ones counted on the same transaction just before.
describe('the programme’s switch (006:T002, DEC-110)', () => {
  let planter = '';
  let planted = false;

  /** The switch as `teacher.packages.update` reads it: the committed row, on a connection of its own. */
  const committedSwitch: SettingsReader = {
    read: async (key, schema) => {
      const { rows } = await watcher.query<{ value: unknown }>(
        'SELECT value FROM settings WHERE key = $1',
        [key],
      );
      return schema.parse(rows[0]?.value);
    },
  };

  /** The service run on `tx`, reading the switch's committed row. */
  function switchedServiceOn(tx: Transaction): PackagesService {
    return new PackagesService({
      transactions: { run: (work) => work(tx) },
      store: packagesStore,
      use,
      idempotency: { run: (_request, effect) => effect(tx) },
      settings: committedSwitch,
    });
  }

  /**
   * The turn-on on `tx`: 006:T004 (Q-D1 (a)) the switch's key first, as `settings.update` takes it;
   * the row set to 1, as the panel's writer sets it, then the catalog entry.
   */
  async function turnOn(tx: Transaction): Promise<number> {
    await lockProgrammeSwitch(tx);
    await tx.setting.updateMany({ where: { key: PROGRAMME_ENABLED_SETTING }, data: { value: 1 } });
    return retirePreProgrammeIjazahPackages(tx);
  }

  async function switchOff(): Promise<void> {
    await db.query(`UPDATE settings SET value = '0'::jsonb WHERE key = $1`, [
      PROGRAMME_ENABLED_SETTING,
    ]);
  }

  beforeAll(async () => {
    planter = await makeAdmin(db);
    const { rowCount } = await db.query(
      `INSERT INTO settings (key, value, updated_by_admin_id, updated_at) VALUES ($1, '0'::jsonb, $2, now())
       ON CONFLICT (key) DO NOTHING`,
      [PROGRAMME_ENABLED_SETTING, planter],
    );
    planted = rowCount === 1;
  });

  afterEach(switchOff);

  afterAll(async () => {
    if (planted) {
      await db.query('DELETE FROM settings WHERE key = $1 AND updated_by_admin_id = $2', [
        PROGRAMME_ENABLED_SETTING,
        planter,
      ]);
    }
  });

  /** A committed package of the teacher on the subject: old-style unless `programme`. */
  function packageRow(
    teacherId: string,
    subjectId: string,
    values: { readonly track: 'recitation' | 'ijazah_track'; readonly isActive: boolean },
    programme = false,
  ): Promise<string> {
    return insertRow(db, 'packages', {
      teacher_user_id: teacherId,
      subject_id: subjectId,
      track: values.track,
      is_active: values.isActive,
      is_programme: programme,
      ...(programme
        ? { price_30_piasters: 10_000, price_45_piasters: 15_000, price_60_piasters: 20_000 }
        : { session_count: 8, session_duration_minutes: 60, price_piasters: 240_000 }),
    });
  }

  async function activeOf(packageId: string): Promise<boolean | undefined> {
    return (await rowOf(packageId))?.['is_active'] as boolean | undefined;
  }

  it('deactivates every active old-style ijazah package and no other, answering how many', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');
    const otherId = await approvedTeacher(subjectId, 'male');
    const old = await packageRow(teacherId, subjectId, { track: 'ijazah_track', isActive: true });
    const otherOld = await packageRow(otherId, subjectId, {
      track: 'ijazah_track',
      isActive: true,
    });
    const inactiveOld = await packageRow(teacherId, subjectId, {
      track: 'ijazah_track',
      isActive: false,
    });
    const recitation = await packageRow(teacherId, subjectId, {
      track: 'recitation',
      isActive: true,
    });
    const programme = await packageRow(
      teacherId,
      subjectId,
      { track: 'ijazah_track', isActive: true },
      true,
    );
    const { before, count } = await database.$transaction(async (tx) => {
      const counted = await tx.package.count({
        where: { track: 'ijazah_track', isProgramme: false, isActive: true },
      });
      return { before: counted, count: await turnOn(tx) };
    }, OPTIONS);
    expect(before).toBeGreaterThanOrEqual(2);
    expect(count).toBe(before);
    expect(await activeOf(old)).toBe(false);
    expect(await activeOf(otherOld)).toBe(false);
    expect(await activeOf(inactiveOld)).toBe(false);
    expect(await activeOf(recitation)).toBe(true);
    expect(await activeOf(programme)).toBe(true);
  });

  it('turned off, reactivates none', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');
    const old = await packageRow(teacherId, subjectId, { track: 'ijazah_track', isActive: true });
    await database.$transaction(turnOn, OPTIONS);
    await switchOff();
    expect(await activeOf(old)).toBe(false);
  });

  it('a reactivation against the turn-on waits on the account’s lock, then answers programme_switch_on', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');
    const packageId = await packageRow(teacherId, subjectId, {
      track: 'ijazah_track',
      isActive: false,
    });

    const outcome = await race(turnOn, (tx) =>
      switchedServiceOn(tx).update(teacherId, { packageId, isActive: true }),
    );

    expect('thrown' in outcome && outcome.thrown).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'isActive', code: 'programme_switch_on' }],
    });
    expect(await activeOf(packageId)).toBe(false);
  });

  it('the turn-on against a reactivation that read the switch off waits on the account’s lock, then deactivates it', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'male');
    const packageId = await packageRow(teacherId, subjectId, {
      track: 'ijazah_track',
      isActive: false,
    });

    const outcome = await race(
      (tx) => switchedServiceOn(tx).update(teacherId, { packageId, isActive: true }),
      turnOn,
    );

    expect('value' in outcome && outcome.value).toBeGreaterThanOrEqual(1);
    expect(await activeOf(packageId)).toBe(false);
  });

  // 006:T004 (SRS DEC-110; Q-D1 (a), the owner's «موافق على الاتنين (أ)», 2026-11-22): a new
  // old-style ijazah-track package against the turn-on, by a teacher holding none, whose account
  // the turn-on never locks. Both take the switch's advisory key before reading or writing it.
  function oldStyleCreation(subjectId: string) {
    return { ...creation(subjectId), track: 'ijazah_track' as const };
  }

  async function packagesOfTeacherRows(teacherId: string) {
    const { rows } = await db.query<{ is_active: boolean }>(
      'SELECT is_active FROM packages WHERE teacher_user_id = $1',
      [teacherId],
    );
    return rows;
  }

  it('a create of an old-style ijazah package against the turn-on waits on the switch’s key, then answers programme_switch_on', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');

    const outcome = await race(turnOn, (tx) =>
      switchedServiceOn(tx).create(teacherId, oldStyleCreation(subjectId)),
    );

    expect('thrown' in outcome && outcome.thrown).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'track', code: 'programme_switch_on' }],
    });
    expect(await packagesOfTeacherRows(teacherId)).toEqual([]);
  });

  // 006:T004 (the owner's «موافق على التلاتة (أ)», 2026-11-22): the edit that turns a recitation
  // package of a teacher holding no old-style one to the ijazah track takes the key too.
  async function recitationOf(teacherId: string, subjectId: string): Promise<string> {
    return insertRow(db, 'packages', {
      teacher_user_id: teacherId,
      subject_id: subjectId,
      track: 'recitation',
      is_active: true,
      session_count: 8,
      session_duration_minutes: 60,
      price_piasters: 240_000,
    });
  }

  it('a turn of a recitation package to the ijazah track against the turn-on waits on the switch’s key, then answers programme_switch_on', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');
    const packageId = await recitationOf(teacherId, subjectId);

    const outcome = await race(turnOn, (tx) =>
      switchedServiceOn(tx).update(teacherId, { packageId, track: 'ijazah_track' }),
    );

    expect('thrown' in outcome && outcome.thrown).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'track', code: 'programme_switch_on' }],
    });
    expect((await rowOf(packageId))?.['track']).toBe('recitation');
  });

  it('the turn-on against a turn to the ijazah track that read the switch off waits on the switch’s key, then deactivates it', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'male');
    const packageId = await recitationOf(teacherId, subjectId);

    const outcome = await race(
      (tx) => switchedServiceOn(tx).update(teacherId, { packageId, track: 'ijazah_track' }),
      turnOn,
    );

    expect('value' in outcome && outcome.value).toBeGreaterThanOrEqual(1);
    expect(await rowOf(packageId)).toMatchObject({ track: 'ijazah_track', is_active: false });
  });

  it('the turn-on against a create that read the switch off waits on the switch’s key, then deactivates it', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'male');

    const outcome = await race(
      (tx) => switchedServiceOn(tx).create(teacherId, oldStyleCreation(subjectId)),
      turnOn,
    );

    expect('value' in outcome && outcome.value).toBeGreaterThanOrEqual(1);
    expect(await packagesOfTeacherRows(teacherId)).toEqual([{ is_active: false }]);
  });
});

// 006:T004 (R-503; ERD section 15 rules 73 and 74; the owner's «موافق على التلاتة (أ)»,
// 2026-11-22): a programme package's row as catalog's store writes it, over the real check. The
// insert writes `is_programme`, the three prices and the old three NULL; a recitation package
// turned into a programme one keeps one shape, its old three NULL, and its prices change in place.
describe('a programme package’s row against rule 73 (006:T004)', () => {
  const PRICES = {
    m30_piasters: piasters(20_000),
    m45_piasters: piasters(28_000),
    m60_piasters: piasters(35_000),
  };
  const PROGRAMME_COLUMNS = {
    is_programme: true,
    track: 'ijazah_track',
    session_count: null,
    session_duration_minutes: null,
    price_piasters: null,
  };

  it('inserts a programme package with its three prices and the old three NULL', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'female');
    const written = await database.$transaction(
      (tx) =>
        packagesStore.insert(tx, {
          teacherUserId: teacherId,
          subjectId,
          track: 'ijazah_track',
          isProgramme: true,
          prices: PRICES,
          isActive: true,
        }),
      OPTIONS,
    );
    expect(written).toMatchObject({ isProgramme: true, prices: PRICES, isActive: true });
    expect(await rowOf(written.id)).toMatchObject({
      ...PROGRAMME_COLUMNS,
      price_30_piasters: '20000',
      price_45_piasters: '28000',
      price_60_piasters: '35000',
    });
  });

  it('turns a recitation package into a programme one, then changes its prices', async () => {
    const subjectId = await makeSubject(db);
    const teacherId = await approvedTeacher(subjectId, 'male');
    const packageId = await insertRow(db, 'packages', {
      teacher_user_id: teacherId,
      subject_id: subjectId,
      track: 'recitation',
      is_active: true,
      session_count: 8,
      session_duration_minutes: 60,
      price_piasters: 240_000,
    });
    await database.$transaction(
      (tx) =>
        packagesStore.change(tx, teacherId, packageId, {
          track: 'ijazah_track',
          isProgramme: true,
          prices: PRICES,
        }),
      OPTIONS,
    );
    expect(await rowOf(packageId)).toMatchObject({
      ...PROGRAMME_COLUMNS,
      price_30_piasters: '20000',
      price_45_piasters: '28000',
      price_60_piasters: '35000',
    });
    await database.$transaction(
      (tx) =>
        packagesStore.change(tx, teacherId, packageId, {
          prices: { ...PRICES, m45_piasters: piasters(30_000) },
        }),
      OPTIONS,
    );
    expect(await rowOf(packageId)).toMatchObject({
      ...PROGRAMME_COLUMNS,
      price_45_piasters: '30000',
    });
  });
});
