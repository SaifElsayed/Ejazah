// T045 of specs/004-sessions (FR-488 to FR-492): the student's chat with the teacher of one
// enrollment. It reads the enrollment (`enrollments.get`) for the teacher's name and the status, and
// draws the chat both roles share (`features/shared/chat`), read-only once the enrollment has ended.
// A link with no enrollment id is never read: it draws the load error, as the detail does.
// 005:T021 (FR-611, FR-614): the teacher it read (`teacher.teacherId`) is the one the chat reports.
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
  const counterpart = read === undefined ? undefined : partyName(read.teacher, 'teacher');
  return (
    <ChatScreen
      enrollmentId={enrollmentId}
      counterpart={counterpart}
      status={read?.status}
      failed={!valid || enrollment.isError}
      error={enrollment.error}
      onRetry={() => {
        if (valid) void enrollment.refetch();
      }}
      report={
        read === undefined || counterpart === undefined
          ? undefined
          : {
              userId: read.teacher.teacherId,
              role: 'teacher',
              name: counterpart,
              place: { context: 'chat', enrollmentId },
            }
      }
    />
  );
}
