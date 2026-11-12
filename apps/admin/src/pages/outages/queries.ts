// T048 (FR-445; T016): the outage windows' reads and the record over the client, through TanStack
// Query (research R-113). The list is an audited read on the server (`provider_outages.listed`); a
// record reads the list again, and the review queue too (`review`, `pages/review/queries.ts`), since
// it may have moved settled sessions there.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';
import { REVIEW } from '../review/queries';

type Api = AdminClient['api'];
export type OutagesPage = Awaited<ReturnType<Api['sessions']['outages']['list']['query']>>;
export type RecordInput = Parameters<Api['sessions']['outages']['record']['mutate']>[0];

const OUTAGES = ['outages'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function useOutagesPage(cursor: string | undefined) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...OUTAGES, 'list', cursor ?? null],
    queryFn: () => client.api.sessions.outages.list.query(cursor === undefined ? {} : { cursor }),
    staleTime: FRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function useRecordOutage() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordInput) => client.api.sessions.outages.record.mutate(input),
    onSuccess: () =>
      Promise.all([
        queries.invalidateQueries({ queryKey: OUTAGES }),
        queries.invalidateQueries({ queryKey: REVIEW }),
      ]),
  });
}
