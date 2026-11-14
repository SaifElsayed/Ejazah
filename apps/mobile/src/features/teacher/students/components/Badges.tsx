// T051 (screens.md §14, «Status words»): the badges the teacher's day and students draw. An
// enrollment's status beside its track (`TrackBadge`, the packages tab's); a session's status in
// SessionStates' words and tones, one word for both statuses the administration reviews, and
// «ألغتها الإدارة» neutral everywhere (decision 19).
import type { EnrollmentStatus, PackageTrack, SessionStatus } from '@ijazah/contracts';
import { View } from 'react-native';

import { Badge } from '../../../../design/primitives';
import type { StatusTone } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { TrackBadge } from '../../packages';

const ENROLLMENT: Readonly<Record<EnrollmentStatus, { key: MessageKey; tone: StatusTone }>> = {
  pending_payment: { key: 'status.enrollment.pendingPayment', tone: 'warning' },
  confirmed: { key: 'status.enrollment.confirmed', tone: 'success' },
  completed: { key: 'status.enrollment.completed', tone: 'neutral' },
  terminated_no_show: { key: 'status.enrollment.terminatedNoShow', tone: 'warning' },
  cancelled: { key: 'status.enrollment.cancelled', tone: 'neutral' },
};

const SESSION: Readonly<Record<SessionStatus, { key: MessageKey; tone: StatusTone }>> = {
  scheduled: { key: 'status.session.scheduled', tone: 'neutral' },
  done: { key: 'status.session.done', tone: 'success' },
  student_no_show: { key: 'status.session.studentNoShow', tone: 'danger' },
  teacher_no_show: { key: 'status.session.teacherNoShow', tone: 'warning' },
  both_no_show: { key: 'status.session.bothNoShow', tone: 'neutral' },
  under_threshold: { key: 'status.session.underReview', tone: 'warning' },
  provider_outage: { key: 'status.session.underReview', tone: 'warning' },
  cancelled_by_agreement: { key: 'status.session.cancelledByAgreement', tone: 'neutral' },
  cancelled_by_admin: { key: 'status.session.cancelledByAdmin', tone: 'neutral' },
  disputed: { key: 'status.session.disputed', tone: 'warning' },
};

/**
 * 004:T074 (FR-506): an enrollment the server answers `paused` reads «متوقف مؤقتًا» in place of its
 * status's word, with no reason, whichever tab it sits in.
 */
const PAUSED: { key: MessageKey; tone: StatusTone } = {
  key: 'status.enrollment.paused',
  tone: 'warning',
};

/** The enrollment's status, or «متوقف مؤقتًا» when paused, over its track, at the row's end. */
export function EnrollmentBadges({
  status,
  paused,
  track,
}: {
  readonly status: EnrollmentStatus;
  readonly paused: boolean;
  readonly track: PackageTrack;
}) {
  const t = useT();
  const { key, tone } = paused ? PAUSED : ENROLLMENT[status];
  return (
    <View style={{ alignItems: 'flex-end', gap: tokens.space['1'] }}>
      <Badge label={t(key)} tone={tone} />
      <TrackBadge track={track} />
    </View>
  );
}

export function SessionStatusBadge({ status }: { readonly status: SessionStatus }) {
  const t = useT();
  const { key, tone } = SESSION[status];
  return <Badge label={t(key)} tone={tone} />;
}
