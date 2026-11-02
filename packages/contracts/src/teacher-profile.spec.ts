// T016 — the `teacher.profile` schemas of specs/003-booking/contracts/app-surface.md (FR-310,
// FR-PROFILE-1, FR-PROFILE-7). Written before the schemas, and run red first.
//
// The update takes the bio and the qualification summary and nothing else: the display name stays
// `account.updateProfile`'s (T158), the photo stays `POST /uploads/photos`, and the gender is shown
// on `get`, never written (R-GENDER-6). Both texts have bounded lengths; the qualification has the
// application form's bound, since it is the same column.
import { describe, expect, it } from 'vitest';

import { QUALIFICATION_MAX_LENGTH } from './teacher-application.js';
import {
  BIO_MAX_LENGTH,
  teacherProfileGetOutput,
  teacherProfileUpdateInput,
  teacherProfileUpdateOutput,
} from './teacher-profile.js';

const update = {
  bio: 'أدرّس حفظ القرآن وتجويده منذ ثماني سنوات.',
  qualificationSummary: 'إجازة في حفظ القرآن برواية حفص',
} as const;

const profile = {
  displayName: 'سارة عادل',
  photoUrl: 'https://files.example/photo?signature=abc',
  bio: update.bio,
  qualificationSummary: update.qualificationSummary,
  gender: 'female',
  published: false,
} as const;

describe('the update input', () => {
  it('is the bio and the qualification summary, nothing else', () => {
    expect(Object.keys(teacherProfileUpdateInput.shape).sort()).toEqual([
      'bio',
      'qualificationSummary',
    ]);
    const parsed = teacherProfileUpdateInput.parse({
      ...update,
      gender: 'male',
      displayName: 'other',
      photoKey: 'photos/x',
    });
    expect(parsed).toEqual(update);
  });

  it('takes BIO_MAX_LENGTH characters of bio, trimmed, and an empty bio', () => {
    const longest = 'ب'.repeat(BIO_MAX_LENGTH);
    expect(teacherProfileUpdateInput.parse({ ...update, bio: `  ${longest}  ` }).bio).toBe(longest);
    expect(teacherProfileUpdateInput.parse({ ...update, bio: '   ' }).bio).toBe('');
  });

  it('refuses one bio character more', () => {
    const bio = 'ب'.repeat(BIO_MAX_LENGTH + 1);
    expect(teacherProfileUpdateInput.safeParse({ ...update, bio }).success).toBe(false);
  });

  it("holds the qualification to the application form's bound, never blank", () => {
    const longest = 'ق'.repeat(QUALIFICATION_MAX_LENGTH);
    expect(
      teacherProfileUpdateInput.parse({ ...update, qualificationSummary: longest })
        .qualificationSummary,
    ).toBe(longest);
    for (const qualificationSummary of ['ق'.repeat(QUALIFICATION_MAX_LENGTH + 1), '', '   ']) {
      expect(teacherProfileUpdateInput.safeParse({ ...update, qualificationSummary }).success).toBe(
        false,
      );
    }
  });
});

describe('the outputs', () => {
  it('get shows the gender and whether the profile is published', () => {
    expect(teacherProfileGetOutput.parse(profile)).toEqual(profile);
    expect(teacherProfileGetOutput.safeParse({ ...profile, published: undefined }).success).toBe(
      false,
    );
    expect(teacherProfileGetOutput.safeParse({ ...profile, gender: 'other' }).success).toBe(false);
  });

  it('get takes a profile with no photo yet', () => {
    const { photoUrl: _photo, ...noPhoto } = profile;
    expect(teacherProfileGetOutput.safeParse(noPhoto).success).toBe(true);
  });

  it('get strips a stored key it does not name (R-HONEST-4)', () => {
    const parsed = teacherProfileGetOutput.parse({ ...profile, photoKey: 'photos/x', userId: 'u' });
    expect(parsed).not.toHaveProperty('photoKey');
    expect(parsed).not.toHaveProperty('userId');
  });

  it('update answers the two texts as saved', () => {
    expect(teacherProfileUpdateOutput.parse(update)).toEqual(update);
  });
});
