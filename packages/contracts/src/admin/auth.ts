// T067: the administrator surface's `auth` namespace (specs/002-identity/contracts/admin-surface.md
// "`auth` — sign-in and the second factor"; FR-170 to FR-174). Exported apart from the user
// surface, under `@ijazah/contracts/admin` (R-API-11). The sign-in's six procedures are the
// surface's only anonymous ones; `signOut` and `me` are the administrator kind's.
import { z } from 'zod';

import { platformToken } from '../auth.js';
import { password } from '../password.js';
import { emailAddress } from '../platform.js';

/** A code of the authenticator: six digits (RFC 6238, research R-107). */
export const totpCode = z.string().regex(/^[0-9]{6}$/);

/** A recovery code as typed: ten symbols, perhaps with spaces or hyphens, in any case. */
export const recoveryCode = z.string().min(1).max(32);

/** The token of a session waiting for its second factor, from `auth.signIn`. */
export const adminSessionToken = platformToken;

/** The token the password-set link carries in its fragment (R-110). */
export const inviteToken = z.string().min(1).max(512);

/** What comes after a password: the code, or the second factor's setup (FR-171). */
export const adminSignInNext = z.enum(['mfa', 'setup']);

export const adminSignInInput = z.object({ email: emailAddress, password });

export const adminSignInOutput = z.object({
  next: adminSignInNext,
  sessionToken: adminSessionToken,
});

export const adminMfaVerifyInput = z.object({ sessionToken: adminSessionToken, code: totpCode });

export const adminMfaRecoverInput = z.object({ sessionToken: adminSessionToken, recoveryCode });

export const adminMfaRecoverOutput = z.object({ remainingCodes: z.int().min(0) });

export const adminMfaSetupBeginInput = z.object({ sessionToken: adminSessionToken });

export const adminMfaSetupBeginOutput = z.object({ otpauthUri: z.string(), manualKey: z.string() });

export const adminMfaSetupConfirmInput = z.object({
  sessionToken: adminSessionToken,
  code: totpCode,
});

/** The codes, shown once (`admin_recovery_code_count` of them). */
export const adminRecoveryCodesOutput = z.object({ recoveryCodes: z.array(z.string()) });

/** `admins.recoveryCodes.regenerate`: a current code of the caller's own second factor (T096). */
export const adminRegenerateRecoveryCodesInput = z.object({ code: totpCode });

export const adminSetPasswordInput = z.object({ inviteToken, password });

/** `auth.me`: the sidebar's administrator. */
export const adminMeOutput = z.object({
  adminId: z.uuid(),
  displayName: z.string(),
  email: z.string(),
});
