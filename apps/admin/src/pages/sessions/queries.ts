// B42, T047: the enrollment and session monitor's reads over the client, through TanStack Query
// (research R-113), as the payments monitor reads (`pages/payments/queries.ts`). Each read is an
// audited `sessions.monitor.listed` or `sessions.monitor.viewed` on the server, so a page is kept a
// little while and the last page stays while the next of the same filters loads. An action reads
// the monitor again (`useRereadMonitor`), so the page shows what the server now answers.
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
type Monitor = Api['sessions']['monitor'];
export type MonitorFilter = Omit<Parameters<Monitor['list']['query']>[0], 'cursor'>;
export type EnrollmentStatus = NonNullable<MonitorFilter['status']>;
export type MonitorPage = Awaited<ReturnType<Monitor['list']['query']>>;
export type MonitorRow = MonitorPage['items'][number];
export type MonitorDetail = Awaited<ReturnType<Monitor['get']['query']>>;
export type MonitoredSession = MonitorDetail['sessions'][number];
export type MonitoredRemedy = NonNullable<MonitoredSession['remedy']>;
export type MonitoredCase = MonitorDetail['cases'][number];
export type MonitoredEvent = MonitorDetail['events'][number];

const SESSIONS = ['sessions'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function useMonitorPage(filter: MonitorFilter, cursor: string | undefined) {
  const { client } = useAdmin();
  const filters = JSON.stringify(filter);
  return useQuery({
    queryKey: [...SESSIONS, 'list', filters, cursor ?? null],
    queryFn: () =>
      client.api.sessions.monitor.list.query({
        ...filter,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    staleTime: FRESH_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === filters ? previous : undefined,
  });
}

export function useMonitoredEnrollment(enrollmentId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...SESSIONS, 'get', enrollmentId],
    queryFn: () => client.api.sessions.monitor.get.query({ enrollmentId }),
    staleTime: FRESH_MS,
  });
}

/** Reads the monitor again, the list and the enrollment, after an action the server took. */
export function useRereadMonitor(): () => Promise<void> {
  const queries = useQueryClient();
  return () => queries.invalidateQueries({ queryKey: SESSIONS });
}
