// T018 and T019 of specs/004-sessions: the teacher's sessions: the pre-session screen and the room.
export { TEACHER_PRE_SESSION_ROUTE, TEACHER_ROOM_ROUTE } from './api';
export { TeacherPreSession } from './screens/TeacherPreSession';
export { TeacherRoom } from './screens/TeacherRoom';
// T044 of specs/004-sessions (FR-465, FR-494, FR-495): the teacher's answer to a counter-proposal,
// a teacher-only panel composed on the session's screen, and the enrollment rows' remedy line.
export { CounterAnswerPanel } from './components/CounterAnswerPanel';
export { TeacherRemedyStatusLine } from './components/TeacherRemedyStatusLine';
export { answerProblemOf, type PendingCounter, pendingCounterOf } from './counter-answer';
export { useAnswerCounter } from './counter-api';
export { teacherRemedyRowKey } from './remedy-rows';
