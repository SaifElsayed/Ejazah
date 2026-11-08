// T018 of specs/004-sessions (FR-434; screens.md `TeacherPreSession`): the teacher's pre-session
// screen. The teacher meets a student, so a deleted counterparty is «طالب محذوف» (T007); the join
// opens the teacher's room.
import { PreSessionScreen } from '../../../shared/room';
import { TEACHER_ROOM_ROUTE } from '../api';

export function TeacherPreSession() {
  return <PreSessionScreen counterpartyRole="student" roomRoute={TEACHER_ROOM_ROUTE} />;
}
