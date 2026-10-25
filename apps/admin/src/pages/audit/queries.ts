// T073: the audit log's reads over the client, through TanStack Query (research R-113). Each read is
// itself an audited `audit.read`, so a page is kept a little while; the last page stays while the
// next of the same filters loads.
import { useQuery } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type AuditFilter = Omit<Parameters<Api['audit']['list']['query']>[0], 'page'>;
export type AuditEntry = Awaited<ReturnType<Api['audit']['get']['query']>>;

const AUDIT = ['audit'] as const;
const FRESH_MS = 30_000;

export function useAuditPage(filter: AuditFilter, page: number) {
  const { client } = useAdmin();
  const filters = JSON.stringify(filter);
  return useQuery({
    queryKey: [...AUDIT, 'list', filters, page],
    queryFn: () => client.api.audit.list.query({ ...filter, page }),
    staleTime: FRESH_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === filters ? previous : undefined,
  });
}

export function useAuditEntry(entryId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...AUDIT, 'get', entryId],
    queryFn: () => client.api.audit.get.query({ entryId }),
    staleTime: Infinity,
  });
}
