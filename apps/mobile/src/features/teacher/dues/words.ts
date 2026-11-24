// 003:T105 (DEC-89): the words «مستحقاتي» says, each by what `teacher.dues.get` answered: a
// release's part and state (its badge's tone), and a closing case's reason. The reason crosses as
// text (`caseReason`); one the phone does not know draws no reason line rather than a raw code.
import type { ShareReleaseMilestone, ShareReleaseState } from '@ijazah/contracts';

import type { MessageKey } from '../../../i18n';

export const PART: Readonly<Record<ShareReleaseMilestone, MessageKey>> = {
  recitation_end: 'money.dues.part.recitationEnd',
  ijazah_half: 'money.dues.part.ijazahHalf',
  ijazah_end: 'money.dues.part.ijazahEnd',
  teacher_dropout: 'money.dues.part.teacherDropout',
  student_complaint_close: 'money.dues.part.studentComplaintClose',
  // 006:T001 (B-P1, the labels the owner approved 2026-11-22): the programme's two parts.
  assessment: 'money.dues.part.assessment',
  programme_stopped: 'money.dues.part.programmeStopped',
  // 003:T125 (SRS DEC-104, Q-3 (a)): an administrator's direct end, a deletion, a gender correction.
  direct_end: 'money.dues.part.directEnd',
};

export const STATE: Readonly<
  Record<
    ShareReleaseState,
    { readonly label: MessageKey; readonly tone: 'neutral' | 'warning' | 'success' }
  >
> = {
  held: { label: 'money.dues.state.held', tone: 'neutral' },
  due: { label: 'money.dues.state.due', tone: 'warning' },
  paid: { label: 'money.dues.state.paid', tone: 'success' },
};

/** The closed list of the compensation cases' reasons (moderation's), in the teacher's words. */
const REASON: Readonly<Record<string, MessageKey>> = {
  slot_unavailable: 'money.dues.reason.slotUnavailable',
  party_restricted: 'money.dues.reason.partyRestricted',
  duplicate_payment: 'money.dues.reason.duplicatePayment',
  absence_termination: 'money.dues.reason.absenceTermination',
  admin_cancellation: 'money.dues.reason.adminCancellation',
  teacher_ended: 'money.dues.reason.teacherEnded',
  student_suspended: 'money.dues.reason.studentSuspended',
  student_banned: 'money.dues.reason.studentBanned',
  student_fault_confirmed: 'money.dues.reason.studentFaultConfirmed',
  refund_choice: 'money.dues.reason.refundChoice',
  counter_unanswered: 'money.dues.reason.counterUnanswered',
  makeup_refused: 'money.dues.reason.makeupRefused',
  admin_opened_for_student: 'money.dues.reason.adminOpenedForStudent',
  admin_opened_for_teacher: 'money.dues.reason.adminOpenedForTeacher',
  teacher_suspended: 'money.dues.reason.teacherSuspended',
  admin_ended: 'money.dues.reason.adminEnded',
  gender_correction: 'money.dues.reason.genderCorrection',
  // 003:T112 (Q-4 (a)): an administrator's end on a teacher's complaint against the student.
  student_complaint_ended: 'money.dues.reason.studentComplaintEnded',
  // 003:T125 (SRS DEC-96): a student's deletion by an administrator's own case.
  account_deleted: 'money.dues.reason.accountDeleted',
};

/** The reason's words, or undefined for none or one the phone does not know. */
export function reasonKey(caseReason: string | undefined): MessageKey | undefined {
  return caseReason !== undefined && Object.hasOwn(REASON, caseReason)
    ? REASON[caseReason]
    : undefined;
}
