// T049: the disputes page's reads and writes over the client, through TanStack Query (research
// R-113). Each read is audited on the server (`disputes.listed`, `dispute.viewed`, `chat.read` per
// chat page), so a page is kept a little while. The chat is read only while the server answers
// `chatAvailable` (FR-475), page by page on the administrator's press. A ruling or a revision reads
// the queue and the dispute again.
import type { AdminOutcome, DisputesResolveInput } from '@ijazah/contracts/admin';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type DisputesPage = Awaited<ReturnType<Api['disputes']['list']['query']>>;
export type DisputeRow = DisputesPage['items'][number];
export type DisputeView = Awaited<ReturnType<Api['disputes']['get']['query']>>;
export type DisputeChatPage = Awaited<ReturnType<Api['disputes']['chat']['query']>>;
export type RevisionAnswer = Awaited<ReturnType<Api['disputes']['revise']['mutate']>>;

const DISPUTES = ['disputes'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function useDisputesPage(cursor: string | undefined) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...DISPUTES, 'list', cursor ?? null],
    queryFn: () => client.api.disputes.list.query(cursor === undefined ? {} : { cursor }),
    staleTime: FRESH_MS,
  });
}

export function useDispute(disputeId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...DISPUTES, 'get', disputeId],
    queryFn: () => client.api.disputes.get.query({ disputeId }),
    staleTime: FRESH_MS,
  });
}

/** The enrollment's chat, newest first, a page per press (the page mounts it while `chatAvailable`). */
export function useDisputeChat(disputeId: string) {
  const { client } = useAdmin();
  return useInfiniteQuery({
    queryKey: [...DISPUTES, 'chat', disputeId],
    queryFn: ({ pageParam }: { readonly pageParam: string | undefined }) =>
      client.api.disputes.chat.query(
        pageParam === undefined ? { disputeId } : { disputeId, cursor: pageParam },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: DisputeChatPage) => last.nextCursor,
    staleTime: FRESH_MS,
  });
}

/** Reads the queue and the disputes again after a ruling or a revision. */
function useReread() {
  const queries = useQueryClient();
  return () => queries.invalidateQueries({ queryKey: DISPUTES });
}

export function useResolve() {
  const { client } = useAdmin();
  const reread = useReread();
  return useMutation({
    mutationFn: (input: DisputesResolveInput) => client.api.disputes.resolve.mutate(input),
    onSuccess: reread,
  });
}

export function useRevise(disputeId: string, idempotencyKey: string) {
  const { client } = useAdmin();
  const reread = useReread();
  return useMutation({
    mutationFn: (input: { readonly outcome: AdminOutcome; readonly reason: string }) =>
      client.api.disputes.revise.mutate({ disputeId, idempotencyKey, ...input }),
    onSuccess: reread,
  });
}
