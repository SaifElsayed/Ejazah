// T051 (FR-391, FR-393; screens.md §14): «طلابي», its active tab: the teacher's confirmed enrollments
// by next session, searchable by the student's name on the server. No student yet, and no search, is
// `TeacherStudentsEmpty`.
import { StudentList } from '../components/StudentList';
import { TeacherStudentsEmpty } from './TeacherStudentsEmpty';

export function TeacherStudents() {
  return <StudentList tab="active" whenNone={{ screen: <TeacherStudentsEmpty /> }} />;
}
