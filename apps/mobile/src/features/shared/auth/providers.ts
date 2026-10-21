// T050 (FR-121, research R-103): the identity token a provider issues to the device, for
// `auth.signInWithProvider` with the nonce `auth.providerNonce` minted.
//
// GOOGLE. `@react-native-google-signin/google-signin`'s free sign-in (T006). Its `signIn` takes no
// nonce, so the token carries none of the server's; research R-103 assumes one, and the live
// adapter must settle it before it verifies Google's tokens (a follow-up of B10b). The nonce is
// still sent with the token and consumed by the server, so it stays single-use.
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
  return provider === 'google' ? google() : apple(nonce);
}

async function google(): Promise<ProviderIdentity | null> {
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
