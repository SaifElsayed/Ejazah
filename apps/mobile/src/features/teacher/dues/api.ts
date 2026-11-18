// 003:T105 (DEC-89): `teacher.dues.get`, the teacher's own releases and his share of each refund, as
// «مستحقاتي» reads it. One query; nothing here writes.
import type { TeacherDuesGetOutput } from '@ijazah/contracts';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';

export const DUES_QUERY_KEY = ['teacher', 'dues'] as const;

export function useTeacherDues() {
  const { client } = useApi();
  return useQuery<TeacherDuesGetOutput>({
    queryKey: DUES_QUERY_KEY,
    queryFn: () => client.api.teacher.dues.get.query({}),
  });
}
