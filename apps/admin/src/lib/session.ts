// T037: the administrator's session in the browser tab, and where the guard sends it.
//
// THE SESSION. `auth.signIn` answers a session token and the next step (`mfa` or `setup`,
// admin-surface.md); the second factor marks the same session verified. The token is the bearer of
// every call (lib/client.ts) and lives in the tab's sessionStorage, so it ends with the tab and is
// never shared with another one; the step is kept beside it, so a reload lands on the right page.
// A store the browser refuses (a private window, blocked site data) holds the session for the visit
// in memory. The step is the client's guess only: the server refuses an unverified session on every
// call, and the client moves the step by the code it refused with (MFA_REQUIRED,
// MFA_SETUP_REQUIRED, UNAUTHENTICATED).
//
// THE GUARD. `destinationFor` is the whole rule, one row per state: no session reaches the sign-in
// page only; a session owed its code reaches `/mfa` and `/mfa/recovery`; a session never set up
// reaches `/mfa/setup`; a verified session reaches every console page, and the sign-in pages lead
// it home.
import { useSyncExternalStore } from 'react';

export type SessionStep = 'verified' | 'mfa' | 'setup';

export interface AdminSession {
  readonly token: string;
  readonly step: SessionStep;
}

/** Where the tab keeps the session. */
export const SESSION_STORAGE_KEY = 'ijazah.admin.session';

/** The pages a session that is not verified may reach (screens.md §17). */
export const AUTH_PATHS = {
  signIn: '/sign-in',
  mfa: '/mfa',
  recovery: '/mfa/recovery',
  setup: '/mfa/setup',
} as const;

export const HOME_PATH = '/';

export interface SessionStore {
  read(): AdminSession | null;
  write(session: AdminSession): void;
  /** Moves the current session to `step`; nothing without a session. */
  setStep(step: SessionStep): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

const STEPS: readonly SessionStep[] = ['verified', 'mfa', 'setup'];

function parse(raw: string | null): AdminSession | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { token, step } = value as { token?: unknown; step?: unknown };
    if (typeof token !== 'string' || token === '') return null;
    if (!STEPS.includes(step as SessionStep)) return null;
    return { token, step: step as SessionStep };
  } catch {
    return null;
  }
}

/** A session store over `storage`, which may throw (the browser refusing the store). */
export function createSessionStore(storage: () => Storage): SessionStore {
  let current: AdminSession | null;
  try {
    current = parse(storage().getItem(SESSION_STORAGE_KEY));
  } catch {
    current = null;
  }
  const listeners = new Set<() => void>();

  const persist = () => {
    try {
      if (current === null) storage().removeItem(SESSION_STORAGE_KEY);
      else storage().setItem(SESSION_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // The browser refuses the store: the session holds for this visit.
    }
  };
  const change = (next: AdminSession | null) => {
    current = next;
    persist();
    for (const listener of listeners) listener();
  };

  return {
    read: () => current,
    write: (session) => change({ token: session.token, step: session.step }),
    setStep: (step) => {
      if (current !== null && current.step !== step) change({ token: current.token, step });
    },
    clear: () => change(null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The session in `sessions`, re-rendering on a change. */
export function useSession(sessions: SessionStore): AdminSession | null {
  return useSyncExternalStore(sessions.subscribe, sessions.read, sessions.read);
}

const SECOND_FACTOR: readonly string[] = [AUTH_PATHS.mfa, AUTH_PATHS.recovery];
const AUTH: readonly string[] = Object.values(AUTH_PATHS);

/** Where a session at `pathname` must go, or null when it may stay. */
export function destinationFor(session: AdminSession | null, pathname: string): string | null {
  if (session === null) return pathname === AUTH_PATHS.signIn ? null : AUTH_PATHS.signIn;
  switch (session.step) {
    case 'mfa':
      return SECOND_FACTOR.includes(pathname) ? null : AUTH_PATHS.mfa;
    case 'setup':
      return pathname === AUTH_PATHS.setup ? null : AUTH_PATHS.setup;
    case 'verified':
      return AUTH.includes(pathname) ? HOME_PATH : null;
  }
}
