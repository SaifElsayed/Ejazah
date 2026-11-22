// T027 — catalog's profile read for `discovery.teacher` over the real tables (FR-331, FR-336,
// R-GENDER-1, R-GENDER-2, R-GENDER-5; specs/003-booking/contracts/app-surface.md "`discovery`").
//
// What is probed: a visible teacher's profile, field by field: the display name, the gender, the
// photo as the storage port's signed link (never `users.photo_key`), the bio, the qualification, the
// subjects of `teacher_subjects` whose subject is active, the rating and the review count, and the
// active packages only, each with its subject, track, length, total and price per session; no
// riwaya, tariq or chain of the teacher's approved credential appears anywhere in the answer. An
// excluded teacher (the other gender, a suspended or banned account, an application not approved, a
// payout account not verified, a soft-deleted account) answers exactly what an unknown id answers,
// NOT_FOUND with no field, in both directions. The router's refusals and its rate limit are
// `apps/api/src/modules/booking/discovery.router.spec.ts`'s; the adversarial cases are T028's.
//
// NOTHING IS LEFT BEHIND: every case runs inside one Prisma interactive transaction that always ends
// by throwing, so its rows roll back, as in `tests/db-integrity/discovery.spec.ts`.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  createDiscoveryCatalog,
  type DiscoveryCatalog,
} from '../../apps/api/src/modules/catalog/index.js';
import {
  closeDatabase,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  specDatabaseUrl,
  whenDatabaseSpecs,
} from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { mapError } from '../../apps/api/src/platform/errors/error-filter.js';
import type { RequesterGender } from '../../apps/api/src/platform/guards/requester-gender.js';
import { SettingError } from '../../apps/api/src/platform/settings/settings-reader.js';
import { discoveryTeacherOutput } from '../../packages/contracts/src/index.js';

const database = whenDatabaseSpecs(() =>
  openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  }),
);
afterAll(() => closeDatabase(database));

const ROLLBACK = new Error('rolled back on purpose: the case leaves no row behind');

async function inRollback(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLBACK;
      },
      { timeout: 60_000 },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

type Gender = 'male' | 'female';
type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';
type VerificationStatus = 'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';

// A spec file may mint the requester's gender; the request context is the only other place (T138).
const requesterOf = (gender: Gender) => gender as RequesterGender;
const otherOf = (gender: Gender): Gender => (gender === 'male' ? 'female' : 'male');

const DIRECTIONS: readonly { readonly name: string; readonly own: Gender }[] = [
  { name: 'a male requester', own: 'male' },
  { name: 'a female requester', own: 'female' },
];

const TTL_SECONDS = 900;
const RIWAYA = 'حفص عن عاصم';
const TARIQ = 'طريق الشاطبية';

/** The service over `document_link_ttl_seconds` alone and a storage port that signs a fixed link. */
const catalog: DiscoveryCatalog = createDiscoveryCatalog(
  {
    async read(key, schema) {
      // 006:T004 (rule d): the programme's switch off, as seeded, so no programme package shows.
      if (key === 'programme_enabled') return schema.parse(0);
      if (key !== 'document_link_ttl_seconds') throw new SettingError(key, 'missing');
      return schema.parse(TTL_SECONDS);
    },
  },
  {
    async temporaryLink(_key, seconds) {
      return `https://files.invalid/signed?expires=${String(seconds)}`;
    },
  },
);

interface TeacherValues {
  readonly gender: Gender;
  readonly photoKey?: string | null;
  readonly accountStatus?: AccountStatus;
  readonly verificationStatus?: VerificationStatus;
  readonly payoutVerified?: boolean;
  readonly deleted?: boolean;
  readonly averageRating?: string | null;
  readonly reviewCount?: number;
}

/** A teacher, visible to a requester of the same gender unless a field says otherwise. */
async function teacher(tx: Transaction, values: TeacherValues): Promise<string> {
  const { id } = await tx.user.create({
    data: {
      email: `discovery-teacher-${randomUUID()}@example.invalid`,
      gender: values.gender,
      dateOfBirth: new Date('1985-03-01'),
      displayName: 'معلم الملف',
      photoKey: values.photoKey === undefined ? `photos/${randomUUID()}.webp` : values.photoKey,
      preferredLanguage: 'ar',
      timezone: 'Africa/Cairo',
      accountStatus: values.accountStatus ?? 'active',
      deletedAt: values.deleted === true ? new Date('2026-10-30T09:00:00Z') : null,
    },
    select: { id: true },
  });
  await tx.teacherProfile.create({
    data: {
      userId: id,
      bio: 'نبذة الملف\nسطرها الثاني',
      qualificationSummary: 'إجازة برواية حفص',
      verificationStatus: values.verificationStatus ?? 'approved',
      payoutVerifiedAt: values.payoutVerified === false ? null : new Date('2026-10-20T09:00:00Z'),
      averageRating: values.averageRating === undefined ? '4.25' : values.averageRating,
      reviewCount: values.reviewCount ?? 8,
    },
    select: { id: true },
  });
  return id;
}

interface SubjectRow {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string;
}

async function subject(tx: Transaction, isActive = true): Promise<SubjectRow> {
  const tag = randomUUID().slice(0, 8);
  return tx.subject.create({
    data: { nameAr: `مادة ${tag}`, nameEn: `Subject ${tag}`, isActive },
    select: { id: true, nameAr: true, nameEn: true },
  });
}

/** Makes `subjects` the teacher's `teacher_subjects`, as a credential's approval does. */
async function grant(tx: Transaction, teacherId: string, subjects: readonly SubjectRow[]) {
  await tx.teacherSubject.createMany({
    data: subjects.map(({ id }) => ({ teacherUserId: teacherId, subjectId: id })),
  });
}

interface PackageValues {
  readonly track?: 'recitation' | 'ijazah_track';
  readonly sessionCount?: number;
  readonly minutes?: 30 | 45 | 60;
  readonly price?: number;
  readonly isActive?: boolean;
}

async function offer(
  tx: Transaction,
  teacherId: string,
  on: SubjectRow,
  values: PackageValues = {},
): Promise<string> {
  const { id } = await tx.package.create({
    data: {
      teacherUserId: teacherId,
      subjectId: on.id,
      track: values.track ?? 'recitation',
      sessionCount: values.sessionCount ?? 4,
      sessionDurationMinutes: values.minutes ?? 60,
      pricePiasters: BigInt(values.price ?? 100_000),
      isActive: values.isActive ?? true,
    },
    select: { id: true },
  });
  return id;
}

/** An approved credential of the teacher on `on`, with a riwaya and a tariq as transcribed. */
async function approvedCredential(tx: Transaction, teacherId: string, on: SubjectRow) {
  const { id: adminId } = await tx.adminUser.create({
    data: {
      email: `discovery-teacher-${randomUUID()}@example.invalid`,
      mfaSecretEncrypted: Buffer.from('spec'),
      displayName: 'Spec administrator',
      isActive: true,
    },
    select: { id: true },
  });
  const { id: documentId } = await tx.verificationDocument.create({
    data: {
      userId: teacherId,
      documentType: 'credential',
      storageKeyEncrypted: Buffer.from('spec'),
    },
    select: { id: true },
  });
  await tx.teacherCredential.create({
    data: {
      teacherUserId: teacherId,
      subjectId: on.id,
      documentId,
      status: 'approved',
      riwaya: RIWAYA,
      tariq: TARIQ,
      submittedWithApplication: true,
      reviewedByAdminId: adminId,
      reviewedAt: new Date('2026-10-18T09:00:00Z'),
    },
    select: { id: true },
  });
}

/** What the profile read answers, or how it was refused, as the error filter would send it. */
async function answerOf(tx: Transaction, own: Gender, teacherId: string) {
  return catalog.teacher(tx, requesterOf(own), { teacherId }).then(
    (profile) => ({ profile }),
    (error: unknown) => ({ refused: mapError(error) }),
  );
}

const NOT_FOUND = {
  refused: {
    status: 404,
    body: { code: 'NOT_FOUND', message: 'Not found.' },
    unexpected: false,
  },
};

describe.each(DIRECTIONS)('discovery.teacher for $name (FR-336)', ({ own }) => {
  it('answers the profile: active packages only, approved subjects, the price per session, the photo as a link', async () => {
    await inRollback(async (tx) => {
      const [quran, tajweed, retired] = await Promise.all([
        subject(tx),
        subject(tx),
        subject(tx, false),
      ]);
      const photoKey = `photos/${randomUUID()}/kept-private.webp`;
      const id = await teacher(tx, { gender: own, photoKey });
      await grant(tx, id, [quran, tajweed, retired]);
      await approvedCredential(tx, id, quran);
      const first = await offer(tx, id, quran, {
        track: 'ijazah_track',
        sessionCount: 3,
        minutes: 45,
        price: 100_000,
      });
      await offer(tx, id, quran, { track: 'recitation', isActive: false });
      const second = await offer(tx, id, tajweed, { sessionCount: 8, price: 160_000 });

      const answer = await answerOf(tx, own, id);
      expect(answer).toEqual({
        profile: {
          teacherId: id,
          displayName: 'معلم الملف',
          gender: own,
          photoUrl: `https://files.invalid/signed?expires=${String(TTL_SECONDS)}`,
          bio: 'نبذة الملف\nسطرها الثاني',
          qualificationSummary: 'إجازة برواية حفص',
          subjects: expect.arrayContaining([quran, tajweed]),
          rating: 4.25,
          reviewCount: 8,
          packages: [
            {
              packageId: first,
              subject: quran,
              track: 'ijazah_track',
              sessionCount: 3,
              sessionDurationMinutes: 45,
              price_piasters: 100_000,
              perSession_piasters: 33_333,
            },
            {
              packageId: second,
              subject: tajweed,
              track: 'recitation',
              sessionCount: 8,
              sessionDurationMinutes: 60,
              price_piasters: 160_000,
              perSession_piasters: 20_000,
            },
          ],
        },
      });
      if (!('profile' in answer)) throw new Error('the profile was refused');
      expect(answer.profile.subjects).toHaveLength(2);
      expect(discoveryTeacherOutput.strict().safeParse(answer.profile).success).toBe(true);
      const sent = JSON.stringify(answer);
      for (const hidden of [photoKey, RIWAYA, TARIQ, 'riwaya', 'tariq', 'chain', 'photoKey']) {
        expect(sent, hidden).not.toContain(hidden);
      }
    });
  });

  it('answers no photo, no rating and no package for a teacher with none', async () => {
    await inRollback(async (tx) => {
      const id = await teacher(tx, {
        gender: own,
        photoKey: null,
        averageRating: null,
        reviewCount: 0,
      });
      const answer = await answerOf(tx, own, id);
      expect(answer).toEqual({
        profile: {
          teacherId: id,
          displayName: 'معلم الملف',
          gender: own,
          bio: 'نبذة الملف\nسطرها الثاني',
          qualificationSummary: 'إجازة برواية حفص',
          subjects: [],
          reviewCount: 0,
          packages: [],
        },
      });
    });
  });

  const EXCLUDED: readonly { readonly state: string; readonly values: Partial<TeacherValues> }[] = [
    { state: 'of the other gender', values: { gender: otherOf(own) } },
    { state: 'suspended', values: { accountStatus: 'suspended' } },
    { state: 'banned', values: { accountStatus: 'banned' } },
    { state: 'with an application pending', values: { verificationStatus: 'pending' } },
    { state: 'with an application rejected', values: { verificationStatus: 'rejected' } },
    { state: 'with an approval suspended', values: { verificationStatus: 'suspended' } },
    { state: 'with an approval revoked', values: { verificationStatus: 'revoked' } },
    { state: 'banned by verification', values: { verificationStatus: 'banned' } },
    { state: 'with the payout unverified', values: { payoutVerified: false } },
    { state: 'soft-deleted', values: { deleted: true } },
  ];

  it.each(EXCLUDED)(
    'answers a teacher $state NOT_FOUND with no field, as an unknown id',
    async ({ values }) => {
      await inRollback(async (tx) => {
        const quran = await subject(tx);
        const id = await teacher(tx, { gender: own, ...values });
        await grant(tx, id, [quran]);
        await approvedCredential(tx, id, quran);
        await offer(tx, id, quran);
        await expect(answerOf(tx, own, id)).resolves.toEqual(NOT_FOUND);
        await expect(answerOf(tx, own, randomUUID())).resolves.toEqual(NOT_FOUND);
      });
    },
  );
});
