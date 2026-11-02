// T030 (FR-336, R-GENDER-2): `discovery.teacher` as the profile reads it. An excluded teacher is
// `NOT_FOUND`, the same answer as a teacher that does not exist, so the screen draws one state for
// both and the query never reads it again: the answer would not change. A link whose id is not a
// teacher id asks nothing and lands on that same state.
import { type DiscoveryTeacherOutput, discoveryTeacherInput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';

/** TanStack Query's own count of retries, where the cache sets none. */
const DEFAULT_RETRIES = 3;

export const teacherProfileQueryKey = (teacherId: string) =>
  ['student', 'discovery', 'teacher', teacherId] as const;

/** Whether `error` is the API's answer for a teacher the student may not see or that is not. */
export function isUnknownTeacher(error: unknown): boolean {
  return errorCodeOf(error) === 'NOT_FOUND';
}

/** Whether `teacherId` can name a teacher at all (the procedure's own input). */
export function isTeacherId(teacherId: string): boolean {
  return discoveryTeacherInput.safeParse({ teacherId }).success;
}

export function useDiscoveryTeacher(teacherId: string) {
  const { client } = useApi();
  const configured = useQueryClient().getDefaultOptions().queries?.retry;
  return useQuery<DiscoveryTeacherOutput>({
    queryKey: teacherProfileQueryKey(teacherId),
    queryFn: () => client.api.discovery.teacher.query({ teacherId }),
    enabled: isTeacherId(teacherId),
    retry: (failures, error) => {
      if (isUnknownTeacher(error)) return false;
      if (typeof configured === 'function') return configured(failures, error);
      if (typeof configured === 'boolean') return configured;
      return failures < (configured ?? DEFAULT_RETRIES);
    },
  });
}
