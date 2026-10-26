// T050 (FR-120 to FR-123, FR-129): the sign-in procedures of T048 as the screens call them. A
// session is stored and handed to the guard as `restoring`, which reads `account.me` for where to
// land (T052); an onboarding token starts the onboarding draft; an address that belongs to another
// method is answered as a conflict naming that method (FR-123), never linked.
//
// T097 (FR-155): a new account whose proved address or provider subject belongs to a banned
// person's deleted account is refused with `ACCOUNT_RESTRICTED` and no token; that refusal is the
// `banned` outcome, which lands on the signed-out banned state with nothing stored.
import type { SessionOutput, SignInMethod } from '@ijazah/contracts';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { setSession } from '../../../lib/session';
import type { SessionStore } from '../../../lib/storage';
import { deviceTimeZone } from '../../../lib/time-zone';
import { startOnboarding } from '../onboarding/draft';
import { DEV_EMAIL, devIdentityToken } from './dev-sign-in';
import { clearPendingEmail } from './pending';
import { nativeIdentity } from './providers';

/** What a sign-in came to. */
export type SignInOutcome =
  | { readonly kind: 'session' }
  | { readonly kind: 'onboarding' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'banned' }
  | { readonly kind: 'conflict'; readonly method: SignInMethod; readonly email: string };

export type SignInProvider = 'google' | 'apple' | 'dev';

const METHODS: ReadonlySet<string> = new Set<SignInMethod>(['google', 'apple', 'email']);

/** The signed-out banned state (T097). */
export const BANNED_ROUTE = '/(auth)/banned';

/** True when a sign-up was refused as a banned person's (T097); the refusal carries no detail. */
export function isBannedRefusal(error: unknown): boolean {
  return errorCodeOf(error) === 'ACCOUNT_RESTRICTED';
}

/** The method the address already uses when `error` is FR-123's conflict; null otherwise. */
export function conflictMethodOf(error: unknown): SignInMethod | null {
  if (errorCodeOf(error) !== 'EMAIL_IN_USE_BY_OTHER_METHOD') return null;
  const method = errorDetailsOf(error).find((detail) => detail.path === 'email')?.code;
  return method !== undefined && METHODS.has(method) ? (method as SignInMethod) : null;
}

/** Stores the session's tokens and lets the guard land it (`account.me`, T052). */
export async function beginSession(
  sessions: SessionStore,
  session: Pick<SessionOutput, 'accessToken' | 'refreshToken'>,
): Promise<void> {
  await sessions.write({ accessToken: session.accessToken, refreshToken: session.refreshToken });
  setSession({ kind: 'restoring' });
}

export function useAuthApi() {
  const { client, sessions } = useApi();
  return useMemo(() => {
    const { api } = client;

    return {
      /** Google, Apple or, in development, the stand-in. */
      async withProvider(provider: SignInProvider): Promise<SignInOutcome> {
        const { nonce } = await api.auth.providerNonce.mutate();
        const identity =
          provider === 'dev'
            ? { identityToken: devIdentityToken(nonce), email: DEV_EMAIL }
            : await nativeIdentity(provider, nonce);
        if (identity === null) return { kind: 'cancelled' };
        try {
          const answer = await api.auth.signInWithProvider.mutate({
            provider: provider === 'apple' ? 'apple' : 'google',
            identityToken: identity.identityToken,
            nonce,
            ...('authorizationCode' in identity && identity.authorizationCode !== undefined
              ? { authorizationCode: identity.authorizationCode }
              : {}),
          });
          if (answer.outcome === 'session') {
            await beginSession(sessions, answer);
            return { kind: 'session' };
          }
          startOnboarding({
            onboardingToken: answer.onboardingToken,
            identity: 'provider',
            emailVerified: answer.prefill.emailVerified,
            email: answer.prefill.email,
            displayName: answer.prefill.displayName,
            timezone: deviceTimeZone(),
          });
          return { kind: 'onboarding' };
        } catch (error: unknown) {
          if (isBannedRefusal(error)) return { kind: 'banned' };
          const method = conflictMethodOf(error);
          if (method === null) throw error;
          return { kind: 'conflict', method, email: identity.email ?? '' };
        }
      },

      async emailSignIn(email: string, password: string): Promise<void> {
        await beginSession(sessions, await api.auth.email.signIn.mutate({ email, password }));
      },

      async requestSignUpCode(email: string): Promise<void> {
        await api.auth.email.requestSignUpCode.mutate({ email });
      },

      /** The code proves the address; the account is created at the end of the onboarding. */
      async verifySignUpCode(
        email: string,
        code: string,
        password: string,
      ): Promise<SignInOutcome> {
        try {
          const { onboardingToken } = await api.auth.email.verifySignUpCode.mutate({ email, code });
          startOnboarding({
            onboardingToken,
            identity: 'email',
            emailVerified: true,
            email,
            password,
            timezone: deviceTimeZone(),
          });
          // The draft holds the password now; nothing else keeps it (review of B10b, round 1).
          clearPendingEmail();
          return { kind: 'onboarding' };
        } catch (error: unknown) {
          if (isBannedRefusal(error)) {
            // Nothing of the refused sign-up stays on the device, its password included.
            clearPendingEmail();
            return { kind: 'banned' };
          }
          const method = conflictMethodOf(error);
          if (method === null) throw error;
          return { kind: 'conflict', method, email };
        }
      },

      async requestPasswordReset(email: string): Promise<void> {
        await api.auth.email.requestPasswordReset.mutate({ email });
      },

      async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
        const session = await api.auth.email.resetPassword.mutate({ email, code, newPassword });
        clearPendingEmail();
        await beginSession(sessions, session);
      },
    };
  }, [client, sessions]);
}
