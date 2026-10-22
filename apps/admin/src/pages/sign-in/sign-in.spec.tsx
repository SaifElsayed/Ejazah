// T070 (FR-170 to FR-174): the sign-in pages against the boards, in both languages, through the
// router and the guard. The password moves the session to its second factor or its setup; a refused
// sign-in keeps the email, clears the password and says one thing; the authenticator's code or a
// recovery code verifies the session; a wrong code says so in place; a session that ended meanwhile
// (`ADMIN_SIGN_IN_FAILED`) starts again at the sign-in page; the invite link's page sets the
// password from the token it carries and takes the token out of the address. The setup page draws
// the QR of a secret begun once, confirms the first code, shows the recovery codes once, and lets
// the session in only once the person says they saved them.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectDesignRules } from '../../design/components/__tests__/harness';
import { type MessageKey, setLocale, translate } from '../../i18n';
import type { AdminSession } from '../../lib/session';
import { currentPath, inBothLocales, mutation, refusal, renderApp } from '../../test/app-harness';

afterEach(() => setLocale('ar'));

function fakeAuth() {
  return {
    signIn: mutation(),
    setPassword: mutation(),
    mfa: {
      verify: mutation(),
      recover: mutation(),
      setup: { begin: mutation(), confirm: mutation() },
    },
  };
}

function renderAt(
  path: string,
  session: AdminSession | null = null,
  {
    strict = false,
    arrange = () => undefined,
  }: {
    readonly strict?: boolean;
    /** What the procedures answer, set before the first render (the setup page begins at once). */
    readonly arrange?: (auth: ReturnType<typeof fakeAuth>) => void;
  } = {},
) {
  const auth = fakeAuth();
  arrange(auth);
  return { ...renderApp({ at: path, session, api: { auth }, strict }), auth };
}

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const heading = (key: MessageKey) => screen.getByRole('heading', { level: 1, name: ar(key) });
const field = (key: MessageKey) => screen.getByLabelText(ar(key));
const type = (key: MessageKey, value: string) =>
  fireEvent.change(field(key), { target: { value } });
const press = (key: MessageKey) => fireEvent.click(screen.getByRole('button', { name: ar(key) }));
const typeCode = (code: string) =>
  fireEvent.change(screen.getByLabelText(ar('admin.common.a11y.digit1')), {
    target: { value: code },
  });

describe('AdminSignIn (FR-170)', () => {
  it('draws the board in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      setLocale(locale);
      const { view } = renderAt('/sign-in');
      const t = (key: MessageKey) => translate(locale, key);
      expect(screen.getByRole('heading', { level: 1, name: t('admin.signIn.title') })).toBeTruthy();
      expect(screen.getByText(t('admin.signIn.lede'))).toBeTruthy();
      expect(screen.getByLabelText(t('admin.signIn.email'))).toBeTruthy();
      expect(screen.getByLabelText(t('admin.signIn.password'))).toBeTruthy();
      expect(screen.getByRole('button', { name: t('admin.signIn.continue') })).toBeTruthy();
      expectDesignRules(view.container);
      view.unmount();
    }
  });

  it('moves the session to its second factor', async () => {
    const { auth, sessions } = renderAt('/sign-in');
    auth.signIn.mutate.mockResolvedValue({ next: 'mfa', sessionToken: 'pending-1' });
    type('admin.signIn.email', 'sara@example.com');
    type('admin.signIn.password', 'correct horse');
    press('admin.signIn.continue');
    expect(
      await screen.findByRole('heading', { level: 1, name: ar('admin.mfa.title') }),
    ).toBeTruthy();
    expect(auth.signIn.mutate).toHaveBeenCalledWith({
      email: 'sara@example.com',
      password: 'correct horse',
    });
    expect(sessions.read()).toEqual({ token: 'pending-1', step: 'mfa' });
  });

  it('moves a first sign-in to the setup', async () => {
    const { auth, sessions } = renderAt('/sign-in');
    auth.signIn.mutate.mockResolvedValue({ next: 'setup', sessionToken: 'pending-2' });
    auth.mfa.setup.begin.mutate.mockReturnValue(new Promise(() => undefined));
    type('admin.signIn.email', 'sara@example.com');
    type('admin.signIn.password', 'correct horse');
    press('admin.signIn.continue');
    await waitFor(() => expect(sessions.read()).toEqual({ token: 'pending-2', step: 'setup' }));
  });

  it('keeps the email, clears the password and says one thing when refused (AdminSignInError)', async () => {
    const { auth, sessions } = renderAt('/sign-in');
    auth.signIn.mutate.mockRejectedValue(refusal('ADMIN_SIGN_IN_FAILED'));
    type('admin.signIn.email', 'sara@example.com');
    type('admin.signIn.password', 'wrong');
    press('admin.signIn.continue');
    expect(await screen.findByText(ar('admin.signIn.error'))).toBeTruthy();
    expect((field('admin.signIn.email') as HTMLInputElement).value).toBe('sara@example.com');
    expect((field('admin.signIn.password') as HTMLInputElement).value).toBe('');
    expect(sessions.read()).toBeNull();
  });
});

describe('AdminMfa (FR-171)', () => {
  const pending = { token: 'pending-1', step: 'mfa' } as const;

  it('draws the board in both languages', async () => {
    await inBothLocales(
      () => renderAt('/mfa', pending),
      (t) => {
        expect(screen.getByRole('heading', { level: 1, name: t('admin.mfa.title') })).toBeTruthy();
        expect(screen.getByText(t('admin.mfa.lede'))).toBeTruthy();
        expect(screen.getByText(t('admin.mfa.refreshHint', { seconds: 30 }))).toBeTruthy();
        expect(screen.getByRole('button', { name: t('admin.mfa.useRecoveryCode') })).toBeTruthy();
      },
    );
  });

  it('verifies the session by the code and goes home', async () => {
    const { auth, sessions } = renderAt('/mfa', pending);
    auth.mfa.verify.mutate.mockResolvedValue(undefined);
    typeCode('123456');
    press('admin.mfa.signIn');
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(sessions.read()?.step).toBe('verified');
    expect(auth.mfa.verify.mutate).toHaveBeenCalledWith({
      sessionToken: 'pending-1',
      code: '123456',
    });
  });

  it('says a wrong code in place and clears it', async () => {
    const { auth, sessions } = renderAt('/mfa', pending);
    auth.mfa.verify.mutate.mockRejectedValue(refusal('CODE_INVALID'));
    typeCode('000000');
    press('admin.mfa.signIn');
    expect(await screen.findByText(ar('admin.mfa.codeInvalid'))).toBeTruthy();
    expect(sessions.read()).toEqual(pending);
    expect((screen.getByLabelText(ar('admin.common.a11y.digit1')) as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('starts again at the sign-in page when the session ended meanwhile', async () => {
    const { auth, sessions } = renderAt('/mfa', pending);
    auth.mfa.verify.mutate.mockRejectedValue(refusal('ADMIN_SIGN_IN_FAILED'));
    typeCode('123456');
    press('admin.mfa.signIn');
    expect(await screen.findByText(ar('admin.signIn.sessionExpired'))).toBeTruthy();
    expect(heading('admin.signIn.title')).toBeTruthy();
    expect(sessions.read()).toBeNull();
  });

  it('says the session ended once only: a later visit to the sign-in page is plain', async () => {
    const { auth, view } = renderAt('/mfa', pending);
    auth.mfa.verify.mutate.mockRejectedValue(refusal('ADMIN_SIGN_IN_FAILED'));
    typeCode('123456');
    press('admin.mfa.signIn');
    expect(await screen.findByText(ar('admin.signIn.sessionExpired'))).toBeTruthy();
    view.unmount();
    renderAt('/sign-in');
    expect(heading('admin.signIn.title')).toBeTruthy();
    expect(screen.queryByText(ar('admin.signIn.sessionExpired'))).toBeNull();
  });

  it('waits for six digits, and goes back to the sign-in page', () => {
    const { auth, sessions } = renderAt('/mfa', pending);
    typeCode('123');
    expect(screen.getByRole('button', { name: ar('admin.mfa.signIn') })).toHaveProperty(
      'disabled',
      true,
    );
    press('admin.mfa.backToSignIn');
    expect(auth.mfa.verify.mutate).not.toHaveBeenCalled();
    expect(sessions.read()).toBeNull();
    expect(heading('admin.signIn.title')).toBeTruthy();
  });

  it('opens the recovery-code page', () => {
    renderAt('/mfa', pending);
    press('admin.mfa.useRecoveryCode');
    expect(heading('admin.mfaRecovery.title')).toBeTruthy();
  });
});

describe('AdminMfaRecovery', () => {
  const pending = { token: 'pending-1', step: 'mfa' } as const;

  it('draws the board in both languages', async () => {
    await inBothLocales(
      () => renderAt('/mfa/recovery', pending),
      (t) => {
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.mfaRecovery.title') }),
        ).toBeTruthy();
        expect(screen.getByText(t('admin.mfaRecovery.lede'))).toBeTruthy();
        expect(screen.getByText(t('admin.mfaRecovery.lostHint'))).toBeTruthy();
      },
    );
  });

  it('verifies the session by a recovery code and goes home', async () => {
    const { auth, sessions } = renderAt('/mfa/recovery', pending);
    auth.mfa.recover.mutate.mockResolvedValue({ remainingCodes: 9 });
    type('admin.mfaRecovery.codeLabel', '4F7K-29QX');
    press('admin.mfaRecovery.signIn');
    await waitFor(() => expect(sessions.read()?.step).toBe('verified'));
    expect(auth.mfa.recover.mutate).toHaveBeenCalledWith({
      sessionToken: 'pending-1',
      recoveryCode: '4F7K-29QX',
    });
  });

  it('says a wrong or used code in place', async () => {
    const { auth } = renderAt('/mfa/recovery', pending);
    auth.mfa.recover.mutate.mockRejectedValue(refusal('CODE_INVALID'));
    type('admin.mfaRecovery.codeLabel', 'AAAA-BBBB');
    press('admin.mfaRecovery.signIn');
    expect(await screen.findByText(ar('admin.mfaRecovery.codeInvalid'))).toBeTruthy();
  });

  it('goes back to the app code', () => {
    renderAt('/mfa/recovery', pending);
    press('admin.mfaRecovery.backToAppCode');
    expect(heading('admin.mfa.title')).toBeTruthy();
  });
});

describe('AdminSetPassword (the invite link, R-110)', () => {
  it('draws its page with no session in both languages, and takes the token out of the address', async () => {
    await inBothLocales(
      () => renderAt('/set-password#token=invite-1'),
      (t) => {
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.setPassword.title') }),
        ).toBeTruthy();
        expect(screen.getByText(t('admin.setPassword.lede'))).toBeTruthy();
        expect(screen.getByText(t('admin.setPassword.hint', { min: 8, max: 128 }))).toBeTruthy();
        expect(screen.getByLabelText(t('admin.setPassword.confirm'))).toBeTruthy();
        expect(currentPath()).toBe('/set-password');
      },
    );
  });

  it('sets the password from the token, then lands on the sign-in page saying so', async () => {
    const { auth } = renderAt('/set-password#token=invite-1');
    auth.setPassword.mutate.mockResolvedValue(undefined);
    type('admin.setPassword.password', 'a long passphrase');
    type('admin.setPassword.confirm', 'a long passphrase');
    press('admin.setPassword.save');
    expect(await screen.findByText(ar('admin.signIn.passwordSet'))).toBeTruthy();
    expect(heading('admin.signIn.title')).toBeTruthy();
    expect(auth.setPassword.mutate).toHaveBeenCalledWith({
      inviteToken: 'invite-1',
      password: 'a long passphrase',
    });
  });

  it('reads a token from the query too, and takes it out', () => {
    renderAt('/set-password?token=invite-2');
    expect(heading('admin.setPassword.title')).toBeTruthy();
    expect(currentPath()).toBe('/set-password');
  });

  it('opens with a session too: it works by the token', () => {
    renderAt('/set-password#token=invite-1', { token: 't', step: 'verified' });
    expect(heading('admin.setPassword.title')).toBeTruthy();
  });

  it('refuses two passwords that differ, and one out of bounds, before sending', () => {
    const { auth } = renderAt('/set-password#token=invite-1');
    type('admin.setPassword.password', 'a long passphrase');
    type('admin.setPassword.confirm', 'a long passphrasf');
    press('admin.setPassword.save');
    expect(screen.getByText(ar('admin.setPassword.mismatch'))).toBeTruthy();
    type('admin.setPassword.password', 'short');
    type('admin.setPassword.confirm', 'short');
    expect(screen.getByRole('button', { name: ar('admin.setPassword.save') })).toHaveProperty(
      'disabled',
      true,
    );
    expect(auth.setPassword.mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['INVITE_INVALID', 'admin.setPassword.inviteInvalid'],
    ['PASSWORD_WEAK', 'admin.setPassword.weak'],
    ['INTERNAL', 'admin.setPassword.failed'],
  ] as const)('says %s in place', async (code, key) => {
    const { auth } = renderAt('/set-password#token=invite-1');
    auth.setPassword.mutate.mockRejectedValue(refusal(code));
    type('admin.setPassword.password', 'a long passphrase');
    type('admin.setPassword.confirm', 'a long passphrase');
    press('admin.setPassword.save');
    expect(await screen.findByText(ar(key))).toBeTruthy();
  });

  it('says the link is invalid when it carries no token', () => {
    renderAt('/set-password');
    expect(screen.getByText(ar('admin.setPassword.inviteInvalid'))).toBeTruthy();
    expect(screen.queryByLabelText(ar('admin.setPassword.password'))).toBeNull();
  });
});

describe('AdminMfaSetup (FR-171)', () => {
  const first = { token: 'pending-3', step: 'setup' } as const;
  const begun = {
    otpauthUri:
      'otpauth://totp/Ijazah:sara.adel%2Bops%40example.com?secret=ABCDABCDABCDABCD&issuer=Ijazah',
    manualKey: 'ABCDABCDABCDABCD',
  };
  const codes = ['4F7K29QX', 'M8TD3HZP', 'Q2NW7CJR'];

  it('begins the secret once, even in strict mode', async () => {
    const { auth } = renderAt('/mfa/setup', first, {
      strict: true,
      arrange: (auth) => {
        auth.mfa.setup.begin.mutate.mockResolvedValue(begun);
      },
    });
    expect(await screen.findByText('ABCDABCDABCDABCD')).toBeTruthy();
    expect(auth.mfa.setup.begin.mutate).toHaveBeenCalledTimes(1);
    expect(auth.mfa.setup.begin.mutate).toHaveBeenCalledWith({ sessionToken: 'pending-3' });
  });

  it('draws the three steps in both languages, with the QR, the key and the email from the URI', async () => {
    await inBothLocales(
      () =>
        renderAt('/mfa/setup', first, {
          arrange: (auth) => {
            auth.mfa.setup.begin.mutate.mockResolvedValue(begun);
          },
        }),
      async (t) => {
        expect(await screen.findByText('ABCDABCDABCDABCD')).toBeTruthy();
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.mfaSetup.title') }),
        ).toBeTruthy();
        expect(
          screen.getByText(t('admin.mfaSetup.lede', { email: 'sara.adel+ops@example.com' })),
        ).toBeTruthy();
        expect(screen.getByRole('img', { name: t('admin.mfaSetup.step1.a11y.qr') })).toBeTruthy();
        expect(screen.getByText(t('admin.mfaSetup.step1.qrCaption'))).toBeTruthy();
        for (const key of [
          'admin.mfaSetup.step1.title',
          'admin.mfaSetup.step2.title',
          'admin.mfaSetup.step3.title',
        ] as const) {
          expect(screen.getByText(t(key))).toBeTruthy();
        }
        expect(screen.getByRole('button', { name: t('admin.mfaSetup.finish') })).toHaveProperty(
          'disabled',
          true,
        );
      },
    );
  });

  it('confirms the first code, shows the codes once, and lets the session in once they are saved', async () => {
    const { auth, sessions } = renderAt('/mfa/setup', first, {
      arrange: (auth) => {
        auth.mfa.setup.begin.mutate.mockResolvedValue(begun);
        auth.mfa.setup.confirm.mutate.mockResolvedValue({ recoveryCodes: codes });
      },
    });
    await screen.findByText('ABCDABCDABCDABCD');
    typeCode('581047');
    expect(await screen.findByText(ar('admin.mfaSetup.step2.verified'))).toBeTruthy();
    expect(auth.mfa.setup.confirm.mutate).toHaveBeenCalledWith({
      sessionToken: 'pending-3',
      code: '581047',
    });
    for (const code of codes) expect(screen.getByText(code)).toBeTruthy();
    const finish = screen.getByRole('button', { name: ar('admin.mfaSetup.finish') });
    expect(finish).toHaveProperty('disabled', true);
    expect(sessions.read()?.step).toBe('setup');
    fireEvent.click(
      screen.getByRole('checkbox', { name: ar('admin.mfaSetup.step3.savedConfirm') }),
    );
    fireEvent.click(finish);
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(sessions.read()?.step).toBe('verified');
  });

  it('copies the key and the codes, and downloads the codes as a text file', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const made: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      made.push(blob);
      return 'blob:codes';
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const { auth } = renderAt('/mfa/setup', first, {
      arrange: (auth) => {
        auth.mfa.setup.begin.mutate.mockResolvedValue(begun);
        auth.mfa.setup.confirm.mutate.mockResolvedValue({ recoveryCodes: codes });
      },
    });
    await screen.findByText('ABCDABCDABCDABCD');
    fireEvent.click(screen.getByRole('button', { name: ar('admin.mfaSetup.step1.a11y.copyKey') }));
    expect(writeText).toHaveBeenLastCalledWith('ABCDABCDABCDABCD');
    typeCode('581047');
    await screen.findByText(codes[0] ?? '');
    press('admin.mfaSetup.step3.copy');
    expect(writeText).toHaveBeenLastCalledWith(codes.join('\n'));
    press('admin.mfaSetup.step3.download');
    expect(made).toHaveLength(1);
    expect(await made[0]?.text()).toBe(`${codes.join('\n')}\n`);
    // The address is let go only after the browser took the download (Safari cancels it otherwise).
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:codes'));
  });

  it('says a wrong first code in place, with no codes', async () => {
    const { auth } = renderAt('/mfa/setup', first, {
      arrange: (auth) => {
        auth.mfa.setup.begin.mutate.mockResolvedValue(begun);
        auth.mfa.setup.confirm.mutate.mockRejectedValue(refusal('CODE_INVALID'));
      },
    });
    await screen.findByText('ABCDABCDABCDABCD');
    typeCode('000000');
    expect(await screen.findByText(ar('admin.mfa.codeInvalid'))).toBeTruthy();
    expect(screen.queryByText(ar('admin.mfaSetup.step2.verified'))).toBeNull();
  });

  it('owes the code of an account another sign-in set up meanwhile (FORBIDDEN on begin)', async () => {
    const { sessions } = renderAt('/mfa/setup', first, {
      arrange: (auth) => {
        auth.mfa.setup.begin.mutate.mockRejectedValue(refusal('FORBIDDEN'));
      },
    });
    await waitFor(() => expect(currentPath()).toBe('/mfa'));
    expect(sessions.read()).toEqual({ token: 'pending-3', step: 'mfa' });
  });

  it('offers a retry when the setup cannot begin', async () => {
    const { auth } = renderAt('/mfa/setup', first, {
      arrange: (auth) => {
        auth.mfa.setup.begin.mutate.mockRejectedValueOnce(refusal('INTERNAL'));
        auth.mfa.setup.begin.mutate.mockResolvedValueOnce(begun);
      },
    });
    expect(await screen.findByText(ar('admin.mfaSetup.loadError'))).toBeTruthy();
    press('admin.common.action.retry');
    expect(await screen.findByText('ABCDABCDABCDABCD')).toBeTruthy();
  });

  it('starts again at the sign-in page when the session ended meanwhile', async () => {
    const { auth, sessions } = renderAt('/mfa/setup', first, {
      arrange: (auth) => {
        auth.mfa.setup.begin.mutate.mockRejectedValue(refusal('ADMIN_SIGN_IN_FAILED'));
      },
    });
    expect(await screen.findByText(ar('admin.signIn.sessionExpired'))).toBeTruthy();
    expect(sessions.read()).toBeNull();
  });

  it('goes back to the sign-in page', async () => {
    const { auth, sessions } = renderAt('/mfa/setup', first, {
      arrange: (auth) => {
        auth.mfa.setup.begin.mutate.mockResolvedValue(begun);
      },
    });
    await screen.findByText('ABCDABCDABCDABCD');
    press('admin.mfaSetup.backToSignIn');
    expect(sessions.read()).toBeNull();
    expect(heading('admin.signIn.title')).toBeTruthy();
  });
});
