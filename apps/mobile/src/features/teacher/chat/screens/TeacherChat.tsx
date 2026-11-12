// T045 of specs/004-sessions (FR-488 to FR-492): the teacher's chat with the student of one
// enrollment. It reads the enrollment (`teacher.students.get`) for the student's name and the status,
// deciding only on what it read since it opened (`read-since-mount.ts`), and draws the chat both
// roles share (`features/shared/chat`), read-only once the enrollment has ended. A link with no
// enrollment id is never read: it draws the load error, as the enrollment screen does (T091).
import { useLocalSearchParams } from 'expo-router';

import { usePartyName } from '../../../../lib/party';
import { ChatScreen } from '../../../shared/chat';
import { readSinceMount } from '../../read-since-mount';
import { isEnrollmentId, useTeacherEnrollment } from '../../students/api';

export function TeacherChat() {
  const params = useLocalSearchParams<{ enrollmentId: string }>();
  const enrollmentId = typeof params.enrollmentId === 'string' ? params.enrollmentId : '';
  const valid = isEnrollmentId(enrollmentId);
  const query = useTeacherEnrollment(enrollmentId);
  const read = readSinceMount(query);
  const partyName = usePartyName();
  const shown = read.state === 'read' ? read.data : undefined;
  return (
    <ChatScreen
      enrollmentId={enrollmentId}
      counterpart={shown === undefined ? undefined : partyName(shown.student, 'student')}
      status={shown?.status}
      failed={!valid || read.state === 'failed'}
      error={query.error}
      onRetry={() => {
        if (valid) void query.refetch();
      }}
    />
  );
}
