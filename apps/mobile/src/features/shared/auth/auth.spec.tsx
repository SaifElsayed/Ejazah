// T050 (FR-120 to FR-123, FR-129): the sign-in screens against the boards, in both languages, and
// what each action asks of the API. A sign-in that yields a session stores the two tokens and hands
// the landing to the guard (`restoring`, then `account.me`); one that yields an onboarding token
// starts the onboarding draft and opens Role; an email that belongs to another method opens the
// conflict sheet naming that method, never linking the accounts.
//
// T097 (FR-155): a new account refused with `ACCOUNT_RESTRICTED` (the identifiers of a banned
// person's deleted account) lands on the signed-out banned state, storing no session, no draft and
// no password; any other refusal keeps its message.
//
// T106: Welcome paints the theme's background itself, in both schemes, since the navigation stack
// beneath it draws React Navigation's light default.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Platform } from 'react-native';

import {
  colour,
  inBothDirections,
  renderIn,
  styleOf,
} from '../../../design/primitives/__tests__/harness';
import type { ColorScheme } from '../../../design/tokens';
import { getLocale, type MessageKey, type MessageValues, translate } from '../../../i18n';
import { getSession, setSession } from '../../../lib/session';
import { clearDraft, getDraft } from '../onboarding/draft';
import { apiError, fakeApi, tokens } from '../__tests__/api-double';
import { EmailSignIn, EmailSignUp, ForgotPassword, Otp, ResetPassword, Welcome } from './index';
import { clearPendingEmail, getPendingEmail, setPendingEmail } from './pending';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate(route),
    replace: (route: unknown) => mockNavigate(route),
    back: () => mockNavigate('back'),
  },
  useLocalSearchParams: () => mockParams,
}));

const mockIdentity = jest.fn<(provider: string, nonce: string) => Promise<unknown>>();
let mockDevEnabled = false;
// B50 T148: one case runs the real providers over Google's mocked module, end to end.
let mockRealProviders = false;
jest.mock('./providers', () => ({
  nativeIdentity: (provider: 'google' | 'apple', nonce: string) =>
    mockRealProviders
      ? jest
          .requireActual<typeof import('./providers')>('./providers')
          .nativeIdentity(provider, nonce)
      : mockIdentity(provider, nonce),
}));
const mockGoogleIdSignIn = jest.fn<(webClientId: string, nonce: string) => Promise<unknown>>();
jest.mock('../../../lib/google-id', () => ({
  googleIdSignIn: (webClientId: string, nonce: string) => mockGoogleIdSignIn(webClientId, nonce),
  googleIdSignOut: () => Promise.resolve(),
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: () => undefined,
    hasPlayServices: () => Promise.resolve(true),
    signIn: () => Promise.reject(new Error('google-signin is not the Android path')),
    signOut: () => Promise.resolve(null),
  },
  isErrorWithCode: () => false,
  isSuccessResponse: () => false,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));
jest.mock('./dev-sign-in', () => ({
  ...jest.requireActual<typeof import('./dev-sign-in')>('./dev-sign-in'),
  devSignInEnabled: () => mockDevEnabled,
}));

const said = (direction: 'rtl' | 'ltr', key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const ar = (key: MessageKey, values?: Record<string, string>) => translate('ar', key, values);

beforeEach(() => {
  mockApi = fakeApi();
  mockNavigate.mockReset();
  mockParams = {};
  mockIdentity.mockReset();
  mockRealProviders = false;
  mockGoogleIdSignIn.mockReset();
  mockDevEnabled = false;
  setSession({ kind: 'signed-out' });
  mockApi.api.auth.providerNonce.mutate.mockResolvedValue({
    nonce: 'nonce-1',
    expiresAt: '2026-10-21T10:05:00Z',
  });
});

describe('Welcome', () => {
  it('draws the language choice, the brand, the two feature lines and the three ways in', async () => {
    await inBothDirections(
      () => <Welcome />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'auth.welcome.tagline'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'auth.welcome.feature.isnad'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'auth.welcome.feature.gender'))).toBeTruthy();
        for (const key of [
          'auth.welcome.google',
          'auth.welcome.apple',
          'auth.welcome.email',
        ] as const) {
          expect(screen.getByRole('button', { name: said(direction, key) })).toBeTruthy();
        }
        expect(
          screen.queryByRole('button', { name: said(direction, 'auth.welcome.devSignIn') }),
        ).toBeNull();
      },
    );
  });

  it('offers Apple on iOS only (ADR 0012 D1)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await renderIn('rtl', <Welcome />);
    expect(screen.queryByRole('button', { name: ar('auth.welcome.apple') })).toBeNull();
    jest.restoreAllMocks();
  });

  it('switches the language in place', async () => {
    await renderIn('rtl', <Welcome />);
    await fireEvent.press(screen.getByRole('radio', { name: /English/ }));
    expect(getLocale()).toBe('en');
  });

  it('signs a returning person in with Google: the nonce, the token, the session stored', async () => {
    mockIdentity.mockResolvedValue({ identityToken: 'google-token' });
    mockApi.api.auth.signInWithProvider.mutate.mockResolvedValue({
      outcome: 'session',
      ...tokens,
      landing: 'student_home',
    });
    await renderIn('rtl', <Welcome />);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.google') }));
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    expect(mockIdentity).toHaveBeenCalledWith('google', 'nonce-1');
    // With a body: tRPC 11.19's server cannot read a mutation sent without one (T099).
    expect(mockApi.api.auth.providerNonce.mutate).toHaveBeenCalledWith({});
    expect(mockApi.api.auth.signInWithProvider.mutate).toHaveBeenCalledWith({
      provider: 'google',
      identityToken: 'google-token',
      nonce: 'nonce-1',
    });
    expect(mockApi.sessions.current()).toEqual(tokens);
  });

  it("carries the server's nonce unhashed to Google's module on Android and back with the token (B50 T148)", async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'] = 'web-client-id';
    mockRealProviders = true;
    mockApi.api.auth.providerNonce.mutate.mockResolvedValue({
      nonce: 'server-nonce-7f3a',
      expiresAt: '2026-10-21T10:05:00Z',
    });
    mockGoogleIdSignIn.mockResolvedValue({ idToken: 'google-id-token', email: 'amal@example.com' });
    mockApi.api.auth.signInWithProvider.mutate.mockResolvedValue({
      outcome: 'session',
      ...tokens,
      landing: 'student_home',
    });
    try {
      await renderIn('rtl', <Welcome />);
      await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.google') }));
      await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
      expect(mockGoogleIdSignIn).toHaveBeenCalledWith('web-client-id', 'server-nonce-7f3a');
      expect(mockApi.api.auth.signInWithProvider.mutate).toHaveBeenCalledWith({
        provider: 'google',
        identityToken: 'google-id-token',
        nonce: 'server-nonce-7f3a',
      });
    } finally {
      delete process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'];
      jest.restoreAllMocks();
    }
  });

  it('starts the onboarding of a new person and opens Role', async () => {
    mockIdentity.mockResolvedValue({ identityToken: 'apple-token', authorizationCode: 'code-1' });
    mockApi.api.auth.signInWithProvider.mutate.mockResolvedValue({
      outcome: 'onboarding',
      onboardingToken: 'onboarding-1',
      prefill: { displayName: 'أمل', emailVerified: false },
    });
    await renderIn('rtl', <Welcome />);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.apple') }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(auth)/role'));
    expect(mockApi.api.auth.signInWithProvider.mutate).toHaveBeenCalledWith({
      provider: 'apple',
      identityToken: 'apple-token',
      nonce: 'nonce-1',
      authorizationCode: 'code-1',
    });
    expect(getDraft()).toMatchObject({
      onboardingToken: 'onboarding-1',
      identity: 'provider',
      displayName: 'أمل',
      emailVerified: false,
    });
    expect(mockApi.sessions.current()).toBeNull();
  });

  it('opens the conflict sheet naming the method the email already uses (FR-123)', async () => {
    mockIdentity.mockResolvedValue({ identityToken: 'google-token', email: 'amal@example.com' });
    mockApi.api.auth.signInWithProvider.mutate.mockRejectedValue(
      apiError('EMAIL_IN_USE_BY_OTHER_METHOD', [{ path: 'email', code: 'email' }]),
    );
    await renderIn('rtl', <Welcome />);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.google') }));
    expect(await screen.findByText(ar('auth.signInConflict.title'))).toBeTruthy();
    expect(
      screen.getByText(ar('auth.signInConflict.bodyEmailPassword', { email: 'amal@example.com' })),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: ar('auth.signInConflict.signInEmailPassword') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/(auth)/email-sign-in');
    expect(getSession()).toEqual({ kind: 'signed-out' });
  });

  it('does nothing when the person closes the provider, and says so when it fails', async () => {
    mockIdentity.mockResolvedValueOnce(null);
    await renderIn('rtl', <Welcome />);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.google') }));
    await waitFor(() => expect(mockIdentity).toHaveBeenCalled());
    expect(mockApi.api.auth.signInWithProvider.mutate).not.toHaveBeenCalled();
    expect(screen.queryByText(ar('auth.welcome.failed'))).toBeNull();

    mockIdentity.mockRejectedValueOnce(new Error('the provider failed'));
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.google') }));
    expect(await screen.findByText(ar('auth.welcome.failed'))).toBeTruthy();
  });

  it('lands a new account refused as banned on the signed-out banned state (T097)', async () => {
    clearDraft();
    mockIdentity.mockResolvedValue({ identityToken: 'google-token', email: 'amal@example.com' });
    mockApi.api.auth.signInWithProvider.mutate.mockRejectedValue(apiError('ACCOUNT_RESTRICTED'));
    await renderIn('rtl', <Welcome />);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.google') }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(auth)/banned'));
    expect(screen.queryByText(ar('auth.welcome.failed'))).toBeNull();
    expect(getSession()).toEqual({ kind: 'signed-out' });
    expect(mockApi.sessions.current()).toBeNull();
    expect(getDraft()).toBeNull();
  });

  it('keeps the failed line for any other refusal of the provider sign-in', async () => {
    mockIdentity.mockResolvedValue({ identityToken: 'google-token' });
    mockApi.api.auth.signInWithProvider.mutate.mockRejectedValue(apiError('FORBIDDEN'));
    await renderIn('rtl', <Welcome />);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.google') }));
    expect(await screen.findByText(ar('auth.welcome.failed'))).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('/(auth)/banned');
  });

  it('offers the development sign-in only behind its flag, with the stand-in token', async () => {
    mockDevEnabled = true;
    mockApi.api.auth.signInWithProvider.mutate.mockResolvedValue({
      outcome: 'session',
      ...tokens,
      landing: 'student_home',
    });
    await renderIn('rtl', <Welcome />);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.welcome.devSignIn') }));
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    const [input] = mockApi.api.auth.signInWithProvider.mutate.mock.calls[0] as [
      { provider: string; identityToken: string; nonce: string },
    ];
    expect(input.provider).toBe('google');
    expect(input.identityToken).toMatch(/^fake\.google\.[\w-]+\..+\.verified\.nonce-1$/);
    expect(mockIdentity).not.toHaveBeenCalled();
  });

  it.each<[ColorScheme, 'rtl' | 'ltr']>([
    ['light', 'rtl'],
    ['dark', 'ltr'],
  ])('draws on the %s theme background (T106)', async (scheme, direction) => {
    const rendered = await renderIn(direction, <Welcome />, scheme);
    const provider = rendered.toJSON() as { children: { props: Record<string, unknown> }[] };
    const [root] = provider.children;
    expect(styleOf(root!)['backgroundColor']).toBe(colour(scheme, 'bg'));
  });
});

describe('EmailSignIn', () => {
  it('draws the two fields, the forgotten-password link and the way to an account', async () => {
    await inBothDirections(
      () => <EmailSignIn />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'auth.emailSignIn.title'))).toBeTruthy();
        expect(screen.getByLabelText(said(direction, 'auth.field.email'))).toBeTruthy();
        expect(screen.getByLabelText(said(direction, 'auth.field.password'))).toBeTruthy();
        expect(
          screen.getByRole('link', { name: said(direction, 'auth.emailSignIn.forgotPassword') }),
        ).toBeTruthy();
        expect(
          screen.getByRole('link', { name: said(direction, 'auth.emailSignIn.createAccount') }),
        ).toBeTruthy();
      },
    );
  });

  it('signs in and stores the session', async () => {
    mockApi.api.auth.email.signIn.mutate.mockResolvedValue({ ...tokens, landing: 'teacher_home' });
    await renderIn('rtl', <EmailSignIn />);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.email')), 'amal@example.com');
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.password')), 'a long secret');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.emailSignIn.signIn') }));
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    expect(mockApi.api.auth.email.signIn.mutate).toHaveBeenCalledWith({
      email: 'amal@example.com',
      password: 'a long secret',
    });
    expect(mockApi.sessions.current()).toEqual(tokens);
  });

  it('says one sentence for a wrong email or password, announced (EmailSignInError)', async () => {
    mockApi.api.auth.email.signIn.mutate.mockRejectedValue(apiError('SIGN_IN_FAILED'));
    await renderIn('rtl', <EmailSignIn />);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.email')), 'amal@example.com');
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.password')), 'wrong one');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.emailSignIn.signIn') }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(ar('auth.emailSignIn.error.invalidCredentials'))).toBeTruthy();
    expect(getSession()).toEqual({ kind: 'signed-out' });
  });

  // T065 of specs/004-sessions: an action refused with `RATE_LIMITED` says when to try again.
  it.each([
    ['gives the time', '61', 'common.state.rateLimitedIn', { count: 2 }],
    ['gives no time', undefined, 'common.state.rateLimited', undefined],
  ] as const)(
    'says so in place of the generic banner when RATE_LIMITED %s (T065)',
    async (_case, seconds, key, values) => {
      mockApi.api.auth.email.signIn.mutate.mockRejectedValue(
        apiError(
          'RATE_LIMITED',
          seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }],
        ),
      );
      await inBothDirections(
        () => <EmailSignIn />,
        async (_rendered, direction) => {
          await fireEvent.changeText(
            screen.getByLabelText(said(direction, 'auth.field.email')),
            'amal@example.com',
          );
          await fireEvent.changeText(
            screen.getByLabelText(said(direction, 'auth.field.password')),
            'a long secret',
          );
          await fireEvent.press(
            screen.getByRole('button', { name: said(direction, 'auth.emailSignIn.signIn') }),
          );
          expect(await screen.findByText(said(direction, key, values))).toBeTruthy();
          expect(screen.queryByText(said(direction, 'common.state.actionError'))).toBeNull();
        },
      );
    },
  );

  it('leads to the forgotten password and to a new account', async () => {
    await renderIn('rtl', <EmailSignIn />);
    await fireEvent.press(
      screen.getByRole('link', { name: ar('auth.emailSignIn.forgotPassword') }),
    );
    await fireEvent.press(screen.getByRole('link', { name: ar('auth.emailSignIn.createAccount') }));
    expect(mockNavigate.mock.calls).toEqual([
      ['/(auth)/forgot-password'],
      ['/(auth)/email-sign-up'],
    ]);
  });
});

describe('EmailSignUp', () => {
  const fill = async (email: string, password: string, confirm: string) => {
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.email')), email);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.password')), password);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.confirmPassword')), confirm);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.emailSignUp.sendCode') }));
  };

  it('draws the three fields in both languages', async () => {
    await inBothDirections(
      () => <EmailSignUp />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'auth.emailSignUp.title'))).toBeTruthy();
        expect(screen.getByLabelText(said(direction, 'auth.field.confirmPassword'))).toBeTruthy();
      },
    );
  });

  it('refuses a short password and two that differ, asking nothing of the server', async () => {
    await renderIn('rtl', <EmailSignUp />);
    await fill('amal@example.com', 'short', 'short');
    expect(await screen.findByText(ar('auth.password.minLength'))).toBeTruthy();
    await fill('amal@example.com', 'a long secret', 'another secret');
    expect(await screen.findByText(ar('auth.password.mismatch'))).toBeTruthy();
    await fill('not an email', 'a long secret', 'a long secret');
    expect(await screen.findByText(ar('auth.field.emailInvalid'))).toBeTruthy();
    expect(mockApi.api.auth.email.requestSignUpCode.mutate).not.toHaveBeenCalled();
  });

  it('sends the code and opens the code screen, the password kept on the device', async () => {
    await renderIn('rtl', <EmailSignUp />);
    await fill('Amal@Example.com', 'a long secret', 'a long secret');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(auth)/otp'));
    expect(mockApi.api.auth.email.requestSignUpCode.mutate).toHaveBeenCalledWith({
      email: 'Amal@Example.com',
      password: 'a long secret',
    });
  });

  /** The password field's own column: the nearest view holding its input and not the confirmation's. */
  const passwordField = (
    inside: ReturnType<typeof screen.getByText>,
    direction: 'rtl' | 'ltr' = 'rtl',
  ) => {
    for (let at = inside.parent; at !== null; at = at.parent) {
      if (within(at).queryByLabelText(said(direction, 'auth.field.password')) !== null) {
        expect(
          within(at).queryByLabelText(said(direction, 'auth.field.confirmPassword')),
        ).toBeNull();
        return at;
      }
    }
    throw new Error('no field holds the text');
  };

  // T137 (the owner's decision of 2026-11-01): a breached password is told at the step that holds
  // its field, under the field, and no code goes out.
  it('says a breached password under its own field, the code screen not opened', async () => {
    mockApi.api.auth.email.requestSignUpCode.mutate.mockRejectedValue(apiError('PASSWORD_WEAK'));
    clearPendingEmail();
    await renderIn('rtl', <EmailSignUp />);
    await fill('amal@example.com', 'password123', 'password123');
    const told = await screen.findByText(ar('auth.password.weak'));
    expect(passwordField(told)).toBeTruthy();
    expect(screen.queryByText(ar('auth.password.minLength'))).toBeNull();
    expect(screen.queryByText(ar('common.state.actionError'))).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(getPendingEmail()).toBeNull();
  });

  it('says a breached password under its field when the last step leads back here', async () => {
    mockParams = { problem: 'password_weak' };
    await inBothDirections(
      () => <EmailSignUp />,
      (_rendered, direction) => {
        expect(
          passwordField(screen.getByText(said(direction, 'auth.password.weak')), direction),
        ).toBeTruthy();
      },
    );
  });
});

describe('Otp', () => {
  beforeEach(() => setPendingEmail('amal@example.com', 'a long secret'));

  it('names the address, draws six cells and the resend countdown', async () => {
    await inBothDirections(
      () => <Otp />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'auth.otp.title'))).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'auth.otp.lede', { email: 'amal@example.com' })),
        ).toBeTruthy();
        expect(screen.getByTestId('otp-input')).toBeTruthy();
        expect(
          screen.getByText(
            new RegExp(said(direction, 'auth.otp.resendIn', { time: 'X' }).replace('X', '.+')),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('verifies the code and starts the onboarding of the email identity with its password', async () => {
    mockApi.api.auth.email.verifySignUpCode.mutate.mockResolvedValue({
      onboardingToken: 'email-1',
    });
    await renderIn('rtl', <Otp />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.otp.confirm') }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(auth)/role'));
    expect(mockApi.api.auth.email.verifySignUpCode.mutate).toHaveBeenCalledWith({
      email: 'amal@example.com',
      code: '123456',
    });
    expect(getDraft()).toMatchObject({
      onboardingToken: 'email-1',
      identity: 'email',
      password: 'a long secret',
      email: 'amal@example.com',
      emailVerified: true,
    });
  });

  it('says a wrong or expired code under the cells', async () => {
    mockApi.api.auth.email.verifySignUpCode.mutate.mockRejectedValue(apiError('CODE_INVALID'));
    await renderIn('rtl', <Otp />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.otp.confirm') }));
    expect(await screen.findByText(ar('auth.otp.invalid'))).toBeTruthy();
  });

  it('lands a proved address refused as banned on the signed-out banned state (T097)', async () => {
    clearDraft();
    mockApi.api.auth.email.verifySignUpCode.mutate.mockRejectedValue(
      apiError('ACCOUNT_RESTRICTED'),
    );
    await renderIn('rtl', <Otp />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.otp.confirm') }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(auth)/banned'));
    expect(screen.queryByText(ar('common.state.actionError'))).toBeNull();
    expect(getSession()).toEqual({ kind: 'signed-out' });
    expect(mockApi.sessions.current()).toBeNull();
    expect(getDraft()).toBeNull();
    // The password chosen on EmailSignUp is dropped with the address.
    expect(getPendingEmail()).toBeNull();
  });

  it('keeps the general line for any other refusal of the code', async () => {
    mockApi.api.auth.email.verifySignUpCode.mutate.mockRejectedValue(apiError('INTERNAL'));
    await renderIn('rtl', <Otp />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.otp.confirm') }));
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('/(auth)/banned');
    expect(getPendingEmail()).toEqual({ email: 'amal@example.com', password: 'a long secret' });
  });

  it('opens the conflict sheet when the address belongs to a Google account', async () => {
    mockApi.api.auth.email.verifySignUpCode.mutate.mockRejectedValue(
      apiError('EMAIL_IN_USE_BY_OTHER_METHOD', [{ path: 'email', code: 'google' }]),
    );
    await renderIn('rtl', <Otp />);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.otp.confirm') }));
    expect(
      await screen.findByText(ar('auth.signInConflict.bodyGoogle', { email: 'amal@example.com' })),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: ar('auth.signInConflict.signInGoogle') }),
    ).toBeTruthy();
  });
});

describe('ForgotPassword', () => {
  it('sends the code with one answer for every address and opens the new password', async () => {
    await inBothDirections(
      () => <ForgotPassword />,
      (_rendered, direction) => {
        expect(screen.getByText(said(direction, 'auth.forgotPassword.lede'))).toBeTruthy();
      },
    );
    await renderIn('rtl', <ForgotPassword />);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.email')), 'amal@example.com');
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.forgotPassword.sendCode') }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(auth)/reset-password'));
    expect(mockApi.api.auth.email.requestPasswordReset.mutate).toHaveBeenCalledWith({
      email: 'amal@example.com',
    });
  });
});

describe('ResetPassword', () => {
  beforeEach(() => setPendingEmail('amal@example.com'));

  const submit = async (code: string, password: string) => {
    await fireEvent.changeText(screen.getByTestId('otp-input'), code);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.newPassword')), password);
    await fireEvent.changeText(screen.getByLabelText(ar('auth.field.confirmPassword')), password);
    await fireEvent.press(screen.getByRole('button', { name: ar('auth.resetPassword.save') }));
  };

  it('saves the new password and signs in', async () => {
    mockApi.api.auth.email.resetPassword.mutate.mockResolvedValue({
      ...tokens,
      landing: 'student_home',
    });
    await renderIn('rtl', <ResetPassword />);
    await submit('123456', 'a new long secret');
    await waitFor(() => expect(getSession()).toEqual({ kind: 'restoring' }));
    expect(mockApi.api.auth.email.resetPassword.mutate).toHaveBeenCalledWith({
      email: 'amal@example.com',
      code: '123456',
      newPassword: 'a new long secret',
    });
  });

  it('says a wrong code and a breached password where each belongs', async () => {
    mockApi.api.auth.email.resetPassword.mutate.mockRejectedValueOnce(apiError('CODE_INVALID'));
    await renderIn('rtl', <ResetPassword />);
    await submit('000000', 'a new long secret');
    expect(await screen.findByText(ar('auth.otp.invalid'))).toBeTruthy();
    mockApi.api.auth.email.resetPassword.mutate.mockRejectedValueOnce(apiError('PASSWORD_WEAK'));
    await submit('123456', 'password1');
    expect(await screen.findByText(ar('auth.password.weak'))).toBeTruthy();
    expect(getSession()).toEqual({ kind: 'signed-out' });
  });
});
