// T050 (FR-478, FR-453, FR-486; R-313, R-322; admin-surface.md, `cases`): the words `/cases`
// says, each by what the server answered. Every reason of T004 and T064 in plain words (the two
// manual reasons by their party), a complaint by its kind, a case's state and closing, a covered
// session's remedy, and a refusal by its code and `details.cause`; any other failure is the page's
// generic words (`admin.dialogs.submitError`) through T058's `errorMessageKey`, which says when
// to try again on `RATE_LIMITED`. No amount is ever said.
import type {
  CaseCoveredSession,
  CaseDetail,
  CasesListItem,
  ComplaintDecision,
} from '@ijazah/contracts/admin';

import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';

type Reason = NonNullable<CasesListItem['reason']>;
type Remedy = NonNullable<CaseCoveredSession['remedy']>;

export const REASON: Readonly<Record<Reason, MessageKey>> = {
  slot_unavailable: 'admin.cases.reason.slotUnavailable',
  party_restricted: 'admin.cases.reason.partyRestricted',
  duplicate_payment: 'admin.cases.reason.duplicatePayment',
  absence_termination: 'admin.cases.reason.absenceTermination',
  admin_cancellation: 'admin.cases.reason.adminCancellation',
  teacher_ended: 'admin.cases.reason.teacherEnded',
  student_suspended: 'admin.cases.reason.studentSuspended',
  student_banned: 'admin.cases.reason.studentBanned',
  student_fault_confirmed: 'admin.cases.reason.studentFaultConfirmed',
  refund_choice: 'admin.cases.reason.refundChoice',
  counter_unanswered: 'admin.cases.reason.counterUnanswered',
  makeup_refused: 'admin.cases.reason.makeupRefused',
  admin_opened_for_student: 'admin.cases.reason.adminOpenedForStudent',
  admin_opened_for_teacher: 'admin.cases.reason.adminOpenedForTeacher',
  // B42a, Q-B2 (a): T071's case of a teacher's suspension, which pauses the enrollment.
  teacher_suspended: 'admin.cases.reason.teacherSuspended',
  // B42c, T083 (Q-R7 (a)): T082's case of an administrator's direct end of an enrollment.
  admin_ended: 'admin.cases.reason.adminEnded',
  // 005:T014 of B47 (FR-616): a gender correction's case, one per enrollment it ended.
  gender_correction: 'admin.cases.reason.genderCorrection',
};

/** What a row is: its reason's words, or a complaint by its kind (it has no reason). */
export function caseTitle(row: Pick<CasesListItem, 'kind' | 'reason'>): MessageKey {
  if (row.kind === 'absence_complaint' || row.reason === undefined) {
    return 'admin.cases.kind.absenceComplaint';
  }
  return REASON[row.reason];
}

export const CASE_STATUS: Readonly<
  Record<
    CasesListItem['status'],
    { readonly label: MessageKey; readonly tone: 'warning' | 'success' | 'neutral' }
  >
> = {
  open: { label: 'admin.cases.status.open', tone: 'warning' },
  resolved: { label: 'admin.cases.status.resolved', tone: 'success' },
  dismissed: { label: 'admin.cases.status.dismissed', tone: 'neutral' },
};

export const RESOLUTION: Readonly<Record<NonNullable<CaseDetail['resolution']>, MessageKey>> = {
  compensation_ordered: 'admin.cases.detail.resolution.compensationOrdered',
  enrollment_ended: 'admin.cases.detail.resolution.enrollmentEnded',
  party_suspended: 'admin.cases.detail.resolution.partySuspended',
};

export const DECISION: Readonly<
  Record<ComplaintDecision, { readonly label: MessageKey; readonly effect: MessageKey }>
> = {
  end_enrollment: {
    label: 'admin.cases.decide.endEnrollment.label',
    effect: 'admin.cases.decide.endEnrollment.effect',
  },
  suspend_teacher: {
    label: 'admin.cases.decide.suspendTeacher.label',
    effect: 'admin.cases.decide.suspendTeacher.effect',
  },
  close: { label: 'admin.cases.decide.close.label', effect: 'admin.cases.decide.close.effect' },
};

export const REMEDY_KIND: Readonly<Record<Remedy['kind'], MessageKey>> = {
  makeup: 'admin.cases.detail.remedyKind.makeup',
  refund: 'admin.cases.detail.remedyKind.refund',
};

export const REMEDY_STATUS: Readonly<Record<Remedy['status'], MessageKey>> = {
  awaiting_choice: 'admin.cases.detail.remedyStatus.awaitingChoice',
  proposed: 'admin.cases.detail.remedyStatus.proposed',
  counter_proposed: 'admin.cases.detail.remedyStatus.counterProposed',
  booked: 'admin.cases.detail.remedyStatus.booked',
  refund_case: 'admin.cases.detail.remedyStatus.refundCase',
  frozen: 'admin.cases.detail.remedyStatus.frozen',
  lapsed: 'admin.cases.detail.remedyStatus.lapsed',
};

/** The refusal's `details.cause`, when it names one. */
function causeOf(error: unknown): string | undefined {
  return errorDetailsOf(error).find(({ path }) => path === 'cause')?.code;
}

/** The words of a refused resolve or dismiss (T035, T036, T071): by its code and cause. */
export function closingFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'STUDENT_SUSPENDED':
      return { key: 'admin.cases.close.refused.studentSuspended' };
    // B42b, T075 (Q-B1 (a)): a student's suspension case cleared while the teacher is suspended.
    case 'TEACHER_SUSPENDED':
      return { key: 'admin.cases.close.refused.teacherSuspended' };
    case 'NOT_FOUND':
      return { key: 'admin.cases.close.refused.notFound' };
    case 'CONFLICT': {
      const cause = causeOf(error);
      if (cause === 'not_open') return { key: 'admin.cases.close.refused.notOpen' };
      if (cause === 'no_free_week') return { key: 'admin.cases.close.refused.noFreeWeek' };
      // B42b, T075 (Q-B1 (a)): a `teacher_suspended` case closes only by the reinstatement or an end.
      if (cause === 'closed_by_reinstatement') {
        return { key: 'admin.cases.close.refused.closedByReinstatement' };
      }
      return { key: 'admin.dialogs.submitError' };
    }
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}

/** The words of a refused complaint decision (T060): by its code and cause. */
export function decisionFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'NOT_FOUND':
      return { key: 'admin.cases.decide.refused.notFound' };
    case 'CONFLICT':
      return {
        key:
          causeOf(error) === 'enrollment_not_confirmed'
            ? 'admin.cases.decide.refused.notConfirmed'
            : 'admin.dialogs.submitError',
      };
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}
