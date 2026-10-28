// T052 (FR-131, FR-AUTH-7): what both account tabs do. The language switches in place and is
// stored on the account; sign-out revokes the device's session (`auth.signOut`, admitted for a
// restricted account) and forgets the tokens, the device signed out even when the server cannot be
// reached, so a shared phone is never left signed in.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { type Locale, setLocale } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import { useApi } from '../../../lib/api';
import { setSession } from '../../../lib/session';

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
        await client.api.auth.signOut.mutate({}).catch(() => undefined);
        await sessions.clear();
        setSession({ kind: 'signed-out' });
      },
    }),
    [client, sessions, queries],
  );
}
