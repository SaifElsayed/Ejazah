// T017 — the `teacher.profile` namespace as the user surface serves it (app-surface.md
// "`teacher.profile` — identity"; FR-310, FR-PROFILE-1, R-GENDER-6, R-218).
//
// Both procedures are the teacher kind admitting an approved teacher, the payout account verified
// or not, since a teacher drafts the profile before payout verification (FR-315): an anonymous
// caller is UNAUTHENTICATED, a student and an applicant FORBIDDEN, a suspended or banned teacher
// ACCOUNT_RESTRICTED, and none of them reaches the service. `update` takes the bio and the
// qualification summary and nothing else: a gender, a display name or a photo key sent beside them
// never reaches the service (R-GENDER-6), and a bio over BIO_MAX_LENGTH (1000, the owner's decision
// of 2026-11-02) is refused before it. What the service reads and writes is
// teacher-profile.service.spec.ts's.
import { BIO_MAX_LENGTH } from '@ijazah/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  metaOf,
  PROFILE_CALLER,
  type ProfileCaller,
  profileSurfaceOf,
  recordingProfile,
  refusalOf,
} from './__fixtures__/teacher-profile-surface.js';

const refused = (code: string) =>
  expect.objectContaining({ cause: expect.objectContaining({ code }) });

const UPDATE = { bio: 'نبذة', qualificationSummary: 'إجازة في رواية حفص' };

let services: ReturnType<typeof recordingProfile>;
let surface: ReturnType<typeof profileSurfaceOf>;
beforeEach(() => {
  services = recordingProfile();
  surface = profileSurfaceOf(services.teacherProfile);
});

function calls(caller: ProfileCaller) {
  return {
    'teacher.profile.get': () => caller.teacher.profile.get(),
    'teacher.profile.update': () => caller.teacher.profile.update(UPDATE),
  };
}

describe('the namespace', () => {
  it('declares both procedures as the teacher kind, neither of them limited', () => {
    for (const path of Object.keys(calls(surface.anonymous()))) {
      expect(metaOf(path)).toEqual({ surface: 'app', caller: 'teacher' });
    }
  });

  it("refuses an anonymous caller UNAUTHENTICATED: 'teacher.profile.get', 'teacher.profile.update'", async () => {
    for (const [path, call] of Object.entries(calls(surface.anonymous()))) {
      await expect(call(), path).rejects.toEqual(refused('UNAUTHENTICATED'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses a student FORBIDDEN: 'teacher.profile.get', 'teacher.profile.update'", async () => {
    for (const [path, call] of Object.entries(calls(surface.as('student')))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses an applicant FORBIDDEN, since the profile follows approval: 'teacher.profile.get', 'teacher.profile.update'", async () => {
    for (const [path, call] of Object.entries(calls(surface.as('applicant')))) {
      await expect(call(), path).rejects.toEqual(refused('FORBIDDEN'));
    }
    expect(services.calls).toEqual([]);
  });

  it("refuses a suspended or a banned teacher ACCOUNT_RESTRICTED: 'teacher.profile.get', 'teacher.profile.update'", async () => {
    for (const standing of ['suspended teacher', 'banned teacher'] as const) {
      for (const [path, call] of Object.entries(calls(surface.as(standing)))) {
        await expect(call(), path).rejects.toEqual(refused('ACCOUNT_RESTRICTED'));
      }
    }
    expect(services.calls).toEqual([]);
  });

  it('admits an approved teacher whether the payout account is verified or not (FR-315)', async () => {
    for (const standing of ['approved', 'publishable'] as const) {
      await expect(surface.as(standing).teacher.profile.get()).resolves.toBeDefined();
      await expect(surface.as(standing).teacher.profile.update(UPDATE)).resolves.toEqual(UPDATE);
    }
  });
});

describe('get', () => {
  it("reads the caller's own profile with the session's gender for the predicate, and answers only the contract's fields", async () => {
    const leaking = {
      ...services.teacherProfile,
      get: async () => ({
        displayName: 'Spec Teacher',
        bio: '',
        qualificationSummary: 'Spec qualification',
        gender: 'male' as const,
        published: true,
        photoKey: 'photos/secret.jpg',
        userId: PROFILE_CALLER,
      }),
    };
    const answer = await profileSurfaceOf(leaking).as('publishable').teacher.profile.get();
    expect(answer).toEqual({
      displayName: 'Spec Teacher',
      bio: '',
      qualificationSummary: 'Spec qualification',
      gender: 'male',
      published: true,
    });

    await surface.as('approved').teacher.profile.get();
    expect(services.calls).toEqual([['get', PROFILE_CALLER, 'male']]);
  });
});

describe('update', () => {
  it('hands the service the bio and the qualification only: a sent gender, display name or photo key never reaches it (R-GENDER-6)', async () => {
    const sent = {
      ...UPDATE,
      gender: 'female',
      displayName: 'Another Name',
      photoKey: 'photos/other.jpg',
    } as unknown as typeof UPDATE;
    await expect(surface.as('approved').teacher.profile.update(sent)).resolves.toEqual(UPDATE);
    expect(services.calls).toEqual([['update', PROFILE_CALLER, UPDATE]]);
  });

  it('takes a bio of BIO_MAX_LENGTH (1000) characters, trimmed', async () => {
    const bio = 'ب'.repeat(BIO_MAX_LENGTH);
    expect(BIO_MAX_LENGTH).toBe(1000);
    await surface.as('approved').teacher.profile.update({ ...UPDATE, bio: ` ${bio} ` });
    expect(services.calls).toEqual([['update', PROFILE_CALLER, { ...UPDATE, bio }]]);
  });

  it('refuses a bio of 1001 characters VALIDATION_FAILED before the service (FR-310)', async () => {
    const bio = 'ب'.repeat(BIO_MAX_LENGTH + 1);
    expect(
      await refusalOf(surface.as('approved').teacher.profile.update({ ...UPDATE, bio })),
    ).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'bio' }] });
    expect(services.calls).toEqual([]);
  });

  it('refuses an empty qualification summary VALIDATION_FAILED before the service', async () => {
    expect(
      await refusalOf(
        surface.as('approved').teacher.profile.update({ ...UPDATE, qualificationSummary: '  ' }),
      ),
    ).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'qualificationSummary' }] });
    expect(services.calls).toEqual([]);
  });
});
