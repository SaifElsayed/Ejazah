// T050: `/cases`' reads over the client, through TanStack Query (research R-113). Each read is an
// audited `cases.listed` or `case.viewed` on the server, so a page is kept a little while and the
// last page stays while the next of the same filter loads. A closing, a decision or a manual case
// reads every `cases` query again (`useCasesRefresh`), so the page shows what the server now holds.
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type CasesFilter = Omit<Parameters<Api['cases']['list']['query']>[0], 'cursor'>;
export type CasesPage = Awaited<ReturnType<Api['cases']['list']['query']>>;
export type CaseView = Awaited<ReturnType<Api['cases']['get']['query']>>;

const CASES = ['cases'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function useCasesPage(filter: CasesFilter, cursor: string | undefined) {
  const { client } = useAdmin();
  const filters = JSON.stringify(filter);
  return useQuery({
    queryKey: [...CASES, 'list', filters, cursor ?? null],
    queryFn: () =>
      client.api.cases.list.query({ ...filter, ...(cursor === undefined ? {} : { cursor }) }),
    staleTime: FRESH_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === filters ? previous : undefined,
  });
}

export function useCase(caseId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...CASES, 'get', caseId],
    queryFn: () => client.api.cases.get.query({ caseId }),
    staleTime: FRESH_MS,
  });
}

/** Reads the queue and the open case again, after a write. */
export function useCasesRefresh(): () => void {
  const queries = useQueryClient();
  return () => void queries.invalidateQueries({ queryKey: CASES });
}
