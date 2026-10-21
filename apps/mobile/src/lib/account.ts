// T052 (FR-131, FR-137): the signed-in person's own account, `account.me`, read once into the query
// cache and shared: the guard lands the session by it, the account tab draws it, and a change the
// person makes (the language, the zone) refreshes it.
import type { MeOutput } from '@ijazah/contracts';
import { useQuery } from '@tanstack/react-query';

import { useApi } from './api';
import { useSession } from './session';

/** The query key of `account.me`. */
export const ME_QUERY_KEY = ['account', 'me'] as const;

/** `account.me` while a session exists or is being restored; idle when signed out. */
export function useMe() {
  const { client } = useApi();
  const session = useSession();
  return useQuery<MeOutput>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => client.api.account.me.query(),
    enabled: session.kind === 'restoring' || session.kind === 'signed-in',
  });
}
