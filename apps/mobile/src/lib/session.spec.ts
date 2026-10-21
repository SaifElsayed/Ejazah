// T034: where the session guard lands (FR-130, FR-137, screens.md "Routing"): no session → the
// welcome screen; a student → the student's tabs; a teacher → by the application's status; a
// restricted account → `restricted`. A route the state allows is left alone.
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
      [{ kind: 'signed-in', landing: 'restricted' }, '/restricted'],
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
    expect(signedInAs({ landing: 'student_home' })).toEqual({
      kind: 'signed-in',
      landing: 'student_home',
    });
    expect(signedInAs({ landing: 'restricted' })).toEqual({
      kind: 'signed-in',
      landing: 'restricted',
    });
    expect(
      signedInAs({
        landing: 'teacher_application',
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
    expect(() => signedInAs({ landing: 'teacher_application' })).toThrow(TypeError);
  });
});

describe('allows', () => {
  const student: SessionState = { kind: 'signed-in', landing: 'student_home' };
  const applicant: SessionState = {
    kind: 'signed-in',
    landing: 'teacher_application',
    applicationStatus: 'in_review',
  };

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

  it('keeps a restricted account on the restricted screen', () => {
    const restricted: SessionState = { kind: 'signed-in', landing: 'restricted' };
    expect(allows(restricted, ['restricted'])).toBe(true);
    expect(allows(restricted, ['(student)', '(tabs)'])).toBe(false);
    expect(allows(restricted, ['notifications'])).toBe(false);
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
