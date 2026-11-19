// T050 (FR-121, research R-103): the identity token a provider issues to the device, for
// `auth.signInWithProvider` with the nonce `auth.providerNonce` minted.
//
// GOOGLE ON ANDROID (B50 T148, the note under T148; Q-T2 (a)). Credential Manager through the local
// module `modules/google-id` (`lib/google-id.ts`), asked for a Google ID token for the Web client ID
// with the server's nonce passed UNHASHED: the live adapter (`platform/ports/sign-in/
// live.adapter.ts`) compares the token's `nonce` claim with the nonce as `auth.providerNonce`
// minted it, so the claim must be that very value (Apple's is hashed; Google's never is). This
// closes B10b's follow-up on Android.
//
// GOOGLE ON iOS. `@react-native-google-signin/google-signin`'s free sign-in (T006), whose `signIn`
// takes no nonce, so the token carries none of the server's; the nonce is still sent and consumed,
// so it stays single-use. Google's nonce on iOS waits for the first App Store submission, with
// Apple (the follow-up under T148).
//
// APPLE. `expo-apple-authentication` with the SHA-256 of the raw nonce in the request, as Apple
// requires; the raw nonce goes to the server with the token, and the authorization code Apple
// returns with it (exchanged at once, TN3194). Offered on iOS only (ADR 0012 D1).
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { googleIdSignIn } from '../../../lib/google-id';

/** What a provider handed the device. */
export interface ProviderIdentity {
  readonly identityToken: string;
  readonly authorizationCode?: string;
  /** The address the token names, shown by the conflict sheet; never sent. */
  readonly email?: string;
}

/** The identity token of the person signing in with `provider`; null when they closed it. */
export async function nativeIdentity(
  provider: 'google' | 'apple',
  nonce: string,
): Promise<ProviderIdentity | null> {
  if (provider === 'apple') return apple(nonce);
  return Platform.OS === 'android' ? googleOnAndroid(nonce) : googleSignIn();
}

async function googleOnAndroid(nonce: string): Promise<ProviderIdentity | null> {
  const webClientId = process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'];
  if (webClientId === undefined || webClientId === '') {
    throw new Error('This build has no Google Web client ID.');
  }
  const credential = await googleIdSignIn(webClientId, nonce);
  if (credential === null) return null;
  return { identityToken: credential.idToken, email: credential.email };
}

async function googleSignIn(): Promise<ProviderIdentity | null> {
  GoogleSignin.configure({
    ...optional('webClientId', process.env['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID']),
    ...optional('iosClientId', process.env['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID']),
  });
  try {
    await GoogleSignin.hasPlayServices();
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null;
    const { idToken, user } = response.data;
    if (idToken === null) throw new Error('Google returned no identity token');
    return { identityToken: idToken, email: user.email };
  } catch (error: unknown) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) return null;
    throw error;
  }
}

async function apple(nonce: string): Promise<ProviderIdentity | null> {
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
    if (credential.identityToken === null) throw new Error('Apple returned no identity token');
    const email = credential.email ?? emailClaimOf(credential.identityToken);
    return {
      identityToken: credential.identityToken,
      ...(credential.authorizationCode === null
        ? {}
        : { authorizationCode: credential.authorizationCode }),
      ...(email === undefined ? {} : { email }),
    };
  } catch (error: unknown) {
    if ((error as { code?: unknown }).code === 'ERR_REQUEST_CANCELED') return null;
    throw error;
  }
}

/**
 * The `email` claim of a token, read for display only (Apple sends the address once, on the first
 * sign-in, and in the token after that); the server verifies the token, the device never trusts it.
 */
export function emailClaimOf(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (payload === undefined) return undefined;
  try {
    const json: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    const email = (json as { email?: unknown }).email;
    return typeof email === 'string' ? email : undefined;
  } catch {
    return undefined;
  }
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, string>);
}
