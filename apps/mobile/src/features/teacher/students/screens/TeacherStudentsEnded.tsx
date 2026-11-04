// T051 (FR-391; screens.md §14): «طلابي», its ended tab, pushed over the students tab: the enrollments
// that completed, ended for the teacher's absence or were cancelled after confirmation, newest first,
// page after page, searchable by the student's name on the server. With none, and no search, it says
// so in the shape of `TeacherStudentsEmpty` (`teacher.students.endedEmpty.*`).
import { EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { StudentList } from '../components/StudentList';

export function TeacherStudentsEnded() {
  const t = useT();
  return (
    <StudentList
      tab="ended"
      whenNone={{
        state: (
          <EmptyState
            icon={{ name: 'users' }}
            title={t('teacher.students.endedEmpty.title')}
            text={t('teacher.students.endedEmpty.text')}
          />
        ),
      }}
    />
  );
}
