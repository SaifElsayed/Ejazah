// T051 (FR-391, FR-393; screens.md §14): one session of the teacher's day. Its start in its own zone,
// the student, «{subject} · الجلسة n من N · {minutes} د», and when the teacher's zone is now another,
// the session there too (ADR 0009 D5). A session with an outcome carries its badge; one to come, the
// way forward. The row opens the enrollment. The current session's join and a student's cancel
// request are Phase 3's.
import type { TeacherTodaySession } from '@ijazah/contracts';
import { View } from 'react-native';

import { ListRow, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { usePartyName } from '../../../../lib/party';
import { useSubjectName } from '../../../../lib/subjects';
import { openEnrollment, SessionStatusBadge, useInViewerZone } from '../../students';

export function AgendaRow({
  session,
  viewerZone,
}: {
  readonly session: TeacherTodaySession;
  /** The zone the day was taken in, the teacher's now. */
  readonly viewerZone: string;
}) {
  const t = useT();
  const format = useFormatters();
  const nameOf = useSubjectName();
  const partyName = usePartyName();
  const inViewerZone = useInViewerZone();
  const elsewhere = inViewerZone(session.startsAt, session.timezone, viewerZone);
  return (
    <ListRow
      leading={
        <Text variant="callout" weight="medium">
          {format.time(session.startsAt, session.timezone)}
        </Text>
      }
      label={
        <View style={{ gap: tokens.space['1'] }}>
          <Text weight="medium">{partyName(session.student, 'student')}</Text>
          <Text variant="caption" tone="muted">
            {t('teacher.today.rowMeta', {
              subject: nameOf(session.summary.subject),
              n: session.sequenceNumber,
              total: session.summary.sessionCount,
              minutes: session.summary.sessionDurationMinutes,
            })}
          </Text>
          {elsewhere === null ? null : (
            <Text variant="caption" tone="muted">
              {elsewhere}
            </Text>
          )}
        </View>
      }
      {...(session.status === 'scheduled'
        ? {}
        : { trailing: <SessionStatusBadge status={session.status} /> })}
      onPress={() => openEnrollment(session.enrollmentId)}
    />
  );
}
