// T045 of specs/004-sessions (FR-488): the chat's entry on the enrollment's detail, from the
// confirmation on (`chatReachable`); an enrollment awaiting its payment has no chat yet. Approved
// beyond the task's files (the owner's decision of 2026-11-12 on B41's conflict check, Q8).
import type { EnrollmentStatus } from '@ijazah/contracts';
import { router } from 'expo-router';

import { Button } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { chatReachable } from '../../../shared/chat';
import { STUDENT_CHAT_ROUTE } from '../api';

export function ChatEntry({
  enrollmentId,
  status,
}: {
  readonly enrollmentId: string;
  readonly status: EnrollmentStatus;
}) {
  const t = useT();
  if (!chatReachable(status)) return null;
  return (
    <Button
      label={t('chat.thread.title')}
      variant="secondary"
      size="md"
      layout="block"
      icon={{ name: 'message-square' }}
      onPress={() => router.push({ pathname: STUDENT_CHAT_ROUTE, params: { id: enrollmentId } })}
    />
  );
}
