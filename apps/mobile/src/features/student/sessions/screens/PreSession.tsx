// T018 of specs/004-sessions (FR-434; screens.md `PreSession`): the student's pre-session screen.
// The student meets a teacher, so a deleted counterparty is «معلم محذوف» (T007); the join opens the
// student's room.
import { PreSessionScreen } from '../../../shared/room';
import { STUDENT_ROOM_ROUTE } from '../api';

export function PreSession() {
  return <PreSessionScreen counterpartyRole="teacher" roomRoute={STUDENT_ROOM_ROUTE} />;
}
