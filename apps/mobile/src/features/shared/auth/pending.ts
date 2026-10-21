// T050: the address a code was sent to, between the screen that asked for it and the one that
// takes the code (EmailSignUp → Otp, ForgotPassword → ResetPassword), with the password EmailSignUp
// chose. It lives in memory only and goes nowhere else: not a route parameter, not the device's
// storage.
let pending: { readonly email: string; readonly password?: string } | null = null;

export function setPendingEmail(email: string, password?: string): void {
  pending = password === undefined ? { email } : { email, password };
}

export function getPendingEmail(): { readonly email: string; readonly password?: string } | null {
  return pending;
}

export function clearPendingEmail(): void {
  pending = null;
}
