// T070: what the second-factor pages share. A session waiting for its second factor that ended
// meanwhile (expired, or verified in another tab) is answered `ADMIN_SIGN_IN_FAILED`, the code the
// panel starts again on (B12a review, follow-up 6): the tab forgets it, the guard lands it on the
// sign-in page, and that page says so.
// `UNAUTHENTICATED` is the client's own to clear (lib/client.ts), and the guard follows.
import { useCallback } from 'react';

import { useAdmin } from '../../lib/admin-context';
import { errorCodeOf } from '../../lib/client';
import { leaveSignInNotice } from '../sign-in/AdminSignIn';

/** Starts again at the sign-in page when `error` says the waiting session ended; true if so. */
export function useStartOver(): (error: unknown) => boolean {
  const { sessions } = useAdmin();
  return useCallback(
    (error: unknown) => {
      if (errorCodeOf(error) !== 'ADMIN_SIGN_IN_FAILED') return false;
      leaveSignInNotice('sessionExpired');
      sessions.clear();
      return true;
    },
    [sessions],
  );
}

/** The authenticator's period, the seconds a code lives (RFC 6238; `totp.ts` on the server). */
export const TOTP_PERIOD_SECONDS = 30;
