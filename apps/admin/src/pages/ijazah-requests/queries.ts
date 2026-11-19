// 005:T022 (B49): the ijazah requests page's reads and writes over the client, through TanStack
// Query (research R-113). Each read is audited on the server (`ijazah_requests.listed`,
// `ijazah_request.viewed`), so a page is kept a little while. A decision is keyed by the dialog that
// sends it; after one, the requests and the ijazahs are read again (an approval issues an ijazah).
import type { IjazahRequestStatus } from '@ijazah/contracts';
import { useQuery } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';
import { FRESH_MS, IJAZAH_REQUESTS, useIjazahActions } from '../ijazahs/queries';

type Api = AdminClient['api'];
export type RequestsPage = Awaited<ReturnType<Api['ijazahRequests']['list']['query']>>;
export type RequestDetail = Awaited<ReturnType<Api['ijazahRequests']['get']['query']>>;

export function useRequestsPage(
  status: IjazahRequestStatus | undefined,
  cursor: string | undefined,
) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...IJAZAH_REQUESTS, 'list', status ?? null, cursor ?? null],
    queryFn: () =>
      client.api.ijazahRequests.list.query({
        ...(status === undefined ? {} : { status }),
        ...(cursor === undefined ? {} : { cursor }),
      }),
    staleTime: FRESH_MS,
  });
}

export function useRequest(requestId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...IJAZAH_REQUESTS, 'get', requestId],
    queryFn: () => client.api.ijazahRequests.get.query({ requestId }),
    staleTime: FRESH_MS,
  });
}

/** The two decisions, each with the dialog's key; both pages read again after each. */
export function useDecisions() {
  const { client } = useAdmin();
  const { reread } = useIjazahActions();
  return {
    approve: async (requestId: string, idempotencyKey: string) => {
      await client.api.ijazahRequests.approve.mutate({ requestId, idempotencyKey });
      reread();
    },
    reject: async (requestId: string, reason: string, idempotencyKey: string) => {
      await client.api.ijazahRequests.reject.mutate({ requestId, reason, idempotencyKey });
      reread();
    },
  };
}
