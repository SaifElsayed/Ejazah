// T034: where the session guard lands (FR-130, FR-137, screens.md "Routing"): no session → the
// welcome screen; a student → the student's tabs; a teacher → by the application's status; a
// restricted account → `restricted`. A route the state allows is left alone. T098: a restricted
// account and an applicant also reach the deletion of their own role, and nothing more.
import { describe, expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import {
  allows,
  destinationFor,
  setSession,
  type SessionState,
  signedInAs,
  useSession,
} from './session';

describe('destinationFor', () => {
  it('lands each state where the inventory says', () => {
    const cases: readonly [SessionState, string | null][] = [
      [{ kind: 'unknown' }, null],
      [{ kind: 'restoring' }, null],
      [{ kind: 'signed-out' }, '/(auth)/welcome'],
      [{ kind: 'signed-in', landing: 'student_home' }, '/(student)/(tabs)'],
      [{ kind: 'signed-in', landing: 'teacher_home' }, '/(teacher)/(tabs)'],
      [{ kind: 'signed-in', landing: 'restricted', role: 'student' }, '/restricted'],
      [{ kind: 'signed-in', landing: 'restricted', role: 'teacher' }, '/restricted'],
      [
        { kind: 'signed-in', landing: 'teacher_application', applicationStatus: 'not_started' },
        '/(teacher)/application/subjects',
      ],
      [
        { kind: 'signed-in', landing: 'teacher_application', applicationStatus: 'in_review' },
        '/(teacher)/application/status',
      ],
      [
        { kind: 'signed-in', landing: 'teacher_application', applicationStatus: 'needs_document' },
        '/(teacher)/application/more-info',
      ],
      [
        { kind: 'signed-in', landing: 'teacher_application', applicationStatus: 'rejected' },
        '/(teacher)/application/status',
      ],
      [
        { kind: 'signed-in', landing: 'teacher_application', applicationStatus: 'approved' },
        '/(teacher)/application/status',
      ],
      // A banned teacher lands on the restricted screen, never on the application (T074).
      [
        { kind: 'signed-in', landing: 'teacher_application', applicationStatus: 'banned' },
        '/restricted',
      ],
    ];
    for (const [state, destination] of cases) expect(destinationFor(state)).toBe(destination);
  });
});

it('refuses, by type, an applicant without the application status (review of B6, 3)', () => {
  // @ts-expect-error -- T034 the status is required for the application landing
  const missing: SessionState = { kind: 'signed-in', landing: 'teacher_application' };
  expect(missing.kind).toBe('signed-in');
});

describe('signedInAs', () => {
  it('lands an account where `account.me` says, the applicant by its status (T052)', () => {
    expect(signedInAs({ landing: 'student_home', role: 'student' })).toEqual({
      kind: 'signed-in',
      landing: 'student_home',
    });
    expect(
      signedInAs({
        landing: 'teacher_application',
        role: 'teacher',
        teacher: {
          applicationStatus: 'not_started',
          verificationStatus: 'pending',
          payout: { configured: false, verified: false },
        },
      }),
    ).toEqual({
      kind: 'signed-in',
      landing: 'teacher_application',
      applicationStatus: 'not_started',
    });
  });

  it('refuses an applicant landing without the teacher standing, never guessing a status', () => {
    expect(() => signedInAs({ landing: 'teacher_application', role: 'teacher' })).toThrow(
      TypeError,
    );
  });

  // T098: the restricted screen opens the deletion of the account's own role, read from
  // `account.me`'s role; the landing itself stays the server's.
  it("carries a restricted account's role, as `account.me` says it", () => {
    expect(signedInAs({ landing: 'restricted', role: 'student' })).toEqual({
      kind: 'signed-in',
      landing: 'restricted',
      role: 'student',
    });
    expect(signedInAs({ landing: 'restricted', role: 'teacher' })).toEqual({
      kind: 'signed-in',
      landing: 'restricted',
      role: 'teacher',
    });
  });
});

describe('allows', () => {
  const student: SessionState = { kind: 'signed-in', landing: 'student_home' };
  const applicant: SessionState = {
    kind: 'signed-in',
    landing: 'teacher_application',
    applicationStatus: 'in_review',
  };
  const restrictedStudent: SessionState = {
    kind: 'signed-in',
    landing: 'restricted',
    role: 'student',
  };
  const restrictedTeacher: SessionState = {
    kind: 'signed-in',
    landing: 'restricted',
    role: 'teacher',
  };
  const STUDENT_DELETE = ['(student)', 'account', 'delete'];
  const TEACHER_DELETE = ['(teacher)', 'account', 'delete'];

  it('keeps a signed-out person in the sign-in routes and the Terms', () => {
    const out: SessionState = { kind: 'signed-out' };
    expect(allows(out, ['(auth)', 'email-sign-in'])).toBe(true);
    expect(allows(out, ['terms'])).toBe(true);
    // The onboarding form opens the time-zone picker before any account exists (T051).
    expect(allows(out, ['time-zone'])).toBe(true);
    expect(allows(out, ['(student)', '(tabs)'])).toBe(false);
    expect(allows(out, [])).toBe(false);
  });

  it('keeps each role in its own group and the shared routes', () => {
    expect(allows(student, ['(student)', '(tabs)', 'discovery'])).toBe(true);
    expect(allows(student, ['notifications'])).toBe(true);
    expect(allows(student, ['(teacher)', '(tabs)'])).toBe(false);
    expect(allows(student, ['(auth)', 'welcome'])).toBe(false);
    expect(allows(student, ['restricted'])).toBe(false);
  });

  it('keeps an applicant in the application, out of the teacher tabs', () => {
    expect(allows(applicant, ['(teacher)', 'application', 'status'])).toBe(true);
    expect(allows(applicant, ['(teacher)', '(tabs)'])).toBe(false);
    expect(allows(applicant, ['terms'])).toBe(true);
  });

  // R3 T185: the privacy policy is reached as the Terms are, before and after sign-in.
  it('lets the privacy policy be opened signed out, and by every signed-in landing the Terms reach', () => {
    expect(allows({ kind: 'signed-out' }, ['privacy'])).toBe(true);
    expect(allows(student, ['privacy'])).toBe(true);
    expect(allows({ kind: 'signed-in', landing: 'teacher_home' }, ['privacy'])).toBe(true);
    expect(allows(applicant, ['privacy'])).toBe(true);
    expect(allows({ kind: 'unknown' }, ['privacy'])).toBe(false);
  });

  it('keeps a restricted account on the restricted screen', () => {
    for (const restricted of [restrictedStudent, restrictedTeacher]) {
      expect(allows(restricted, ['restricted'])).toBe(true);
      expect(allows(restricted, ['(student)', '(tabs)'])).toBe(false);
      expect(allows(restricted, ['(teacher)', '(tabs)'])).toBe(false);
      expect(allows(restricted, ['notifications'])).toBe(false);
    }
  });

  // T098 (App Store 5.1.1(v)): with the tabs closed, the deletion of the person's own role is the
  // one route added, and nothing else of the role's group (least privilege).
  it("lets a restricted account reach its own role's deletion and no other route", () => {
    expect(allows(restrictedStudent, STUDENT_DELETE)).toBe(true);
    expect(allows(restrictedStudent, TEACHER_DELETE)).toBe(false);
    expect(allows(restrictedStudent, ['(student)', 'account', 'profile'])).toBe(false);
    expect(allows(restrictedStudent, ['(student)', 'account'])).toBe(false);
    expect(allows(restrictedStudent, ['(student)', '(tabs)', 'account'])).toBe(false);
    expect(allows(restrictedStudent, [...STUDENT_DELETE, 'more'])).toBe(false);

    expect(allows(restrictedTeacher, TEACHER_DELETE)).toBe(true);
    expect(allows(restrictedTeacher, STUDENT_DELETE)).toBe(false);
    expect(allows(restrictedTeacher, ['(teacher)', 'application', 'status'])).toBe(false);
    expect(allows(restrictedTeacher, ['(teacher)', 'payout'])).toBe(false);
    expect(allows(restrictedTeacher, ['(teacher)', '(tabs)', 'account'])).toBe(false);
  });

  it("lets an applicant reach the teacher's deletion and no other account route", () => {
    for (const applicationStatus of ['in_review', 'needs_document', 'rejected'] as const) {
      const waiting: SessionState = {
        kind: 'signed-in',
        landing: 'teacher_application',
        applicationStatus,
      };
      expect(allows(waiting, TEACHER_DELETE)).toBe(true);
      expect(allows(waiting, STUDENT_DELETE)).toBe(false);
      expect(allows(waiting, ['(student)', '(tabs)'])).toBe(false);
      expect(allows(waiting, ['(teacher)', 'account', 'profile'])).toBe(false);
      expect(allows(waiting, ['(teacher)', '(tabs)', 'account'])).toBe(false);
      expect(allows(waiting, ['(teacher)', 'payout'])).toBe(false);
    }
  });

  it('lets a banned applicant, landed on the restricted screen, reach only that and its deletion', () => {
    const banned: SessionState = {
      kind: 'signed-in',
      landing: 'teacher_application',
      applicationStatus: 'banned',
    };
    expect(allows(banned, ['restricted'])).toBe(true);
    expect(allows(banned, TEACHER_DELETE)).toBe(true);
    expect(allows(banned, STUDENT_DELETE)).toBe(false);
    expect(allows(banned, ['(teacher)', 'application', 'status'])).toBe(false);
  });

  it('leaves an active account and a signed-out person as they were', () => {
    expect(allows(student, STUDENT_DELETE)).toBe(true);
    expect(allows(student, TEACHER_DELETE)).toBe(false);
    expect(allows({ kind: 'signed-in', landing: 'teacher_home' }, TEACHER_DELETE)).toBe(true);
    expect(allows({ kind: 'signed-out' }, STUDENT_DELETE)).toBe(false);
    expect(allows({ kind: 'signed-out' }, TEACHER_DELETE)).toBe(false);
    expect(allows({ kind: 'restoring' }, TEACHER_DELETE)).toBe(false);
  });

  // T097 (FR-155): a sign-up refused as a banned person's lands on `(auth)/banned` with no
  // session; a session never stays there.
  it('keeps the banned state without a session to a signed-out person', () => {
    expect(allows({ kind: 'signed-out' }, ['(auth)', 'banned'])).toBe(true);
    expect(allows(student, ['(auth)', 'banned'])).toBe(false);
    expect(allows(restrictedStudent, ['(auth)', 'banned'])).toBe(false);
    expect(allows({ kind: 'restoring' }, ['(auth)', 'banned'])).toBe(false);
  });
});

describe('the session store', () => {
  it('re-renders on a change', async () => {
    setSession({ kind: 'unknown' });
    const { result } = await renderHook(() => useSession());
    expect(result.current).toEqual({ kind: 'unknown' });
    await act(async () => setSession({ kind: 'signed-out' }));
    expect(result.current).toEqual({ kind: 'signed-out' });
  });
});
