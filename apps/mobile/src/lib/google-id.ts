// B50 T148 (research R-103; the note under T148): Google's identity token on Android through
// Credential Manager, by the local module `modules/google-id` (B36's `room-keep-alive` precedent).
// The module asks for a Google ID token for the Web client ID with the nonce it is handed, so the
// token's `nonce` claim is exactly that value; it answers null when the person closes the sheet and
// rejects with a code, never the token, otherwise. A build without the module fails the sign-in as
// unavailable, as google-signin fails today on a phone without Play services, and signs out of
// nothing.
import { requireOptionalNativeModule } from 'expo';

/** What Google handed the device: the identity token and the address it names. */
export interface GoogleIdCredential {
  readonly idToken: string;
  readonly email: string;
}

interface NativeGoogleId {
  signIn(webClientId: string, nonce: string): Promise<GoogleIdCredential | null>;
  signOut(): Promise<void>;
}

const native = requireOptionalNativeModule<NativeGoogleId>('GoogleId');

/** The Google ID token for `webClientId` carrying `nonce` as given; null when the person closed it. */
export async function googleIdSignIn(
  webClientId: string,
  nonce: string,
): Promise<GoogleIdCredential | null> {
  if (native === null) throw new Error('Google sign-in is not available in this build.');
  return native.signIn(webClientId, nonce);
}

/** Clears Credential Manager's state for this app, so the next sign-in asks for an account. */
export async function googleIdSignOut(): Promise<void> {
  await native?.signOut();
}
