// T050 (FR-390; screens.md §6 `Enrollments`, `EnrollmentsEnded`, `SessionStates`): an enrollment's
// and a session's status as their badges say them, in the tones the boards draw. An enrollment
// awaiting payment takes its badge from its last order (`order-state.ts`). Every session status
// the API can answer has its badge, each drawn after settlement (004:T020, FR-495); the two statuses
// awaiting the administration's review share one word, as `SessionStates` draws them.
import type { EnrollmentStatus, SessionStatus } from '@ijazah/contracts';

import type { BadgeProps } from '../../../design/primitives';
import type { MessageKey } from '../../../i18n';

interface StatusBadge {
  readonly label: MessageKey;
  readonly tone: BadgeProps['tone'];
}

/** An enrollment awaiting payment takes its badge from its last order (`order-state.ts`). */
export const ENROLLMENT_STATUS: Readonly<
  Record<Exclude<EnrollmentStatus, 'pending_payment'>, StatusBadge>
> = {
  confirmed: { label: 'status.enrollment.confirmed', tone: 'success' },
  completed: { label: 'status.enrollment.completed', tone: 'success' },
  terminated_no_show: { label: 'status.enrollment.terminatedNoShow', tone: 'danger' },
  cancelled: { label: 'status.enrollment.cancelled', tone: 'neutral' },
};

/**
 * 004:T074 (FR-506): an enrollment the server answers `paused` reads «متوقف مؤقتًا» in place of its
 * status's word, with no reason, whichever tab it sits in.
 */
export const PAUSED_ENROLLMENT: StatusBadge = {
  label: 'status.enrollment.paused',
  tone: 'warning',
};

export const SESSION_STATUS: Readonly<Record<SessionStatus, StatusBadge>> = {
  scheduled: { label: 'status.session.scheduled', tone: 'neutral' },
  done: { label: 'status.session.done', tone: 'success' },
  student_no_show: { label: 'status.session.studentNoShow', tone: 'danger' },
  teacher_no_show: { label: 'status.session.teacherNoShow', tone: 'warning' },
  both_no_show: { label: 'status.session.bothNoShow', tone: 'neutral' },
  under_threshold: { label: 'status.session.underReview', tone: 'warning' },
  provider_outage: { label: 'status.session.underReview', tone: 'warning' },
  cancelled_by_agreement: { label: 'status.session.cancelledByAgreement', tone: 'neutral' },
  cancelled_by_admin: { label: 'status.session.cancelledByAdmin', tone: 'danger' },
  disputed: { label: 'status.session.disputed', tone: 'warning' },
};
