// T073 (FR-176): the home's summary and the signed-in administrator, through TanStack Query (research
// R-113). The summary is one `home.read` shared with the queues' counts and the sidebar (one cache
// key), the administrator one `auth.read` kept for the session.
import { useQuery } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';

const HOME = ['home', 'summary'] as const;
const FRESH_MS = 30_000;

export function useHomeSummary() {
  const { client } = useAdmin();
  return useQuery({
    queryKey: HOME,
    queryFn: () => client.api.home.summary.query(),
    staleTime: FRESH_MS,
  });
}

export function useMe() {
  const { client } = useAdmin();
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => client.api.auth.me.query(),
    staleTime: Infinity,
  });
}
