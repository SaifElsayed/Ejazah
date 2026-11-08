// T019 of specs/004-sessions (FR-433, FR-435; screens.md `SessionRoom`): the student's room. The
// student meets a teacher, so a deleted counterparty is «معلم محذوف» (T007).
import { RoomScreen } from '../../../shared/room';

export function Room() {
  return <RoomScreen counterpartyRole="teacher" />;
}
