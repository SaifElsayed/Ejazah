// T018 of specs/004-sessions (FR-434; screens.md `TeacherPreSession`): the teacher's pre-session
// screen. The teacher meets a student, so a deleted counterparty is «طالب محذوف» (T007); the join
// opens the teacher's room.
//
// B41 (the note under 004:T041, Q1 (a)): the teacher's panels in PreSessionScreen's one slot: the
// cancellation request (T041) and the dispute (T042), identical for both roles, and the teacher's
// answer to a counter-proposal (T044). Each reads the session itself (`sessions.get`, cached) and
// draws nothing when it has nothing to show.
import { useLocalSearchParams } from 'expo-router';

import { PreSessionScreen } from '../../../shared/room';
import { CancellationPanel, DisputePanel } from '../../../shared/sessions';
import { TEACHER_ROOM_ROUTE } from '../api';
import { CounterAnswerPanel } from '../components/CounterAnswerPanel';

export function TeacherPreSession() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = typeof id === 'string' ? id : '';
  return (
    <PreSessionScreen counterpartyRole="student" roomRoute={TEACHER_ROOM_ROUTE}>
      <CancellationPanel sessionId={sessionId} />
      <DisputePanel sessionId={sessionId} />
      <CounterAnswerPanel sessionId={sessionId} />
    </PreSessionScreen>
  );
}
