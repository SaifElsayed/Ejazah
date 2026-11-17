// T009 of specs/005-certification (FR-607, FR-609; research R-412; the note under T009, Q9 (a);
// FR-IJAZAH-4, R-HONEST-6) — the parties' reads and the student's public credentials over the real
// `ijazahs` table as the application role:
//
// - `certificatesOfParty` answers the ijazahs whose student or teacher is the caller, newest first,
//   a soft-deleted one left out, another pair's never;
// - `certificateById` answers one ijazah by its id, a soft-deleted one and an unknown id null;
// - `publicCredentialsOf` answers the student's ijazahs that are signed off and unrevoked only, a
//   soft-deleted one left out; no v1.0 surface reads it (the public page is T028, v1.1).
//
// Every world is written and read on one transaction that is rolled back, so the spec leaves no row
// behind (the application role holds no DELETE on `ijazahs`: the follow-up under T004).
//
// Observed red: every case against the stub; the filters against the named mutants of
// `certificates.repository.ts` (ejazah-tools\b46\runs\lane-d\mutants\).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../platform/db/spec-database.fixtures.js';
import {
  certificateById,
  certificatesOfParty,
  publicCredentialsOf,
} from './certificates.repository.js';

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

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLED_BACK;
      },
      { timeout: 30_000 },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

const CAIRO = 'Africa/Cairo';
const GRANTED_AT = new Date('2026-11-17T10:00:00.000Z');
const RENDERED_AT = new Date('2026-11-17T10:05:00.000Z');
const SIGNED_OFF_AT = new Date('2026-11-17T11:00:00.000Z');
const REVOKED_AT = new Date('2026-11-17T12:00:00.000Z');
const TEACHER_NAME = 'فاطمة بنت علي';

type State = 'signed' | 'unsigned' | 'revoked' | 'revokedUnsigned' | 'deleted';

/**
 * Two pairs (a teacher and a student each, one ijazah-track enrollment each), a stranger, an
 * administrator, and on the first pair one ijazah in each state, made in this order; the second
 * pair one signed-off ijazah.
 */
async function world(tx: Transaction) {
  async function person(gender: 'male' | 'female'): Promise<string> {
    const { id } = await tx.user.create({
      data: {
        email: `probe-${randomUUID()}@example.invalid`,
        gender,
        dateOfBirth: new Date('2000-01-01T00:00:00Z'),
        displayName: 'Probe',
        preferredLanguage: 'ar',
        timezone: CAIRO,
        accountStatus: 'active',
      },
      select: { id: true },
    });
    return id;
  }
  const { id: adminId } = await tx.adminUser.create({
    data: {
      email: `certificates-${randomUUID()}@example.invalid`,
      mfaSecretEncrypted: Buffer.from('spec'),
      displayName: 'Spec administrator',
      isActive: true,
    },
    select: { id: true },
  });
  const { id: subjectId } = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });

  async function pair(gender: 'male' | 'female') {
    const teacherId = await person(gender);
    const studentId = await person(gender);
    await tx.teacherProfile.create({
      data: {
        userId: teacherId,
        bio: 'Probe',
        qualificationSummary: 'Probe',
        verificationStatus: 'approved',
        payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
      },
    });
    const { id: packageId } = await tx.package.create({
      data: {
        teacherUserId: teacherId,
        subjectId,
        sessionCount: 4,
        sessionDurationMinutes: 60,
        pricePiasters: 100_000n,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: slotId } = await tx.availabilitySlot.create({
      data: {
        teacherUserId: teacherId,
        dayOfWeek: 2,
        startTimeLocal: new Date('1970-01-01T14:00:00Z'),
        durationMinutes: 60,
        timezone: CAIRO,
        isActive: true,
      },
      select: { id: true },
    });
    const { id: enrollmentId } = await tx.enrollment.create({
      data: {
        studentUserId: studentId,
        teacherUserId: teacherId,
        packageId,
        slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: subjectId,
        snapshotSlotTimezone: CAIRO,
        snapshotTrack: 'ijazah_track',
        status: 'confirmed',
        confirmedAt: new Date('2026-10-01T00:00:00Z'),
        purchasedAt: new Date('2026-10-01T00:00:00Z'),
        quotedFirstSessionLocalDate: new Date('2026-11-03T00:00:00Z'),
      },
      select: { id: true },
    });
    return { teacherId, studentId, enrollmentId };
  }

  async function ijazah(
    of: { teacherId: string; studentId: string; enrollmentId: string },
    state: State,
  ): Promise<string> {
    const signed = state !== 'unsigned' && state !== 'revokedUnsigned';
    const revoked = state === 'revoked' || state === 'revokedUnsigned';
    const { id } = await tx.ijazah.create({
      data: {
        certificateNumber: `probe-${randomUUID()}`,
        enrollmentId: of.enrollmentId,
        studentUserId: of.studentId,
        teacherUserId: of.teacherId,
        subjectId,
        mode: 'generated',
        language: 'ar',
        chainSnapshot: [['محمد ﷺ'], [TEACHER_NAME]],
        certificateStorageKey: `certificates/probe-${state}/0.pdf`,
        paperCopyIntended: false,
        verificationTokenHash: `probe-${randomUUID()}`,
        grantedAt: GRANTED_AT,
        studentNamePrinted: 'مريم بنت أحمد',
        teacherNamePrinted: TEACHER_NAME,
        riwayaPrinted: 'حفص عن عاصم',
        tariqPrinted: null,
        completionDate: new Date('2026-11-11T00:00:00Z'),
        renderedAt: RENDERED_AT,
        ...(signed ? { signedOffAt: SIGNED_OFF_AT, signedOffByAdminId: adminId } : {}),
        ...(revoked
          ? { revokedAt: REVOKED_AT, revokedReason: 'probe', revokedByAdminId: adminId }
          : {}),
        ...(state === 'deleted' ? { deletedAt: REVOKED_AT } : {}),
      },
      select: { id: true },
    });
    return id;
  }

  const first = await pair('female');
  const second = await pair('male');
  const stranger = await person('female');
  const ids = {
    signed: await ijazah(first, 'signed'),
    unsigned: await ijazah(first, 'unsigned'),
    revoked: await ijazah(first, 'revoked'),
    revokedUnsigned: await ijazah(first, 'revokedUnsigned'),
    deleted: await ijazah(first, 'deleted'),
    secondSigned: await ijazah(second, 'signed'),
  };
  return { first, second, stranger, subjectId, ids };
}

describe('certification’s parties’ reads (T009)', { tags: ['database'] }, () => {
  it('answers the student their ijazahs newest first, a soft-deleted one and another pair’s left out', async () => {
    await rolledBack(async (tx) => {
      const { first, ids, subjectId } = await world(tx);
      const rows = await certificatesOfParty(tx, first.studentId);
      expect(rows.map((row) => row.id)).toEqual([
        ids.revokedUnsigned,
        ids.revoked,
        ids.unsigned,
        ids.signed,
      ]);
      expect(rows.at(-1)).toEqual({
        id: ids.signed,
        studentUserId: first.studentId,
        teacherUserId: first.teacherId,
        subjectId,
        teacherNamePrinted: TEACHER_NAME,
        grantedAt: GRANTED_AT,
        signedOffAt: SIGNED_OFF_AT,
        revokedAt: null,
        certificateStorageKey: 'certificates/probe-signed/0.pdf',
      });
    });
  });

  it('answers the granting teacher the same ijazahs, and a stranger none', async () => {
    await rolledBack(async (tx) => {
      const { first, second, stranger, ids } = await world(tx);
      expect((await certificatesOfParty(tx, first.teacherId)).map((row) => row.id)).toEqual([
        ids.revokedUnsigned,
        ids.revoked,
        ids.unsigned,
        ids.signed,
      ]);
      expect((await certificatesOfParty(tx, second.studentId)).map((row) => row.id)).toEqual([
        ids.secondSigned,
      ]);
      expect(await certificatesOfParty(tx, stranger)).toEqual([]);
    });
  });

  it('answers one ijazah by its id, and null for a soft-deleted one or an unknown id', async () => {
    await rolledBack(async (tx) => {
      const { first, ids } = await world(tx);
      expect(await certificateById(tx, ids.revoked)).toMatchObject({
        id: ids.revoked,
        studentUserId: first.studentId,
        teacherUserId: first.teacherId,
        revokedAt: REVOKED_AT,
        signedOffAt: SIGNED_OFF_AT,
      });
      expect(await certificateById(tx, ids.unsigned)).toMatchObject({ signedOffAt: null });
      expect(await certificateById(tx, ids.deleted)).toBeNull();
      expect(await certificateById(tx, randomUUID())).toBeNull();
    });
  });
});

describe(
  'the student’s public credentials (T009, Q9 (a); FR-IJAZAH-4)',
  { tags: ['database'] },
  () => {
    it('answers only the signed-off and unrevoked, a soft-deleted one left out', async () => {
      await rolledBack(async (tx) => {
        const { first, ids, subjectId } = await world(tx);
        expect(await publicCredentialsOf(tx, first.studentId)).toEqual([
          {
            ijazahId: ids.signed,
            subjectId,
            teacherNamePrinted: TEACHER_NAME,
            grantedAt: GRANTED_AT,
            signedOffAt: SIGNED_OFF_AT,
          },
        ]);
      });
    });

    it('never admits one not signed off', async () => {
      await rolledBack(async (tx) => {
        const { first, ids } = await world(tx);
        const answered = (await publicCredentialsOf(tx, first.studentId)).map((c) => c.ijazahId);
        expect(answered).not.toContain(ids.unsigned);
        expect(answered).not.toContain(ids.revokedUnsigned);
      });
    });

    it('never admits a revoked one (R-HONEST-6, FR-IJAZAH-8)', async () => {
      await rolledBack(async (tx) => {
        const { first, ids } = await world(tx);
        const answered = (await publicCredentialsOf(tx, first.studentId)).map((c) => c.ijazahId);
        expect(answered).not.toContain(ids.revoked);
        expect(answered).not.toContain(ids.revokedUnsigned);
      });
    });

    it('answers the student’s own only: the granting teacher’s id and a stranger answer none', async () => {
      await rolledBack(async (tx) => {
        const { first, second, stranger, ids } = await world(tx);
        expect(await publicCredentialsOf(tx, first.teacherId)).toEqual([]);
        expect(await publicCredentialsOf(tx, stranger)).toEqual([]);
        expect((await publicCredentialsOf(tx, second.studentId)).map((c) => c.ijazahId)).toEqual([
          ids.secondSigned,
        ]);
      });
    });
  },
);
