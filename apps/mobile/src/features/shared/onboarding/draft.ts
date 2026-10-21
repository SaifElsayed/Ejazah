// T051 (FR-124 to FR-127): what the onboarding holds on the device until `onboarding.complete`
// creates the account. Nothing of the person is stored on the server before that (ADR 0012 D4),
// and nothing here is written to the device's storage: the draft lives in memory, the onboarding
// token with it (it is single-use and expires), and the email account's password is held only to be
// sent with `complete` (app-surface.md, "The email sign-up path"). It is cleared once the account
// exists, and a new sign-in replaces it.
import type { Gender, Role } from '@ijazah/contracts';
import { useSyncExternalStore } from 'react';

export interface OnboardingDraft {
  readonly onboardingToken: string;
  /** An email account proved its address by a code; a provider account through its token. */
  readonly identity: 'email' | 'provider';
  /** False for a provider account whose provider reported no verified address (FR-122). */
  readonly emailVerified: boolean;
  /** The address: the verified one, or the one the person types to prove it. */
  readonly email: string;
  readonly emailCode: string;
  /** The email account's chosen password, sent once with `complete`. */
  readonly password?: string;
  readonly role?: Role;
  readonly displayName: string;
  readonly gender?: Gender;
  /** `YYYY-MM-DD`. */
  readonly dateOfBirth?: string;
  /** The zone chosen, or the device's; null when the device's is no zone a person lives by. */
  readonly timezone: string | null;
  readonly termsAccepted: boolean;
}

/** How a sign-in starts an onboarding. */
export interface OnboardingStart {
  readonly onboardingToken: string;
  readonly identity: 'email' | 'provider';
  readonly emailVerified: boolean;
  readonly email?: string | undefined;
  readonly displayName?: string | undefined;
  readonly password?: string | undefined;
  readonly timezone: string | null;
}

let current: OnboardingDraft | null = null;
const listeners = new Set<() => void>();

function emit(next: OnboardingDraft | null): void {
  current = next;
  for (const listener of listeners) listener();
}

/** Starts a draft for a new person, replacing any earlier one. */
export function startOnboarding(start: OnboardingStart): void {
  emit({
    onboardingToken: start.onboardingToken,
    identity: start.identity,
    emailVerified: start.emailVerified,
    email: start.email ?? '',
    emailCode: '',
    ...(start.password === undefined ? {} : { password: start.password }),
    displayName: start.displayName ?? '',
    timezone: start.timezone,
    termsAccepted: false,
  });
}

/** Changes the draft; nothing when no onboarding is under way. */
export function updateDraft(patch: Partial<Omit<OnboardingDraft, 'onboardingToken'>>): void {
  if (current !== null) emit({ ...current, ...patch });
}

/** Forgets the draft, the password with it. */
export function clearDraft(): void {
  emit(null);
}

export function getDraft(): OnboardingDraft | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The draft, re-rendering on a change. */
export function useDraft(): OnboardingDraft | null {
  return useSyncExternalStore(subscribe, getDraft, getDraft);
}
