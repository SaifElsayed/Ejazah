// T050: the development sign-in.
//
// The API's stand-in (`SIGN_IN_PROVIDER=fake`, refused outside development and test, T168)
// takes an unsigned token of a documented shape
// (`apps/api/src/platform/ports/sign-in/fake.adapter.ts`); a development build with
// `EXPO_PUBLIC_DEV_SIGN_IN=true` builds it for one fixed person, so the owner walks the flows with no
// provider account. A release build never offers it: `__DEV__` is false there.

/** True in a development build whose environment turns the development sign-in on. */
export function devSignInEnabled(): boolean {
  return __DEV__ && process.env['EXPO_PUBLIC_DEV_SIGN_IN'] === 'true';
}

/** The one person the development sign-in is. */
export const DEV_EMAIL = 'dev-phone@ijazah.test';

/** The stand-in's token for that person, carrying `nonce`. */
export function devIdentityToken(nonce: string): string {
  return ['fake', 'google', 'dev-phone', DEV_EMAIL, 'verified', nonce].join('.');
}
