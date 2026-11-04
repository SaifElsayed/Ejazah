// T051 (FR-391, FR-393): `teacher.today` (T049) as «اليوم» calls it: the teacher's local day in the
// teacher's zone now, and its sessions by start, every status. Read again whenever the screen opens,
// which decides only on what it read since (`read-since-mount.ts`).
import type { TeacherTodayOutput } from '@ijazah/contracts';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';

export const TEACHER_TODAY_QUERY_KEY = ['teacher', 'today'] as const;

export function useTeacherToday() {
  const { client } = useApi();
  return useQuery<TeacherTodayOutput>({
    queryKey: TEACHER_TODAY_QUERY_KEY,
    queryFn: () => client.api.teacher.today.query({}),
    refetchOnMount: 'always',
  });
}
