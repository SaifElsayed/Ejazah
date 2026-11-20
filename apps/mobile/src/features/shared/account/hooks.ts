// T052 (FR-131, FR-AUTH-7): what both account tabs do. The language switches in place and is
// stored on the account; sign-out revokes the device's session (`auth.signOut`, admitted for a
// restricted account) and forgets the tokens, the device signed out even when the server cannot be
// reached, so a shared phone is never left signed in.
//
// B50 T148: the sign-out signs the device out of the Google SDK too (`signOutProviders`), loaded
// only then, so this folder's entry still loads no provider's native module (deletion/api.ts).
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { type Locale, setLocale } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { useApi } from '../../../lib/api';
import { setSession } from '../../../lib/session';

/**
 * Signs the device out of the sign-in provider in the background: never waited on, so a provider
 * that fails or hangs never holds a session's end. A failure is logged with no data.
 */
export function signOutOfProviders(): void {
  void (async () => {
    try {
      // An inline require, as lib/plural-rules.ts loads its polyfill: Metro evaluates the module
      // only here, and the test run (CommonJS) cannot run `import()` without a Node flag.
      const providers = require('../auth/providers') as typeof import('../auth/providers');
      await providers.signOutProviders();
    } catch {
      console.warn('The sign-in provider sign-out could not run.');
    }
  })();
}

export function useAccountActions() {
  const { client, sessions } = useApi();
  const queries = useQueryClient();
  return useMemo(
    () => ({
      /**
       * Stores the language on the account, then switches the screen: a change of direction reloads
       * the app (lib/direction.ts), which would drop a call still on its way. A failed store still
       * switches the screen; the next switch stores it again.
       */
      async setLanguage(language: Locale): Promise<void> {
        try {
          await client.api.account.setLanguage.mutate({ language });
          await queries.invalidateQueries({ queryKey: ME_QUERY_KEY });
        } finally {
          setLocale(language);
        }
      },

      async signOut(): Promise<void> {
        signOutOfProviders();
        await client.api.auth.signOut.mutate({}).catch(() => undefined);
        await sessions.clear();
        setSession({ kind: 'signed-out' });
      },
    }),
    [client, sessions, queries],
  );
}
