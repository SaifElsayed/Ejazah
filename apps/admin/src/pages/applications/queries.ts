// T071: the applications queue's reads and decisions over the client, through TanStack Query
// (research R-113). Every read is an audited `applications.read` (`home.read` for the counts), so a
// list is kept a little while and a search is sent once the typing stops (`useSettled`). A decision
// reads the queue, the detail and the counts again.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type ApplicationsTab = Parameters<Api['applications']['list']['query']>[0]['tab'];
export type ApplicationsPage = Awaited<ReturnType<Api['applications']['list']['query']>>;
export type ApplicationRow = ApplicationsPage['rows'][number];
export type ApplicationDetail = Awaited<ReturnType<Api['applications']['get']['query']>>;
export type RecordCallInput = Parameters<Api['applications']['recordCall']['mutate']>[0];

const APPLICATIONS = ['applications'] as const;
const HOME = ['home', 'summary'] as const;
/** How long a page read stays fresh: switching back to a tab does not read it again at once. */
const FRESH_MS = 30_000;
/** How long the search waits for the typing to stop. */
export const SEARCH_SETTLE_MS = 300;

export function useApplicationsPage(tab: ApplicationsTab, search: string, page: number) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...APPLICATIONS, 'list', tab, search, page],
    queryFn: () =>
      client.api.applications.list.query({
        tab,
        ...(search === '' ? {} : { search }),
        page,
      }),
    staleTime: FRESH_MS,
    placeholderData: keepPreviousData,
  });
}

export function useApplication(teacherUserId: string | null) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...APPLICATIONS, 'get', teacherUserId],
    queryFn: () => client.api.applications.get.query({ teacherUserId: teacherUserId ?? '' }),
    enabled: teacherUserId !== null,
    staleTime: FRESH_MS,
  });
}

/** The queue's counts, from the home's summary (one `home.read`). */
export function useQueueCounts() {
  const { client } = useAdmin();
  return useQuery({
    queryKey: HOME,
    queryFn: () => client.api.home.summary.query(),
    staleTime: FRESH_MS,
    select: (summary) => summary.queues.applications,
  });
}

/** The decisions and the call record; each reads the queue and the counts again. */
export function useApplicationActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  const settle = async () => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: APPLICATIONS }),
      queries.invalidateQueries({ queryKey: HOME }),
    ]);
  };
  const api = client.api.applications;
  return {
    recordCall: useMutation({
      mutationFn: (input: RecordCallInput) => api.recordCall.mutate(input),
      onSuccess: settle,
    }),
    approve: useMutation({
      mutationFn: (input: Parameters<typeof api.approve.mutate>[0]) => api.approve.mutate(input),
      onSuccess: settle,
    }),
    reject: useMutation({
      mutationFn: (input: Parameters<typeof api.reject.mutate>[0]) => api.reject.mutate(input),
      onSuccess: settle,
    }),
    requestInfo: useMutation({
      mutationFn: (input: Parameters<typeof api.requestInfo.mutate>[0]) =>
        api.requestInfo.mutate(input),
      onSuccess: settle,
    }),
    ban: useMutation({
      mutationFn: (input: Parameters<typeof api.ban.mutate>[0]) => api.ban.mutate(input),
      onSuccess: settle,
    }),
  };
}

/** `text` trimmed, once it has stayed the same for `SEARCH_SETTLE_MS`. */
export function useSettled(text: string): string {
  const trimmed = text.trim();
  const [settled, setSettled] = useState(trimmed);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(trimmed), SEARCH_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [trimmed]);
  return settled;
}
