// T051 (FR-391): `teacher.students.list` and `teacher.students.get` (T049) as «طلابي» calls them. One
// list is a tab and a search: its pages are an infinite query whose next page is asked with the
// cursor the last page answered (the active tab answers one page, the ended one pages). The search
// is the server's: what the teacher typed goes in `query`, folded there (R-203), never filtered here.
// Every read runs again when a screen opens, which decides only on what it read since
// (`read-since-mount.ts`).
import {
  type TeacherStudentsGetOutput,
  teacherStudentsGetInput,
  type TeacherStudentsListInput,
  type TeacherStudentsListOutput,
} from '@ijazah/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';

/** What one list asks: everything but the cursor, which the pages carry. */
export type StudentsQuery = Omit<TeacherStudentsListInput, 'cursor'>;

export function studentsQueryKey(query: StudentsQuery) {
  return ['teacher', 'students', 'list', query] as const;
}

export function enrollmentQueryKey(enrollmentId: string) {
  return ['teacher', 'students', 'get', enrollmentId] as const;
}

export function useTeacherStudents(query: StudentsQuery) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: studentsQueryKey(query),
    queryFn: ({ pageParam }): Promise<TeacherStudentsListOutput> =>
      client.api.teacher.students.list.query(
        pageParam === undefined ? query : { ...query, cursor: pageParam },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
    refetchOnMount: 'always',
  });
}

/** Whether `enrollmentId` can name an enrollment at all (the procedure's own input, T091). */
export function isEnrollmentId(enrollmentId: string): boolean {
  return teacherStudentsGetInput.safeParse({ enrollmentId }).success;
}

/** `teacher.students.get`; a link with no enrollment id is never read (T091). */
export function useTeacherEnrollment(enrollmentId: string) {
  const { client } = useApi();
  return useQuery<TeacherStudentsGetOutput>({
    queryKey: enrollmentQueryKey(enrollmentId),
    queryFn: () => client.api.teacher.students.get.query({ enrollmentId }),
    enabled: isEnrollmentId(enrollmentId),
    refetchOnMount: 'always',
  });
}
