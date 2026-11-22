// 005:T023 (B49): the reports page's reads and its resolution over the client, through TanStack
// Query (research R-113). Each read is audited on the server (`reports.listed`, `report.viewed`), so
// a page is kept a little while. The resolution is keyed by the dialog that sends it; after it, the
// reports are read again. A flag raised from a report is the gender page's write (`useGenderActions`).
import type { ReportOutcome, ReportStatus } from '@ijazah/contracts/admin';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';
import { FRESH_MS, REPORTS } from '../gender/queries';

type Api = AdminClient['api'];
export type ReportsPage = Awaited<ReturnType<Api['reports']['list']['query']>>;
export type ReportRow = ReportsPage['items'][number];
export type ReportDetail = Awaited<ReturnType<Api['reports']['get']['query']>>;
export type ReportChatPage = Awaited<ReturnType<Api['reports']['chat']['query']>>;

export function useReportsPage(status: ReportStatus, cursor: string | undefined) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...REPORTS, 'list', status, cursor ?? null],
    queryFn: () =>
      client.api.reports.list.query({
        status,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    staleTime: FRESH_MS,
  });
}

export function useReport(reportId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...REPORTS, 'get', reportId],
    queryFn: () => client.api.reports.get.query({ reportId }),
    staleTime: FRESH_MS,
  });
}

/**
 * 005:T034: an open report's enrollment chat, newest first, the older pages on the administrator's
 * press; each page read is audited `chat.read` on the server, so a page is kept a little while.
 */
export function useReportChat(reportId: string, enrollmentId: string) {
  const { client } = useAdmin();
  return useInfiniteQuery({
    queryKey: [...REPORTS, 'chat', reportId, enrollmentId],
    queryFn: ({ pageParam }: { readonly pageParam: string | undefined }) =>
      client.api.reports.chat.query(
        pageParam === undefined
          ? { reportId, enrollmentId }
          : { reportId, enrollmentId, cursor: pageParam },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ReportChatPage) => last.nextCursor,
    staleTime: FRESH_MS,
  });
}

/** The report's resolution, with the dialog's key; the reports read again after it. */
export function useReportActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  return {
    resolve: async (
      reportId: string,
      outcome: ReportOutcome,
      note: string,
      idempotencyKey: string,
    ) => {
      await client.api.reports.resolve.mutate({ reportId, outcome, note, idempotencyKey });
      void queries.invalidateQueries({ queryKey: REPORTS });
    },
  };
}
