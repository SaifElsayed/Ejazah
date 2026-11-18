// 003:T105 (SRS DEC-89): the words «تحويلات المعلمين» says, each by what the server answered: a
// release's part and state, a closing case's reason (the cases page's own words), and a refused
// «تم الصرف» by its code: `NOT_FOUND`, `CONFLICT` with `already_marked` (another key's conflict is
// the panel's reused-key words), and `RATE_LIMITED` with when to try again through T058's
// `errorMessageKey`, which keeps the generic words for any other failure. A refused «التراجع عن
// الصرف» likewise: `NOT_FOUND`, `CONFLICT` with `not_marked`, `RATE_LIMITED`.
import type { ShareReleaseMilestone, ShareReleaseState } from '@ijazah/contracts';

import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';
import { REASON } from '../cases/words';

export const PART: Readonly<Record<ShareReleaseMilestone, MessageKey>> = {
  recitation_end: 'admin.money.payouts.part.recitationEnd',
  ijazah_half: 'admin.money.payouts.part.ijazahHalf',
  ijazah_end: 'admin.money.payouts.part.ijazahEnd',
  teacher_dropout: 'admin.money.payouts.part.teacherDropout',
  student_complaint_close: 'admin.money.payouts.part.studentComplaintClose',
};

export const STATE: Readonly<
  Record<ShareReleaseState, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  held: { label: 'admin.money.payouts.state.held', tone: 'neutral' },
  due: { label: 'admin.money.payouts.state.due', tone: 'warning' },
  paid: { label: 'admin.money.payouts.state.paid', tone: 'success' },
};

/** A closing case's reason in the cases page's words; one the panel does not know, «سبب آخر». */
export function caseReasonLabel(reason: string): MessageKey {
  return Object.hasOwn(REASON, reason)
    ? REASON[reason as keyof typeof REASON]
    : 'admin.money.payouts.detail.reasonOther';
}

/** The words of a refused «تم الصرف». */
export function markFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'NOT_FOUND':
      return { key: 'admin.money.payouts.mark.refused.notFound' };
    case 'CONFLICT':
      return {
        key: errorDetailsOf(error).some(({ code }) => code === 'already_marked')
          ? 'admin.money.payouts.mark.refused.alreadyMarked'
          : 'admin.shared.keyReused',
      };
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}

/** The words of a refused «التراجع عن الصرف». */
export function unmarkFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'NOT_FOUND':
      return { key: 'admin.money.payouts.unmark.refused.notFound' };
    case 'CONFLICT':
      return {
        key: errorDetailsOf(error).some(({ code }) => code === 'not_marked')
          ? 'admin.money.payouts.unmark.refused.notMarked'
          : 'admin.shared.keyReused',
      };
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}
