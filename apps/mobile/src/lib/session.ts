// T034: what the session guard knows about the person and where it lands them (FR-130, FR-137,
// screens.md "Routing"). The state is set by whoever learns it: the root layout reads the stored
// tokens at launch, the client signs out on a refused refresh (lib/client.ts), and B10 wires the
// sign-in procedures and `account.me` that say where a session lands (`landing`, contracts/auth.ts).
// The guard reads it through `useSession()` and decides with `destinationFor` and `allows`.
import type { Landing, MeOutput, TeacherApplicationStatus } from '@ijazah/contracts';
import { useSyncExternalStore } from 'react';

export type SessionState =
  /** Launch, before the stored tokens are read. */
  | { readonly kind: 'unknown' }
  /** Tokens are stored; where they land is being asked of the server. */
  | { readonly kind: 'restoring' }
  | { readonly kind: 'signed-out' }
  | {
      readonly kind: 'signed-in';
      readonly landing: Exclude<Landing, 'teacher_application'>;
    }
  | {
      readonly kind: 'signed-in';
      readonly landing: 'teacher_application';
      /**
       * The application's status (`account.me`): required, so an applicant is never landed on a
       * new application form for want of it (review of B6, finding 3).
       */
      readonly applicationStatus: TeacherApplicationStatus;
    };

const WELCOME = '/(auth)/welcome';
const RESTRICTED = '/restricted';

/** The application screen each status lands on (screens.md, the application rows). */
const applicationRoute: Readonly<Record<TeacherApplicationStatus, string>> = {
  not_started: '/(teacher)/application/subjects',
  in_review: '/(teacher)/application/status',
  needs_document: '/(teacher)/application/more-info',
  rejected: '/(teacher)/application/status',
  approved: '/(teacher)/application/status',
  // A banned account lands on the restricted screen, never on the application (T074).
  banned: RESTRICTED,
};

/** Where `state` lands; null while the session is not known yet. */
export function destinationFor(state: SessionState): string | null {
  switch (state.kind) {
    case 'unknown':
    case 'restoring':
      return null;
    case 'signed-out':
      return WELCOME;
    case 'signed-in':
      switch (state.landing) {
        case 'student_home':
          return '/(student)/(tabs)';
        case 'teacher_home':
          return '/(teacher)/(tabs)';
        case 'restricted':
          return RESTRICTED;
        case 'teacher_application':
          return applicationRoute[state.applicationStatus];
      }
  }
}

/**
 * The guard's state for a signed-in account, from `account.me` (T052): the landing is the server's
 * rule, read, never recomputed here; an applicant carries its application's status.
 */
export function signedInAs(
  me: Pick<MeOutput, 'landing'> & Partial<Pick<MeOutput, 'teacher'>>,
): SessionState {
  if (me.landing !== 'teacher_application') return { kind: 'signed-in', landing: me.landing };
  if (me.teacher === undefined) {
    throw new TypeError('session: an applicant landing without the teacher standing');
  }
  return {
    kind: 'signed-in',
    landing: 'teacher_application',
    applicationStatus: me.teacher.applicationStatus,
  };
}

/** The routes a signed-out person reaches: sign-in and onboarding, and their two modals (T051). */
const SIGNED_OUT = new Set(['(auth)', 'terms', 'time-zone']);

/** The routes outside the role groups every signed-in person reaches (screens.md "Routes"). */
const SHARED = new Set([
  'session',
  'chat',
  'notifications',
  'time-zone',
  'terms',
  'verify-identity',
]);

/** True when the route at `segments` is one `state` may stay on; otherwise the guard lands it. */
export function allows(state: SessionState, segments: readonly string[]): boolean {
  const [root, next] = segments;
  if (root === undefined) return false;
  if (state.kind === 'signed-out') return SIGNED_OUT.has(root);
  if (state.kind !== 'signed-in') return false;
  const destination = destinationFor(state);
  if (destination === RESTRICTED) return root === 'restricted';
  if (state.landing === 'teacher_application') {
    return (root === '(teacher)' && next === 'application') || SHARED.has(root);
  }
  const group = state.landing === 'student_home' ? '(student)' : '(teacher)';
  return root === group || SHARED.has(root);
}

let current: SessionState = { kind: 'unknown' };
const listeners = new Set<() => void>();

/** The session state now. */
export function getSession(): SessionState {
  return current;
}

/** Replaces the session state; every `useSession` re-renders. */
export function setSession(next: SessionState): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The session state, re-rendering on a change. */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSession, getSession);
}
