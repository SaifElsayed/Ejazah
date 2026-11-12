// T058 of specs/004-sessions — the `users` schemas of contracts/admin-surface.md, "`users`" (FR-481,
// FR-459, FR-451; SRS FR-ADMIN-4). Written before the schemas, and run red first.
//
// `users.list` takes the start of a name and a cursor, and answers each user's id, name (null for a
// deleted one, FR-426), deleted flag, role and account status. `users.get` names the person as
// `targetUserId` (a `userId` key is refused in any input, R-GENDER-4, as `users.requireIdentity`'s
// `targetUserId`) and answers FR-ADMIN-4's fields exactly: no date of birth, which is read only to
// derive `isMinor` and never crosses (PDPL: a minor's data is sensitive; the reviewer's requirement).
import { describe, expect, it } from 'vitest';

import { usersGetInput, usersGetOutput, usersListInput, usersListOutput } from './users.js';

const USER = '0199d0a0-0000-7000-8000-0000000000c1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000c2';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';

const TEACHER_RECORD = {
  userId: USER,
  profile: {
    displayName: 'سارة',
    email: 'sara@example.test',
    joinedAt: '2026-09-01T08:00:00.000Z',
    deleted: false,
    teacher: { bio: 'معلمة قرآن', qualification: 'إجازة برواية حفص' },
  },
  role: 'teacher',
  gender: 'female',
  isMinor: false,
  verificationStatus: 'approved',
  accountStatus: 'active',
  cancellationRequests: { total: 3, recent: 1 },
  repeatedAbsences: [
    {
      enrollmentId: ENROLLMENT,
      student: { userId: STUDENT, displayName: null, deleted: true },
      status: 'confirmed',
      teacherNoShows: 5,
    },
  ],
};

describe('users.list', () => {
  it('takes an optional name, trimmed, and an optional cursor', () => {
    expect(usersListInput.parse({ name: '  سا  ', cursor: USER })).toEqual({
      name: 'سا',
      cursor: USER,
    });
    expect(usersListInput.parse({})).toEqual({});
  });

  it.each([
    ['a blank name', { name: '   ' }],
    ['a name over 100 characters', { name: 'ا'.repeat(101) }],
    ['a cursor that is no id', { cursor: 'x' }],
  ])('refuses %s', (_name, input) => {
    expect(usersListInput.safeParse(input).success).toBe(false);
  });

  it('answers each user with the name, null for a deleted one, the role and the account status', () => {
    const page = {
      items: [
        {
          userId: USER,
          displayName: 'سارة',
          deleted: false,
          role: 'teacher',
          accountStatus: 'active',
        },
        {
          userId: STUDENT,
          displayName: null,
          deleted: true,
          role: 'student',
          accountStatus: 'banned',
        },
      ],
      nextCursor: STUDENT,
    };
    expect(usersListOutput.parse(page)).toEqual(page);
  });
});

describe('users.get', () => {
  it('names the person as targetUserId, never userId', () => {
    expect(usersGetInput.parse({ targetUserId: USER })).toEqual({ targetUserId: USER });
    expect(Object.keys(usersGetInput.shape)).toEqual(['targetUserId']);
  });

  it("answers a teacher's record with FR-ADMIN-4's fields, the counts and the marked enrollments", () => {
    expect(usersGetOutput.parse(TEACHER_RECORD)).toEqual(TEACHER_RECORD);
  });

  it("answers a student's record without a teacher's profile or repeatedAbsences", () => {
    const student = {
      ...TEACHER_RECORD,
      profile: { ...TEACHER_RECORD.profile, teacher: undefined },
      role: 'student',
      isMinor: true,
      verificationStatus: null,
      repeatedAbsences: undefined,
    };
    const { repeatedAbsences: _absent, ...withoutAbsences } = student;
    const { teacher: _none, ...profile } = student.profile;
    expect(usersGetOutput.parse({ ...withoutAbsences, profile })).toEqual({
      ...withoutAbsences,
      profile,
    });
  });

  it('has no date-of-birth field, and drops one a service would answer (PDPL)', () => {
    const keysOf = (shape: Record<string, unknown>): string[] => Object.keys(shape);
    const all = [...keysOf(usersGetOutput.shape), ...keysOf(usersGetOutput.shape.profile.shape)];
    expect(all.filter((key) => /birth|dob/i.test(key))).toEqual([]);
    const leaked = usersGetOutput.parse({
      ...TEACHER_RECORD,
      dateOfBirth: '2012-03-04',
      profile: { ...TEACHER_RECORD.profile, dateOfBirth: '2012-03-04' },
    });
    expect(JSON.stringify(leaked)).not.toContain('2012-03-04');
  });

  it.each([
    ['a negative count', { cancellationRequests: { total: -1, recent: 0 } }],
    [
      'a joinedAt that is no instant',
      { profile: { ...TEACHER_RECORD.profile, joinedAt: 'yesterday' } },
    ],
    ['an unknown verification status', { verificationStatus: 'maybe' }],
  ])('refuses %s', (_name, change) => {
    expect(usersGetOutput.safeParse({ ...TEACHER_RECORD, ...change }).success).toBe(false);
  });
});
