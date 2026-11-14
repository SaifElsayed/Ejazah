// T050 (FR-390, FR-393; screens.md §6 `Enrollments`, `EnrollmentsEnded`): one enrollment as the
// tabs and the home draw it: the package line with its track, the teacher (with the day it
// completed on the ended tab), the status, the next session (the first while the enrollment has
// not started) in the student's zone and the teacher's, the upcoming, completed and remaining
// sessions the server counted (FR-392), and the day it runs until. No price and no photo: the
// summary carries neither (T049).
import type { StudentEnrollmentItem } from '@ijazah/contracts';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Badge, Card, Stats, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { usePartyName } from '../../../../lib/party';
import { useSubjectName } from '../../../../lib/subjects';
import { ENROLLMENT_STATUS, PAUSED_ENROLLMENT } from '../status';
import { SessionWhen } from './SessionWhen';

/** The active tab's statuses: an enrollment runs until its last session. */
const isActive = (status: StudentEnrollmentItem['status']) =>
  status === 'pending_payment' || status === 'confirmed';

const TRACK_LABEL: Readonly<Record<StudentEnrollmentItem['summary']['track'], MessageKey>> = {
  recitation: 'common.track.recitation',
  ijazah_track: 'common.track.ijazahTrack',
};

/** The package line and its track badge. */
export function PackageLine({ summary }: { readonly summary: StudentEnrollmentItem['summary'] }) {
  const t = useT();
  const nameOf = useSubjectName();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: tokens.space['2'],
      }}
    >
      <Text variant="headline">
        {t('common.format.packageFull', {
          subject: nameOf(summary.subject),
          count: summary.sessionCount,
          minutes: summary.sessionDurationMinutes,
        })}
      </Text>
      <Badge
        label={t(TRACK_LABEL[summary.track])}
        tone={summary.track === 'ijazah_track' ? 'accent' : 'neutral'}
      />
    </View>
  );
}

/**
 * The enrollment's status badge; one awaiting payment draws `pending`, its order's badge
 * (`PendingOrderBadge`), or nothing.
 */
export function EnrollmentStatusBadge({
  status,
  paused,
  pending = null,
}: {
  readonly status: StudentEnrollmentItem['status'];
  /** 004:T074 (FR-506): «متوقف مؤقتًا» in place of the status's word. */
  readonly paused: boolean;
  readonly pending?: ReactNode;
}) {
  const t = useT();
  if (paused) return <Badge label={t(PAUSED_ENROLLMENT.label)} tone={PAUSED_ENROLLMENT.tone} />;
  if (status === 'pending_payment') return pending;
  const badge = ENROLLMENT_STATUS[status];
  return <Badge label={t(badge.label)} tone={badge.tone} />;
}

/** Upcoming, completed and remaining sessions, as the server counted them (FR-390, FR-392). */
export function SessionCounts({ item }: { readonly item: StudentEnrollmentItem }) {
  const t = useT();
  const format = useFormatters();
  return (
    <Stats
      items={[
        { value: format.number(item.completed), label: t('student.enrollments.stat.completed') },
        { value: format.number(item.upcoming), label: t('student.enrollments.stat.upcoming') },
        { value: format.number(item.remaining), label: t('student.enrollments.stat.remaining') },
      ]}
    />
  );
}

export function EnrollmentCard({
  item,
  zone,
  onPress,
  pendingBadge,
}: {
  readonly item: StudentEnrollmentItem;
  /** The student's own zone. */
  readonly zone: string;
  readonly onPress: () => void;
  /** The badge of an enrollment awaiting payment (`PendingOrderBadge`). */
  readonly pendingBadge?: ReactNode;
}) {
  const t = useT();
  const format = useFormatters();
  const partyName = usePartyName();
  const teacher = partyName(item.teacher, 'teacher');
  const { next, last } = item;
  const completedOn =
    item.status === 'completed' && last !== undefined
      ? t('student.enrollments.card.completedOn', {
          teacher,
          date: format.date(last.startsAt, zone),
        })
      : undefined;
  return (
    <Card onPress={onPress}>
      <PackageLine summary={item.summary} />
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: tokens.space['2'],
        }}
      >
        <Text tone="muted">{completedOn ?? teacher}</Text>
        <EnrollmentStatusBadge status={item.status} paused={item.paused} pending={pendingBadge} />
      </View>
      {next === undefined ? null : (
        <View style={{ gap: tokens.space['1'] }}>
          <Text variant="callout" weight="medium">
            {t(
              next.sequenceNumber === 1
                ? 'student.enrollments.card.firstSession'
                : 'student.enrollments.card.nextSession',
            )}
          </Text>
          <SessionWhen session={next} zone={zone} />
        </View>
      )}
      <SessionCounts item={item} />
      {last === undefined || !isActive(item.status) ? null : (
        <Text variant="caption" tone="muted">
          {t('student.enrollments.card.until', { date: format.date(last.startsAt, zone) })}
        </Text>
      )}
    </Card>
  );
}
