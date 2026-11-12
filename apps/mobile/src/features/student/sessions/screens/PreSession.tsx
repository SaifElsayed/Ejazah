// T018 of specs/004-sessions (FR-434; screens.md `PreSession`): the student's pre-session screen.
// The student meets a teacher, so a deleted counterparty is «معلم محذوف» (T007); the join opens the
// student's room.
//
// B41 (the note under 004:T041, Q1 (a)): the student's panels in PreSessionScreen's one slot: the
// cancellation request (T041) and the dispute (T042), identical for both roles, and the student's
// remedy (T043). Each reads the session itself (`sessions.get`, cached) and draws nothing when it
// has nothing to show.
import { useLocalSearchParams } from 'expo-router';

import { StudentRemedyPanel } from '../../remedies';
import { PreSessionScreen } from '../../../shared/room';
import { CancellationPanel, DisputePanel } from '../../../shared/sessions';
import { STUDENT_ROOM_ROUTE } from '../api';

export function PreSession() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = typeof id === 'string' ? id : '';
  return (
    <PreSessionScreen counterpartyRole="teacher" roomRoute={STUDENT_ROOM_ROUTE}>
      <CancellationPanel sessionId={sessionId} />
      <DisputePanel sessionId={sessionId} />
      <StudentRemedyPanel sessionId={sessionId} />
    </PreSessionScreen>
  );
}
