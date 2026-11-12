// T045 of specs/004-sessions (FR-488 to FR-492): the student's chat with the teacher of one
// enrollment. It reads the enrollment (`enrollments.get`) for the teacher's name and the status, and
// draws the chat both roles share (`features/shared/chat`), read-only once the enrollment has ended.
// A link with no enrollment id is never read: it draws the load error, as the detail does.
import { useLocalSearchParams } from 'expo-router';

import { usePartyName } from '../../../../lib/party';
import { ChatScreen } from '../../../shared/chat';
import { isEnrollmentId, useEnrollment } from '../../enrollments/api';

export function StudentChat() {
  const params = useLocalSearchParams<{ id: string }>();
  const enrollmentId = typeof params.id === 'string' ? params.id : '';
  const valid = isEnrollmentId(enrollmentId);
  const enrollment = useEnrollment(enrollmentId, false);
  const partyName = usePartyName();
  const read = enrollment.data;
  return (
    <ChatScreen
      enrollmentId={enrollmentId}
      counterpart={read === undefined ? undefined : partyName(read.teacher, 'teacher')}
      status={read?.status}
      failed={!valid || enrollment.isError}
      error={enrollment.error}
      onRetry={() => {
        if (valid) void enrollment.refetch();
      }}
    />
  );
}
