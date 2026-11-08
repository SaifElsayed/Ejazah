// T019 of specs/004-sessions (FR-433, FR-435; screens.md `SessionRoom`): the teacher's room. The
// teacher meets a student, so a deleted counterparty is «طالب محذوف» (T007).
import { RoomScreen } from '../../../shared/room';

export function TeacherRoom() {
  return <RoomScreen counterpartyRole="student" />;
}
