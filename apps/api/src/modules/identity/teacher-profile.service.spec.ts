// T017 (FR-310, FR-PROFILE-1, R-GENDER-6, R-218): the teacher's own public profile, through the
// namespace over the real service and the spec database.
//
// `get` answers the display name, the photo as a signed link that lapses after
// `document_link_ttl_seconds` (never the key, `users.photo_key`), the bio, the qualification summary,
// the gender of the account, and `published`: the visibility predicate's answer for this teacher as
// a same-gender student would get it, so false until the payout account is verified (FR-315).
// `update` writes the bio and the qualification summary, trimmed, and nothing else: a sent gender
// changes nothing (R-GENDER-6), the photo stays `POST /uploads/photos`' and the display name
// `account.updateProfile`'s. A bio of 1001 characters is refused and writes nothing (BIO_MAX_LENGTH,
// the owner's decision of 2026-11-02). The write is one conditional statement on the caller's
// approved profile, so a teacher whose approval ended after the session was read is FORBIDDEN and
// nothing is written (T005's rule 1: no read decides it).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { BIO_MAX_LENGTH } from '@ijazah/contracts';
import { afterAll, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import {
  createAccount,
  createTeacherProfile,
  openSpecDatabase,
  SEEDED_SETTINGS,
  settingsOf,
  SpecStorage,
} from './__fixtures__/identity.js';
import { TeacherProfileRows } from './__fixtures__/teacher-profile-rows.repository.js';
import { profileSurfaceOf, refusalOf, sessionOf } from './__fixtures__/teacher-profile-surface.js';
import { createTeacherProfileService } from './index.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

const rows = () => new TeacherProfileRows(database);
const service = () =>
  createTeacherProfileService({
    database,
    settings: settingsOf(SEEDED_SETTINGS),
    storage: new SpecStorage(),
  });

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

/** An approved teacher of `gender`, the payout account verified when `published`; their user id. */
async function approvedTeacher(gender: 'male' | 'female', published: boolean): Promise<string> {
  const { userId } = await createAccount(database, { role: 'teacher', gender });
  await createTeacherProfile(database, userId, {
    verificationStatus: 'approved',
    applicationStatus: 'approved',
    payoutConfiguredAt: published ? new Date('2026-10-20T08:00:00Z') : null,
    payoutVerifiedAt: published ? new Date('2026-10-21T08:00:00Z') : null,
  });
  return userId;
}

/** The namespace as the teacher `userId` of `gender` calls it. */
function teacher(userId: string, gender: 'male' | 'female', published = false) {
  return profileSurfaceOf(service()).session(
    sessionOf(published ? 'publishable' : 'approved', userId, gender),
  ).teacher.profile;
}

describe('get', () => {
  it('answers the profile, the photo as a signed link and never its key, the gender of the account, and unpublished before payout verification', async () => {
    const userId = await approvedTeacher('male', false);
    await rows().write(userId, {
      photoKey: `photos/${userId}/face.jpg`,
      bio: 'نبذة المعلم',
      qualificationSummary: 'إجازة في رواية حفص',
    });

    const answer = await teacher(userId, 'male').get();
    expect(answer).toEqual({
      displayName: 'Spec Person',
      photoUrl: `https://storage.invalid/photos/${userId}/face.jpg?expires=300`,
      bio: 'نبذة المعلم',
      qualificationSummary: 'إجازة في رواية حفص',
      gender: 'male',
      published: false,
    });
  });

  it('answers published once the payout account is verified, for a male and a female teacher alike', async () => {
    for (const gender of ['male', 'female'] as const) {
      const userId = await approvedTeacher(gender, true);
      const answer = await teacher(userId, gender, true).get();
      expect(answer, gender).toMatchObject({ gender, published: true });
      expect(answer, gender).not.toHaveProperty('photoUrl');
    }
  });
});

describe('update', () => {
  it('writes the bio and the qualification summary, trimmed, and answers them; the account is untouched', async () => {
    const userId = await approvedTeacher('female', false);
    await rows().write(userId, { photoKey: `photos/${userId}/face.jpg` });
    const before = await rows().read(userId);

    const answer = await teacher(userId, 'female').update({
      bio: '  نبذة جديدة  ',
      qualificationSummary: ' إجازة في رواية ورش ',
    });

    expect(answer).toEqual({ bio: 'نبذة جديدة', qualificationSummary: 'إجازة في رواية ورش' });
    expect(await rows().read(userId)).toMatchObject({
      displayName: before.displayName,
      gender: 'female',
      photoKey: `photos/${userId}/face.jpg`,
      bio: 'نبذة جديدة',
      qualificationSummary: 'إجازة في رواية ورش',
      verificationStatus: 'approved',
    });
  });

  it('changes nothing of the gender when one is sent (R-GENDER-6)', async () => {
    for (const [gender, sent] of [
      ['male', 'female'],
      ['female', 'male'],
    ] as const) {
      const userId = await approvedTeacher(gender, true);
      const input = { bio: 'نبذة', qualificationSummary: 'مؤهل', gender: sent };
      const answer = await teacher(userId, gender, true).update(input as never);
      expect(answer, gender).toEqual({ bio: 'نبذة', qualificationSummary: 'مؤهل' });
      expect((await rows().read(userId)).gender, gender).toBe(gender);
      expect((await teacher(userId, gender, true).get()).gender, gender).toBe(gender);
    }
  });

  it('refuses a bio of 1001 characters VALIDATION_FAILED and writes nothing', async () => {
    const userId = await approvedTeacher('male', false);
    await rows().write(userId, { bio: 'نبذة سابقة', qualificationSummary: 'مؤهل سابق' });
    const before = await rows().read(userId);

    expect(
      await refusalOf(
        teacher(userId, 'male').update({
          bio: 'ب'.repeat(BIO_MAX_LENGTH + 1),
          qualificationSummary: 'مؤهل جديد',
        }),
      ),
    ).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'bio' }] });
    expect(await rows().read(userId)).toEqual(before);
  });

  it('takes a bio of exactly 1000 characters', async () => {
    const userId = await approvedTeacher('male', false);
    const bio = 'ب'.repeat(BIO_MAX_LENGTH);
    await teacher(userId, 'male').update({ bio, qualificationSummary: 'مؤهل' });
    expect((await rows().read(userId)).bio).toBe(bio);
  });

  it('refuses FORBIDDEN and writes nothing once the approval ended after the session was read', async () => {
    const userId = await approvedTeacher('male', false);
    await rows().write(userId, {
      bio: 'نبذة سابقة',
      qualificationSummary: 'مؤهل سابق',
      verificationStatus: 'revoked',
    });
    const before = await rows().read(userId);

    await expect(
      teacher(userId, 'male').update({ bio: 'نبذة جديدة', qualificationSummary: 'مؤهل جديد' }),
    ).rejects.toEqual(refused('FORBIDDEN'));
    expect(await rows().read(userId)).toEqual(before);
  });
});
