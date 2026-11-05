// T053: the payments monitor's reads over the client, through TanStack Query (research R-113). Each
// read is an audited `payments.listed` or `payments.viewed` on the server, so a page is kept a little
// while and the last page stays while the next of the same filters loads. Nothing here writes: the
// monitor has no mutation (FR-401).
import { useQuery } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type PaymentsFilter = Omit<Parameters<Api['payments']['list']['query']>[0], 'cursor'>;
export type PaymentStatus = NonNullable<PaymentsFilter['status']>;
export type PaymentsPage = Awaited<ReturnType<Api['payments']['list']['query']>>;
export type PaymentRow = PaymentsPage['items'][number];
export type PaymentDetail = Awaited<ReturnType<Api['payments']['get']['query']>>;

const PAYMENTS = ['payments'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function usePaymentsPage(filter: PaymentsFilter, cursor: string | undefined) {
  const { client } = useAdmin();
  const filters = JSON.stringify(filter);
  return useQuery({
    queryKey: [...PAYMENTS, 'list', filters, cursor ?? null],
    queryFn: () =>
      client.api.payments.list.query({ ...filter, ...(cursor === undefined ? {} : { cursor }) }),
    staleTime: FRESH_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === filters ? previous : undefined,
  });
}

export function usePayment(paymentId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...PAYMENTS, 'get', paymentId],
    queryFn: () => client.api.payments.get.query({ paymentId }),
    staleTime: FRESH_MS,
  });
}
