// T050 (FR-390, FR-383; app-surface.md "`enrollments` and the teacher's lists"): what the student's
// enrollments and home read. The active tab is one page, ordered by next session on the server, and
// is what both the tab and the home show; the ended tab pages by the cursor the last page answered,
// handed back unread; an enrollment's detail carries its sessions. The active tab and the detail
// take the Confirming schedule (`confirming.ts`) as their interval.
import {
  type EnrollmentsGetOutput,
  enrollmentsGetInput,
  type EnrollmentsListOutput,
  type StudentEnrollmentItem,
} from '@ijazah/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';

export const ACTIVE_ENROLLMENTS_QUERY_KEY = ['student', 'enrollments', 'list', 'active'] as const;
export const ENDED_ENROLLMENTS_QUERY_KEY = ['student', 'enrollments', 'list', 'ended'] as const;

export const enrollmentQueryKey = (enrollmentId: string) =>
  ['student', 'enrollments', 'get', enrollmentId] as const;

/** The enrollment's detail and its list. */
export const ENROLLMENT_ROUTE = '/(student)/enrollments/[id]';
export const ENDED_ENROLLMENTS_ROUTE = '/(student)/enrollments/ended';
export const ACTIVE_ENROLLMENTS_ROUTE = '/(student)/(tabs)/enrollments';

/** Whether `enrollmentId` can name an enrollment at all (the procedure's own input). */
export function isEnrollmentId(enrollmentId: string): boolean {
  return enrollmentsGetInput.safeParse({ enrollmentId }).success;
}

/** The Confirming state: the enrollment awaits its payment's confirmation (FR-383, FR-384). */
export function isConfirming(item: Pick<StudentEnrollmentItem, 'status'>): boolean {
  return item.status === 'pending_payment';
}

/** `enrollments.list` on the active tab, read again every `everyMs` while it is a number. */
export function useActiveEnrollments(everyMs: number | false) {
  const { client } = useApi();
  return useQuery<EnrollmentsListOutput>({
    queryKey: ACTIVE_ENROLLMENTS_QUERY_KEY,
    queryFn: () => client.api.enrollments.list.query({ tab: 'active' }),
    refetchInterval: everyMs,
  });
}

/** `enrollments.list` on the ended tab, page by page; idle until `enabled`. */
export function useEndedEnrollments(enabled = true) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: ENDED_ENROLLMENTS_QUERY_KEY,
    queryFn: ({ pageParam }): Promise<EnrollmentsListOutput> =>
      client.api.enrollments.list.query(
        pageParam === undefined ? { tab: 'ended' } : { tab: 'ended', cursor: pageParam },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** `enrollments.get`, read again every `everyMs` while it is a number. */
export function useEnrollment(enrollmentId: string, everyMs: number | false) {
  const { client } = useApi();
  return useQuery<EnrollmentsGetOutput>({
    queryKey: enrollmentQueryKey(enrollmentId),
    queryFn: () => client.api.enrollments.get.query({ enrollmentId }),
    enabled: isEnrollmentId(enrollmentId),
    refetchInterval: everyMs,
  });
}
