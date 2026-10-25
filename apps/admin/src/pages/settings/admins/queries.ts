// T073: the administrators' reads and actions over the client, through TanStack Query (research
// R-113). A list read is an audited `admins.read`; an action reads the list again. New recovery codes
// change nothing the page shows but the count left, so they read it again too.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../../lib/admin-context';
import type { AdminClient } from '../../../lib/client';

type Api = AdminClient['api'];
export type AdminsTab = Parameters<Api['admins']['list']['query']>[0]['tab'];
export type AdminRow = Awaited<ReturnType<Api['admins']['list']['query']>>['rows'][number];

const ADMINS = ['admins'] as const;
const FRESH_MS = 30_000;

export function useAdminsPage(tab: AdminsTab, search: string, page: number) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...ADMINS, 'list', tab, search, page],
    queryFn: () =>
      client.api.admins.list.query({ tab, ...(search === '' ? {} : { search }), page }),
    staleTime: FRESH_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === tab && previousQuery.queryKey[3] === search
        ? previous
        : undefined,
  });
}

export function useAdminActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  const reread = () => queries.invalidateQueries({ queryKey: ADMINS });
  const api = client.api.admins;
  return {
    add: useMutation({
      mutationFn: (input: Parameters<typeof api.add.mutate>[0]) => api.add.mutate(input),
      onSuccess: reread,
    }),
    disable: useMutation({
      mutationFn: (input: Parameters<typeof api.disable.mutate>[0]) => api.disable.mutate(input),
      onSuccess: reread,
    }),
    resetMfa: useMutation({
      mutationFn: (input: Parameters<typeof api.resetMfa.mutate>[0]) => api.resetMfa.mutate(input),
      onSuccess: reread,
    }),
    regenerate: useMutation({
      mutationFn: (input: Parameters<typeof api.regenerateRecoveryCodes.mutate>[0]) =>
        api.regenerateRecoveryCodes.mutate(input),
      onSuccess: reread,
    }),
  };
}
