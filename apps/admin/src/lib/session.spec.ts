// T037: the administrator's session in the browser tab and where the guard sends it (FR-170,
// FR-171; kernel.md: an unverified session is refused MFA_REQUIRED or MFA_SETUP_REQUIRED).
import { describe, expect, it, vi } from 'vitest';

import { createSessionStore, destinationFor, SESSION_STORAGE_KEY } from './session';

describe('the session store', () => {
  it('keeps the session token and its step in the tab’s sessionStorage', () => {
    const sessions = createSessionStore(() => window.sessionStorage);
    expect(sessions.read()).toBeNull();
    sessions.write({ token: 'token', step: 'mfa' });
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? '')).toEqual({
      token: 'token',
      step: 'mfa',
    });
    sessions.setStep('verified');
    expect(sessions.read()).toEqual({ token: 'token', step: 'verified' });
    sessions.clear();
    expect(sessions.read()).toBeNull();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('reads a session a reload left in the tab', () => {
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ token: 'kept', step: 'verified' }),
    );
    expect(createSessionStore(() => window.sessionStorage).read()).toEqual({
      token: 'kept',
      step: 'verified',
    });
  });

  it('reads anything else in the slot as no session', () => {
    for (const stored of ['not json', '{"token":""}', '{"token":"t","step":"admin"}', '[]']) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, stored);
      expect(createSessionStore(() => window.sessionStorage).read(), stored).toBeNull();
    }
  });

  it('holds the session for the visit when the browser refuses the store', () => {
    const refusing = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const sessions = createSessionStore(refusing);
    expect(sessions.read()).toBeNull();
    sessions.write({ token: 'token', step: 'verified' });
    expect(sessions.read()).toEqual({ token: 'token', step: 'verified' });
    sessions.clear();
    expect(sessions.read()).toBeNull();
  });

  it('tells its subscribers of every change, and keeps one snapshot between changes', () => {
    const sessions = createSessionStore(() => window.sessionStorage);
    const listener = vi.fn();
    const unsubscribe = sessions.subscribe(listener);
    sessions.write({ token: 'token', step: 'mfa' });
    expect(sessions.read()).toBe(sessions.read());
    sessions.setStep('verified');
    sessions.clear();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    sessions.write({ token: 'again', step: 'mfa' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('changes no step when there is no session', () => {
    const sessions = createSessionStore(() => window.sessionStorage);
    sessions.setStep('mfa');
    expect(sessions.read()).toBeNull();
  });
});

describe('where the guard sends a session', () => {
  const verified = { token: 't', step: 'verified' } as const;
  const mfa = { token: 't', step: 'mfa' } as const;
  const setup = { token: 't', step: 'setup' } as const;

  it.each([
    // No session: the sign-in page, and only it.
    [null, '/sign-in', null],
    [null, '/', '/sign-in'],
    [null, '/applications', '/sign-in'],
    [null, '/mfa', '/sign-in'],
    [null, '/mfa/setup', '/sign-in'],
    // Signed in, second factor owed: the code or a recovery code, and only them.
    [mfa, '/mfa', null],
    [mfa, '/mfa/recovery', null],
    [mfa, '/', '/mfa'],
    [mfa, '/audit', '/mfa'],
    [mfa, '/sign-in', '/mfa'],
    [mfa, '/mfa/setup', '/mfa'],
    // Signed in, second factor never set up: the setup, and only it.
    [setup, '/mfa/setup', null],
    [setup, '/', '/mfa/setup'],
    [setup, '/mfa', '/mfa/setup'],
    // Verified: every page, and the sign-in pages lead home.
    [verified, '/', null],
    [verified, '/settings/admins', null],
    [verified, '/sign-in', '/'],
    [verified, '/mfa', '/'],
    [verified, '/mfa/setup', '/'],
  ] as const)('%o at %s goes to %s', (session, path, destination) => {
    expect(destinationFor(session, path)).toBe(destination);
  });
});
