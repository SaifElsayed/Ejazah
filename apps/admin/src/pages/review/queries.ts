// T048: the session review's reads and writes over the client, through TanStack Query (research
// R-113). The queue's pages and a session's connection record are each an audited read on the
// server (`sessions.review.listed`, `sessions.review.viewed`); after a resolution or a correction,
// both are read again, so the page shows what the server now holds. The key `review` is the one
// `/outages` reads again after a record moves sessions into the queue.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type ReviewPage = Awaited<ReturnType<Api['sessions']['review']['list']['query']>>;
export type ReviewRow = ReviewPage['items'][number];
export type Telemetry = Awaited<ReturnType<Api['sessions']['review']['get']['query']>>;
export type ResolveInput = Parameters<Api['sessions']['review']['resolve']['mutate']>[0];

export const REVIEW = ['review'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function useReviewPage(cursor: string | undefined) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...REVIEW, 'list', cursor ?? null],
    queryFn: () => client.api.sessions.review.list.query(cursor === undefined ? {} : { cursor }),
    staleTime: FRESH_MS,
    placeholderData: (previous) => previous,
  });
}

export function useTelemetry(sessionId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...REVIEW, 'get', sessionId],
    queryFn: () => client.api.sessions.review.get.query({ sessionId }),
    staleTime: FRESH_MS,
  });
}

/** Reads the queue and every connection record again. */
export function useRereadReview() {
  const queries = useQueryClient();
  return () => queries.invalidateQueries({ queryKey: REVIEW });
}

export function useResolve() {
  const { client } = useAdmin();
  const reread = useRereadReview();
  return useMutation({
    mutationFn: (input: ResolveInput) => client.api.sessions.review.resolve.mutate(input),
    onSuccess: reread,
  });
}
