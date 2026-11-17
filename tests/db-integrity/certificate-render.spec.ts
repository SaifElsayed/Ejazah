// T008 of specs/005-certification (FR-606; R-401, R-402; B46 Q6 (a), Q-B1 (a)) — certification's
// render store over the real tables as the application role:
//
// - `renderSourceOf` reads the ijazah's printed fields, its generation and its request's signature
//   copy key, and nothing of another module's tables;
// - `markRendered` sets `certificate_storage_key` and `rendered_at` on the caller's transaction,
//   under the ijazah's row lock, only when the payload's generation is still the row's: an older
//   generation writes nothing and is answered `stale_generation` with the row's generation and key
//   (the newer PDF's, never removed); a second mark of one generation writes nothing
//   (`already_rendered`, R-API-14).
//
// Every world is written and read on one transaction that is rolled back, so the spec leaves no row
// behind (the application role holds no DELETE on `ijazahs`: the follow-up under T004).
//
// Observed red: every case against the stub; the stale case against the mutant M-gen of
// `certificate-render.repository.ts`, its generation comparison removed.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  markRendered,
  renderSourceOf,
} from '../../apps/api/src/modules/certification/index.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';

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
const GRANTED_AT = new Date('2026-11-17T10:00:00Z');
const RENDERED_AT = new Date('2026-11-17T10:05:00Z');
const CHAIN = [['محمد ﷺ'], ['عثمان بن عفان', 'علي بن أبي طالب'], ['أحمد بن محمد المُجيز']];

/** A teacher, a student, an ijazah-track enrollment, its request and one ijazah at `generation`. */
async function world(
  tx: Transaction,
  options: { readonly generation?: number; readonly tariq?: string | null } = {},
) {
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
  const teacherId = await person('female');
  const studentId = await person('female');
  await tx.teacherProfile.create({
    data: {
      userId: teacherId,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    },
  });
  const { id: subjectId } = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
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
  const tariq = options.tariq === undefined ? 'الشاطبية' : options.tariq;
  const signatureKey = `ijazah-requests/${randomUUID()}/signature.png`;
  const { id: requestId } = await tx.ijazahRequest.create({
    data: {
      enrollmentId,
      teacherUserId: teacherId,
      studentUserId: studentId,
      subjectId,
      completionDate: new Date('2026-11-11T00:00:00Z'),
      language: 'ar',
      status: 'pending',
      chainSnapshot: CHAIN,
      teacherNamePrinted: 'فاطمة بنت علي',
      riwayaPrinted: 'حفص عن عاصم',
      tariqPrinted: tariq,
      signatureStorageKey: signatureKey,
    },
    select: { id: true },
  });
  const generation = options.generation ?? 0;
  const { id: ijazahId } = await tx.ijazah.create({
    data: {
      certificateNumber: `probe-${randomUUID()}`,
      enrollmentId,
      studentUserId: studentId,
      teacherUserId: teacherId,
      subjectId,
      mode: 'generated',
      language: 'ar',
      chainSnapshot: CHAIN,
      certificateStorageKey: 'certificates/reserved/0.pdf',
      paperCopyIntended: false,
      verificationTokenHash: `probe-${randomUUID()}`,
      grantedAt: GRANTED_AT,
      requestId,
      studentNamePrinted: 'مريم بنت أحمد',
      teacherNamePrinted: 'فاطمة بنت علي',
      riwayaPrinted: 'حفص عن عاصم',
      tariqPrinted: tariq,
      completionDate: new Date('2026-11-11T00:00:00Z'),
      renderGeneration: generation,
    },
    select: { id: true },
  });
  return { ijazahId, requestId, teacherId, studentId, subjectId, signatureKey };
}

async function rowOf(tx: Transaction, ijazahId: string) {
  return tx.ijazah.findUniqueOrThrow({
    where: { id: ijazahId },
    select: { certificateStorageKey: true, renderedAt: true, renderGeneration: true },
  });
}

describe('certification’s render store (T008)', { tags: ['database'] }, () => {
  it('reads the printed fields, the generation and the request’s signature copy key', async () => {
    await rolledBack(async (tx) => {
      const made = await world(tx, { generation: 2 });
      expect(await renderSourceOf(tx, made.ijazahId)).toEqual({
        ijazahId: made.ijazahId,
        requestId: made.requestId,
        studentUserId: made.studentId,
        teacherUserId: made.teacherId,
        subjectId: made.subjectId,
        language: 'ar',
        certificateNumber: expect.stringMatching(/^probe-/) as unknown as string,
        studentNamePrinted: 'مريم بنت أحمد',
        teacherNamePrinted: 'فاطمة بنت علي',
        riwayaPrinted: 'حفص عن عاصم',
        tariqPrinted: 'الشاطبية',
        chainSnapshot: CHAIN,
        completionDate: new Date('2026-11-11T00:00:00Z'),
        grantedAt: GRANTED_AT,
        renderGeneration: 2,
        renderedAt: null,
        signatureStorageKey: made.signatureKey,
      });
    });
  });

  it('reads a tariq the credential does not name as null, and an unknown ijazah as null', async () => {
    await rolledBack(async (tx) => {
      const made = await world(tx, { tariq: null });
      expect((await renderSourceOf(tx, made.ijazahId))?.tariqPrinted).toBeNull();
      expect(await renderSourceOf(tx, randomUUID())).toBeNull();
    });
  });

  it('marks the current generation rendered: its key and rendered_at, the previous key answered', async () => {
    await rolledBack(async (tx) => {
      const made = await world(tx, { generation: 1 });
      const storageKey = `certificates/${made.ijazahId}/1.pdf`;
      expect(
        await markRendered(tx, { ijazahId: made.ijazahId, generation: 1, storageKey, at: RENDERED_AT }),
      ).toEqual({ outcome: 'written', previousKey: 'certificates/reserved/0.pdf' });
      expect(await rowOf(tx, made.ijazahId)).toEqual({
        certificateStorageKey: storageKey,
        renderedAt: RENDERED_AT,
        renderGeneration: 1,
      });
    });
  });

  it('writes nothing for an older generation, answering the row’s generation and key', async () => {
    await rolledBack(async (tx) => {
      const made = await world(tx, { generation: 3 });
      const before = await rowOf(tx, made.ijazahId);
      expect(
        await markRendered(tx, {
          ijazahId: made.ijazahId,
          generation: 2,
          storageKey: `certificates/${made.ijazahId}/2.pdf`,
          at: RENDERED_AT,
        }),
      ).toEqual({
        outcome: 'stale_generation',
        currentGeneration: 3,
        currentKey: 'certificates/reserved/0.pdf',
      });
      expect(await rowOf(tx, made.ijazahId)).toEqual(before);
    });
  });

  it('writes nothing for a generation already rendered (a second run)', async () => {
    await rolledBack(async (tx) => {
      const made = await world(tx);
      const mark = {
        ijazahId: made.ijazahId,
        generation: 0,
        storageKey: `certificates/${made.ijazahId}/0.pdf`,
        at: RENDERED_AT,
      };
      await markRendered(tx, mark);
      const once = await rowOf(tx, made.ijazahId);
      expect(
        await markRendered(tx, { ...mark, at: new Date('2026-11-17T11:00:00Z') }),
      ).toEqual({ outcome: 'already_rendered' });
      expect(await rowOf(tx, made.ijazahId)).toEqual(once);
    });
  });

  it('answers not_found for an unknown ijazah, writing nothing', async () => {
    await rolledBack(async (tx) => {
      expect(
        await markRendered(tx, {
          ijazahId: randomUUID(),
          generation: 0,
          storageKey: 'certificates/none/0.pdf',
          at: RENDERED_AT,
        }),
      ).toEqual({ outcome: 'not_found' });
    });
  });
});
