// T004 of specs/005-certification/tasks.md (B45, lane D) — the certificate name over the real tables
// as the application role (FR-602; ADR 0019 D1 and its note of 2026-11-17, DEC-72; research R-411):
//
// - An administrator's change of a student's certificate name changes `users.certificate_name` and
//   never rewrites an issued certificate: a signed-off ijazah's `student_name_printed` stays the name
//   it printed (the certificate verifies with its own snapshot).
// - The student's own name, set once on the real tables: a second set is refused `CONFLICT`
//   `already_set` and the first name stays.
// - Either path hands the student to `AwaitingNameRelease` on its own transaction (a recording port
//   here, the no-op `main.ts` binds until T006).
//
// The service is identity's factory over the real repository and the kernel's idempotency (`run` for
// the student's own, `runOn` on an administrator's transaction, as the administrator kind runs it).
// Each world is committed with accounts of its own: the service runs its own transactions.
//
// Observed red: the first case against the mutant M5 of `certificate-name.repository.ts`, whose write
// also sets the student's ijazahs' `student_name_printed`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CertificateNames,
  createCertificateNameService,
} from '../../apps/api/src/modules/identity/index';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures';
import { IdempotencyRepository } from '../../apps/api/src/platform/idempotency/idempotency.repository';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import {
  SettingError,
  type SettingsReader,
} from '../../apps/api/src/platform/settings/settings-reader';
import { connectAsApplication, type Db, insertRow, makeAdmin, makeEnrollment } from './harness';

const FIRST_NAME = 'مريم بنت أحمد بن علي';
const CORRECTED_NAME = 'مريم بنت أحمد بن علي الحسني';

const SETTINGS: Readonly<Record<string, unknown>> = { idempotency_key_ttl_hours: 24 };

const settings: SettingsReader = {
  async read(key, schema) {
    if (!Object.hasOwn(SETTINGS, key)) throw new SettingError(key, 'missing');
    const parsed = schema.safeParse(SETTINGS[key]);
    if (!parsed.success) throw new SettingError(key, 'invalid');
    return parsed.data;
  },
};

let db: Db;
let database: Database;
let names: CertificateNames;
const released: { readonly tx: Transaction; readonly studentUserId: string }[] = [];

beforeAll(async () => {
  db = await connectAsApplication();
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 4,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
  names = createCertificateNameService({
    idempotency: new IdempotencyService<Transaction>({
      store: new IdempotencyRepository(database),
      settings,
    }),
    log: { info: () => undefined },
    awaitingNameRelease: {
      release: async (tx, studentUserId) => {
        released.push({ tx, studentUserId });
      },
    },
  });
});

afterAll(async () => {
  await db?.end();
  if (database !== undefined) await closeDatabase(database);
});

/** A committed enrollment whose student holds the student role. */
async function studentWorld(): Promise<{
  readonly enrollmentId: string;
  readonly studentId: string;
  readonly teacherId: string;
}> {
  const world = await makeEnrollment(db);
  await insertRow(db, 'user_roles', {
    user_id: world.studentId,
    role: 'student',
    status: 'active',
  });
  return world;
}

/** The account's certificate name, read as the application role. */
async function certificateNameOf(userId: string): Promise<string | null> {
  const { rows } = await db.query<{ name: string | null }>(
    `SELECT certificate_name AS name FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.name ?? null;
}

/** The ijazah's printed student name. */
async function printedNameOf(ijazahId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT student_name_printed AS name FROM ijazahs WHERE id = $1`,
    [ijazahId],
  );
  return rows[0]?.name;
}

/** A signed-off ijazah of the enrollment, printing `studentName` (DEC-72: issued from its sign-off). */
async function issuedIjazah(
  world: Awaited<ReturnType<typeof studentWorld>>,
  studentName: string,
  adminId: string,
): Promise<string> {
  const { rows } = await db.query<{ subject: string }>(
    `SELECT snapshot_subject_id AS subject FROM enrollments WHERE id = $1`,
    [world.enrollmentId],
  );
  const subject = rows[0]?.subject;
  if (subject === undefined) throw new Error('no enrollment');
  return insertRow(db, 'ijazahs', {
    certificate_number: `probe-${randomUUID()}`,
    enrollment_id: world.enrollmentId,
    student_user_id: world.studentId,
    teacher_user_id: world.teacherId,
    subject_id: subject,
    mode: 'generated',
    language: 'ar',
    certificate_storage_key: `ijazahs/${randomUUID()}.pdf`,
    paper_copy_intended: false,
    verification_token_hash: randomUUID(),
    granted_at: '2026-11-17T08:00:00Z',
    student_name_printed: studentName,
    teacher_name_printed: 'اسم المعلم',
    // B46 (005:T006, Q5 (c)): the riwaya it prints, NOT NULL.
    riwaya_printed: 'حفص عن عاصم',
    rendered_at: '2026-11-17T08:05:00Z',
    signed_off_at: '2026-11-17T08:10:00Z',
    signed_off_by_admin_id: adminId,
  });
}

/** An administrator's change, on a transaction of its own as the administrator kind runs it. */
async function changeByAdministrator(adminId: string, studentId: string, name: string) {
  return database.$transaction(
    (tx) =>
      names.setByAdministrator(tx, adminId, {
        targetUserId: studentId,
        name,
        reason: 'طلب الطالبة تصحيح الاسم عبر الدعم',
        idempotencyKey: randomUUID(),
      }),
    { timeout: 30_000 },
  );
}

describe('an administrator’s change of the certificate name (ADR 0019 D1)', () => {
  it('changes the account’s name and never rewrites an issued certificate’s printed name', async () => {
    const world = await studentWorld();
    const adminId = await makeAdmin(db);
    await names.setOwn(world.studentId, { name: FIRST_NAME, idempotencyKey: randomUUID() });
    const ijazahId = await issuedIjazah(world, FIRST_NAME, adminId);

    await expect(changeByAdministrator(adminId, world.studentId, CORRECTED_NAME)).resolves.toEqual({
      replayed: false,
    });

    expect(await certificateNameOf(world.studentId)).toBe(CORRECTED_NAME);
    expect(await printedNameOf(ijazahId)).toBe(FIRST_NAME);
    expect(released.filter((each) => each.studentUserId === world.studentId)).toHaveLength(2);
  });
});

describe('the student’s own name, once', () => {
  it('refuses a second set as CONFLICT already_set and keeps the first name', async () => {
    const world = await studentWorld();
    await expect(
      names.setOwn(world.studentId, { name: FIRST_NAME, idempotencyKey: randomUUID() }),
    ).resolves.toEqual({ name: FIRST_NAME });
    const refusal: unknown = await names
      .setOwn(world.studentId, { name: CORRECTED_NAME, idempotencyKey: randomUUID() })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal).toMatchObject({
      code: 'CONFLICT',
      details: [{ path: 'certificateName', code: 'already_set' }],
    });
    expect(await certificateNameOf(world.studentId)).toBe(FIRST_NAME);
  });
});
