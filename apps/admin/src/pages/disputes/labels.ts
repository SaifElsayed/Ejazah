// T049: the words the disputes page prints for a session's status, a dispute's state and a ruling.
import type { SessionStatus } from '@ijazah/contracts';
import type { DisputeDetail, DisputeResolution } from '@ijazah/contracts/admin';

import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';

export const SESSION_STATUS: Readonly<Record<SessionStatus, MessageKey>> = {
  scheduled: 'admin.status.session.scheduled',
  done: 'admin.status.session.done',
  student_no_show: 'admin.status.session.studentNoShow',
  teacher_no_show: 'admin.status.session.teacherNoShow',
  both_no_show: 'admin.status.session.bothNoShow',
  under_threshold: 'admin.status.session.underThreshold',
  provider_outage: 'admin.status.session.providerOutage',
  cancelled_by_agreement: 'admin.status.session.cancelledByAgreement',
  cancelled_by_admin: 'admin.status.session.cancelledByAdmin',
  disputed: 'admin.status.session.disputed',
};

export const DISPUTE_STATE: Readonly<
  Record<DisputeDetail['status'], { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  open: { label: 'admin.disputes.state.open', tone: 'warning' },
  resolved: { label: 'admin.disputes.state.resolved', tone: 'neutral' },
  dismissed: { label: 'admin.disputes.state.dismissed', tone: 'neutral' },
};

export const RULING: Readonly<Record<DisputeResolution, MessageKey>> = {
  upheld: 'admin.disputes.ruling.upheld',
  re_marked: 'admin.disputes.ruling.re_marked',
  no_show_recorded: 'admin.disputes.ruling.no_show_recorded',
  compensation_ordered: 'admin.disputes.ruling.compensation_ordered',
  party_suspended: 'admin.disputes.ruling.party_suspended',
  party_banned: 'admin.disputes.ruling.party_banned',
};

/** Who raised the dispute and when, as the board words it. */
export const RAISED_BY: Readonly<Record<'student' | 'teacher', MessageKey>> = {
  student: 'admin.disputes.raisedByStudent',
  teacher: 'admin.disputes.raisedByTeacher',
};

/** A party by its role in the enrollment. */
export const ROLE: Readonly<Record<'student' | 'teacher', MessageKey>> = {
  student: 'admin.disputes.columns.student',
  teacher: 'admin.disputes.columns.teacher',
};
