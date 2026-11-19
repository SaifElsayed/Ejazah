// B42, T047: how `/sessions` names what the server answered. Each status, reason, remedy state and
// timeline kind by its catalogue key; a time a session or a remedy names in its own zone with its
// city (R-TIME-3), and an instant in the panel's zone, both through the panel's helpers
// (`lib/format.ts`, `lib/zone.ts`); and each refusal the task names in plain words by its code and
// `details.cause`, any other failure the generic `admin.dialogs.submitError` through T058's
// `errorMessageKey`, which says when to try again on `RATE_LIMITED`.
import type { StatusTone } from '../../design/components';
import type { Locale, MessageKey, useT } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { cityName, dayMonth, timeOfDay } from '../../lib/format';
import type {
  EnrollmentStatus,
  MonitoredCase,
  MonitoredEvent,
  MonitoredRemedy,
  MonitoredSession,
} from './queries';

type Translate = ReturnType<typeof useT>;

interface Drawn {
  readonly label: MessageKey;
  readonly tone: StatusTone;
}

export const ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = [
  'pending_payment',
  'confirmed',
  'completed',
  'terminated_no_show',
  'cancelled',
];

export const ENROLLMENT_STATUS: Readonly<Record<EnrollmentStatus, Drawn>> = {
  pending_payment: { label: 'admin.status.enrollment.pendingPayment', tone: 'warning' },
  confirmed: { label: 'admin.status.enrollment.confirmed', tone: 'success' },
  completed: { label: 'admin.status.enrollment.completed', tone: 'neutral' },
  terminated_no_show: { label: 'admin.status.enrollment.terminatedNoShow', tone: 'danger' },
  cancelled: { label: 'admin.status.enrollment.cancelled', tone: 'danger' },
};

export const SESSION_STATUS: Readonly<Record<MonitoredSession['status'], Drawn>> = {
  scheduled: { label: 'admin.status.session.scheduled', tone: 'neutral' },
  done: { label: 'admin.status.session.done', tone: 'success' },
  student_no_show: { label: 'admin.status.session.studentNoShow', tone: 'warning' },
  teacher_no_show: { label: 'admin.status.session.teacherNoShow', tone: 'danger' },
  both_no_show: { label: 'admin.status.session.bothNoShow', tone: 'warning' },
  under_threshold: { label: 'admin.status.session.underThreshold', tone: 'warning' },
  provider_outage: { label: 'admin.status.session.providerOutage', tone: 'warning' },
  cancelled_by_agreement: { label: 'admin.status.session.cancelledByAgreement', tone: 'neutral' },
  cancelled_by_admin: { label: 'admin.status.session.cancelledByAdmin', tone: 'neutral' },
  disputed: { label: 'admin.status.session.disputed', tone: 'warning' },
  postponed: { label: 'admin.status.session.postponed', tone: 'neutral' },
};

export const TRACK: Readonly<Record<'recitation' | 'ijazah_track', MessageKey>> = {
  recitation: 'admin.status.track.recitation',
  ijazah_track: 'admin.status.track.ijazah',
};

export const REMEDY_KIND: Readonly<Record<MonitoredRemedy['kind'], MessageKey>> = {
  makeup: 'admin.sessions.remedy.kind.makeup',
  refund: 'admin.sessions.remedy.kind.refund',
};

export const REMEDY_STATUS: Readonly<Record<MonitoredRemedy['status'], MessageKey>> = {
  awaiting_choice: 'admin.sessions.remedy.status.awaitingChoice',
  proposed: 'admin.sessions.remedy.status.proposed',
  counter_proposed: 'admin.sessions.remedy.status.counterProposed',
  booked: 'admin.sessions.remedy.status.booked',
  refund_case: 'admin.sessions.remedy.status.refundCase',
  frozen: 'admin.sessions.remedy.status.frozen',
  lapsed: 'admin.sessions.remedy.status.lapsed',
};

/** A remedy the manual case may take over (T064; admin-surface.md, `RemedyMonitor`). */
export function isOpenRemedy(remedy: MonitoredRemedy): boolean {
  return (
    remedy.status === 'awaiting_choice' ||
    remedy.status === 'proposed' ||
    remedy.status === 'counter_proposed' ||
    remedy.status === 'frozen'
  );
}

export const CASE_REASON: Readonly<Record<MonitoredCase['reason'], MessageKey>> = {
  slot_unavailable: 'admin.sessions.caseReason.slotUnavailable',
  party_restricted: 'admin.sessions.caseReason.partyRestricted',
  duplicate_payment: 'admin.sessions.caseReason.duplicatePayment',
  absence_termination: 'admin.sessions.caseReason.absenceTermination',
  admin_cancellation: 'admin.sessions.caseReason.adminCancellation',
  teacher_ended: 'admin.sessions.caseReason.teacherEnded',
  student_suspended: 'admin.sessions.caseReason.studentSuspended',
  student_banned: 'admin.sessions.caseReason.studentBanned',
  student_fault_confirmed: 'admin.sessions.caseReason.studentFaultConfirmed',
  refund_choice: 'admin.sessions.caseReason.refundChoice',
  counter_unanswered: 'admin.sessions.caseReason.counterUnanswered',
  makeup_refused: 'admin.sessions.caseReason.makeupRefused',
  admin_opened_for_student: 'admin.sessions.caseReason.adminOpenedForStudent',
  admin_opened_for_teacher: 'admin.sessions.caseReason.adminOpenedForTeacher',
  // B42a, Q-B2 (a): T071's case of a teacher's suspension, which pauses the enrollment.
  teacher_suspended: 'admin.sessions.caseReason.teacherSuspended',
  // B42c, T083 (Q-R7 (a)): T082's case of an administrator's direct end of the enrollment.
  admin_ended: 'admin.sessions.caseReason.adminEnded',
  // 005:T014 of B47 (FR-616): a gender correction's case, one per enrollment it ended.
  gender_correction: 'admin.sessions.caseReason.genderCorrection',
  // 003:T112 (Q-4 (a)): the case of the administrator's end on a complaint against the student.
  student_complaint_ended: 'admin.sessions.endCause.caseReason',
};

export const CASE_STATUS: Readonly<Record<MonitoredCase['status'], Drawn>> = {
  open: { label: 'admin.sessions.caseStatus.open', tone: 'warning' },
  resolved: { label: 'admin.sessions.caseStatus.resolved', tone: 'success' },
  dismissed: { label: 'admin.sessions.caseStatus.dismissed', tone: 'neutral' },
};

const EVENT_KIND: Readonly<Record<MonitoredEvent['kind'], MessageKey>> = {
  confirmed: 'admin.sessions.event.kind.confirmed',
  order_failed: 'admin.sessions.event.kind.orderFailed',
  cancelled: 'admin.sessions.event.kind.cancelled',
  completed: 'admin.sessions.event.kind.completed',
  terminated_no_show: 'admin.sessions.event.kind.terminatedNoShow',
  restored: 'admin.sessions.event.kind.restored',
  settled: 'admin.sessions.event.kind.settled',
  cancellation_requested: 'admin.sessions.event.kind.cancellationRequested',
  cancellation_accepted: 'admin.sessions.event.kind.cancellationAccepted',
  cancellation_declined: 'admin.sessions.event.kind.cancellationDeclined',
  cancellation_expired: 'admin.sessions.event.kind.cancellationExpired',
  cancelled_by_admin: 'admin.sessions.event.kind.cancelledByAdmin',
  remedy_offered: 'admin.sessions.event.kind.remedyOffered',
  counter_proposed: 'admin.sessions.event.kind.counterProposed',
  counter_accepted: 'admin.sessions.event.kind.counterAccepted',
  counter_declined: 'admin.sessions.event.kind.counterDeclined',
  counter_withdrawn: 'admin.sessions.event.kind.counterWithdrawn',
  remedy_frozen: 'admin.sessions.event.kind.remedyFrozen',
  makeup_booked: 'admin.sessions.event.kind.makeupBooked',
  remedy_handed_to_case: 'admin.sessions.event.kind.remedyHandedToCase',
  remedy_lapsed: 'admin.sessions.event.kind.remedyLapsed',
  dispute_raised: 'admin.sessions.event.kind.disputeRaised',
  dispute_resolved: 'admin.sessions.event.kind.disputeResolved',
  dispute_revised: 'admin.sessions.event.kind.disputeRevised',
  review_resolved: 'admin.sessions.event.kind.reviewResolved',
  outage_reclassified: 'admin.sessions.event.kind.outageReclassified',
  complaint_raised: 'admin.sessions.event.kind.complaintRaised',
  complaint_decided: 'admin.sessions.event.kind.complaintDecided',
  outcome_corrected: 'admin.sessions.event.kind.outcomeCorrected',
  instants_reresolved: 'admin.sessions.event.kind.instantsReresolved',
  counter_booking_refused: 'admin.sessions.event.kind.counterBookingRefused',
  // B42a, Q-B2 (a): T069's two kinds, a held slot's release and a hold's end.
  slot_released: 'admin.sessions.event.kind.slotReleased',
  slot_hold_ended: 'admin.sessions.event.kind.slotHoldEnded',
  // 003:T112 (Q-2 (a)): a session its party postponed.
  postponed: 'admin.sessions.postponement.event',
};

const CANCELLATION_REASON: Readonly<
  Record<NonNullable<MonitoredEvent['cancellationReason']>, MessageKey>
> = {
  payment_expired: 'admin.payments.cancellationReasons.paymentExpired',
  payment_failed: 'admin.payments.cancellationReasons.paymentFailed',
  admin: 'admin.payments.cancellationReasons.admin',
  gender_correction: 'admin.payments.cancellationReasons.genderCorrection',
  teacher_suspended: 'admin.payments.cancellationReasons.teacherSuspended',
  slot_unavailable: 'admin.payments.cancellationReasons.slotUnavailable',
  checkout_abandoned: 'admin.payments.cancellationReasons.checkoutAbandoned',
  account_deleted: 'admin.payments.cancellationReasons.accountDeleted',
};

/** An instant in the panel's zone: «14 أكتوبر · 2:00 م». */
export function instant(value: string, t: Translate, locale: Locale, zone: string): string {
  return t('admin.common.dateTime', {
    date: dayMonth(value, locale, zone),
    time: timeOfDay(value, locale, zone),
  });
}

/** A time a session or a remedy names, in its own zone with its city (R-TIME-3). */
export function ownTime(
  time: { readonly localDate: string; readonly timezone: string; readonly startsAt: string },
  t: Translate,
  locale: Locale,
): string {
  return t('admin.sessions.time.session', {
    date: dayMonth(time.localDate, locale, time.timezone),
    time: timeOfDay(time.startsAt, locale, time.timezone),
    city: cityName(time.timezone, locale),
  });
}

/** The same instant in the panel's zone. */
export function panelTime(startsAt: string, t: Translate, locale: Locale, zone: string): string {
  return t('admin.sessions.time.panel', {
    date: dayMonth(startsAt, locale, zone),
    time: timeOfDay(startsAt, locale, zone),
  });
}

/** A timeline row's title, its session's number when it names one, and what it changed. */
export function eventWords(
  event: MonitoredEvent,
  numbers: ReadonlyMap<string, number>,
  t: Translate,
  locale: Locale,
  zone: string,
): { readonly title: string; readonly detail?: string } {
  const kind = t(EVENT_KIND[event.kind], {
    reason:
      event.cancellationReason === undefined
        ? t('admin.payments.dash')
        : t(CANCELLATION_REASON[event.cancellationReason]),
  });
  const n = event.sessionId === undefined ? undefined : numbers.get(event.sessionId);
  const title = n === undefined ? kind : t('admin.sessions.event.withSession', { event: kind, n });
  if (event.outcomeBefore !== undefined && event.outcomeAfter !== undefined) {
    return {
      title,
      detail: t('admin.sessions.event.outcomeChange', {
        before: t(SESSION_STATUS[event.outcomeBefore].label),
        after: t(SESSION_STATUS[event.outcomeAfter].label),
      }),
    };
  }
  if (event.previousStartAt !== undefined) {
    return {
      title,
      detail: t('admin.sessions.event.previousStart', {
        when: instant(event.previousStartAt, t, locale, zone),
      }),
    };
  }
  return { title };
}

/** The value of a refusal's detail at `path` (`cause`). */
function detailOf(error: unknown, path: string): string | undefined {
  return errorDetailsOf(error).find((each) => each.path === path)?.code;
}

const CANCEL_REFUSALS: Readonly<Record<string, MessageKey>> = {
  SESSION_NOT_SCHEDULED: 'admin.sessions.cancel.refused.notScheduled',
  NOT_FOUND: 'admin.sessions.cancel.refused.notFound',
};

/** The words of a refused cancellation (FR-460). */
export function cancelFailure(error: unknown): ErrorMessage {
  const code = errorCodeOf(error);
  const named = code === undefined ? undefined : CANCEL_REFUSALS[code];
  return named === undefined ? errorMessageKey(error, 'admin.dialogs.submitError') : { key: named };
}

const RESTORE_CAUSES: Readonly<Record<string, MessageKey>> = {
  not_restorable: 'admin.sessions.restore.refused.notRestorable',
  window_closed: 'admin.sessions.restore.refused.windowClosed',
  case_closed: 'admin.sessions.restore.refused.caseClosed',
  party_restricted: 'admin.sessions.restore.refused.partyRestricted',
  slot_inactive: 'admin.sessions.restore.refused.slotInactive',
  slot_changed: 'admin.sessions.restore.refused.slotChanged',
  slot_taken: 'admin.sessions.restore.refused.slotTaken',
  time_taken: 'admin.sessions.restore.refused.timeTaken',
  // B42b, T075 (N11): T073's ninth cause, an order of the enrollment refunded at the gateway.
  refunded: 'admin.sessions.restore.refused.refunded',
  // 005:T023 (the follow-up under T023): 005:T014's step-3 cause, a pairing of two declared genders.
  gender_mismatch: 'admin.sessions.restore.refused.genderMismatch',
};

/** The words of a refused restore (FR-454): its ten causes (005:T023 added `gender_mismatch`), `no_free_week`, the key reused. */
export function restoreFailure(error: unknown): ErrorMessage {
  const cause = detailOf(error, 'cause');
  switch (errorCodeOf(error)) {
    case 'RESTORE_REFUSED':
      return {
        key:
          (cause === undefined ? undefined : RESTORE_CAUSES[cause]) ?? 'admin.dialogs.submitError',
      };
    case 'CONFLICT':
      return {
        key:
          cause === 'no_free_week'
            ? 'admin.sessions.restore.refused.noFreeWeek'
            : 'admin.shared.keyReused',
      };
    case 'NOT_FOUND':
      return { key: 'admin.sessions.restore.refused.notFound' };
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}

/**
 * B42b, T075 of specs/004-sessions (FR-503; T070's `enrollments.releaseSlot`): the words of a
 * refused release, `slot_not_held` by its cause, a reused key, `NOT_FOUND`.
 */
export function releaseFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'CONFLICT':
      return {
        key:
          detailOf(error, 'cause') === 'slot_not_held'
            ? 'admin.sessions.release.refused.slotNotHeld'
            : 'admin.shared.keyReused',
      };
    case 'NOT_FOUND':
      return { key: 'admin.sessions.release.refused.notFound' };
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}

/** A refused end's words, and the complaint `complaint_open` names, when it names one. */
export interface EndFailure extends ErrorMessage {
  readonly complaintId?: string;
}

/**
 * B42c, T083 of specs/004-sessions (FR-513; SRS FR-CANCEL-10; T082's `sessions.endEnrollment`): the
 * words of a refused end. `complaint_open` in plain words, naming the open complaint by its
 * `caseId` detail (Q-R6 (a); T072's `restore_failed` naming its enrollment the precedent); every
 * other failure, `enrollment_not_confirmed`, `NOT_FOUND` and `RATE_LIMITED` among them, through
 * `errorMessageKey`.
 */
export function endFailure(error: unknown): EndFailure {
  if (errorCodeOf(error) === 'CONFLICT' && detailOf(error, 'cause') === 'complaint_open') {
    const complaintId = detailOf(error, 'caseId');
    return complaintId === undefined
      ? { key: 'admin.sessions.end.refused.complaintOpen' }
      : { key: 'admin.sessions.end.refused.complaintOpen', complaintId };
  }
  return errorMessageKey(error, 'admin.dialogs.submitError');
}

/** The hold of a closed enrollment the monitor answered, for the restore's words. */
export type SlotHold =
  | { readonly state: 'held'; readonly until: string }
  | { readonly state: 'released'; readonly at: string };

/**
 * B42b, T075 (DEC-69; N11): the hold of a restorable closing: released at `slotReleasedAt`, else
 * held until T070's `slotHeldUntil`, else (an older answer) until the deprecated `restorableUntil`,
 * the same instant; none when the closing is not restorable.
 */
export function slotHoldOf(enrollment: {
  readonly restorableUntil?: string | undefined;
  readonly slotHeldUntil?: string | undefined;
  readonly slotReleasedAt?: string | undefined;
}): SlotHold | undefined {
  if (enrollment.slotReleasedAt !== undefined) {
    return { state: 'released', at: enrollment.slotReleasedAt };
  }
  const until = enrollment.slotHeldUntil ?? enrollment.restorableUntil;
  return until === undefined ? undefined : { state: 'held', until };
}
