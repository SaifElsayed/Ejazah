// 003:T105 (SRS DEC-89): «تحويلات المعلمين»'s reads and its one write over the client, through
// TanStack Query (research R-113), as the payments monitor reads (`pages/payments/queries.ts`). Each
// read is an audited `payouts.listed` or `payouts.viewed` on the server, so a page is kept a little
// while and the last page stays while the next of the same filter loads. The mark («تم الصرف») is
// keyed by the caller, and once it is done the list and the teacher's detail are read again.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Payouts = AdminClient['api']['payouts'];
export type PayoutsFilter = Omit<Parameters<Payouts['list']['query']>[0], 'cursor'>;
export type PayoutsPage = Awaited<ReturnType<Payouts['list']['query']>>;
export type PayoutsRow = PayoutsPage['items'][number];
export type PayoutsDetail = Awaited<ReturnType<Payouts['get']['query']>>;
export type PayoutReleaseRow = PayoutsDetail['releases'][number];
export type PayoutDeductionRow = PayoutsDetail['deductions'][number];

const PAYOUTS = ['payouts'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function usePayoutsPage(filter: PayoutsFilter, cursor: string | undefined) {
  const { client } = useAdmin();
  const filters = JSON.stringify(filter);
  return useQuery({
    queryKey: [...PAYOUTS, 'list', filters, cursor ?? null],
    queryFn: () =>
      client.api.payouts.list.query({ ...filter, ...(cursor === undefined ? {} : { cursor }) }),
    staleTime: FRESH_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === filters ? previous : undefined,
  });
}

export function useTeacherPayouts(teacherUserId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...PAYOUTS, 'get', teacherUserId],
    queryFn: () => client.api.payouts.get.query({ teacherUserId }),
    staleTime: FRESH_MS,
  });
}

/** «تم الصرف» on one written release, under the key its dialog minted when it opened. */
export function useMarkPaid(releaseId: string, idempotencyKey: string) {
  const { client } = useAdmin();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: () => client.api.payouts.mark.mutate({ releaseId, idempotencyKey }),
    onSuccess: () => queries.invalidateQueries({ queryKey: PAYOUTS }),
  });
}
