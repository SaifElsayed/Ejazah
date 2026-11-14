// T051 (FR-391, FR-393; screens.md §14): one enrollment in «طلابي». The name's initial (the teacher
// sees no photo, FR-395), the name, then on the active tab the next session, «الجلسة n من N» with
// its date and time in its own zone and, when the teacher is elsewhere now, in the teacher's (D5);
// on the ended tab what was done of the package. The status over the track at the end. The row opens
// the enrollment.
import type { TeacherStudentItem } from '@ijazah/contracts';
import { View } from 'react-native';

import { Avatar, ListRow, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { avatarNameOf, usePartyName } from '../../../../lib/party';
import { useInViewerZone } from '../zone';
import { EnrollmentBadges } from './Badges';

/** The avatar's letter: the name's first (the board's «ن» for «نور سمير»). */
export function initialOf(name: string): string {
  return [...name.trim()][0] ?? '';
}

export function StudentRow({
  item,
  viewerZone,
  onPress,
}: {
  readonly item: TeacherStudentItem;
  /** The teacher's zone now (`account.me`). */
  readonly viewerZone: string | undefined;
  readonly onPress: () => void;
}) {
  const t = useT();
  const format = useFormatters();
  const inViewerZone = useInViewerZone();
  const partyName = usePartyName();
  const { next } = item;
  const progress = t('common.format.progress', {
    done: item.completed,
    total: item.summary.sessionCount,
  });
  const line =
    next === undefined
      ? progress
      : t('teacher.students.sessionOn', {
          n: next.sequenceNumber,
          total: item.summary.sessionCount,
          date: format.weekdayDate(next.startsAt, next.timezone),
          time: format.time(next.startsAt, next.timezone),
        });
  const elsewhere =
    next === undefined ? null : inViewerZone(next.startsAt, next.timezone, viewerZone);
  return (
    <ListRow
      leading={<Avatar initials={initialOf(avatarNameOf(item.student))} />}
      label={
        <View style={{ gap: tokens.space['1'] }}>
          <Text weight="bold">{partyName(item.student, 'student')}</Text>
          <Text variant="caption" tone="muted">
            {line}
          </Text>
          {elsewhere === null ? null : (
            <Text variant="caption" tone="muted">
              {elsewhere}
            </Text>
          )}
        </View>
      }
      trailing={
        <EnrollmentBadges status={item.status} paused={item.paused} track={item.summary.track} />
      }
      onPress={onPress}
    />
  );
}
