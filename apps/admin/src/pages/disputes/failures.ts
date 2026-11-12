// T049: the words of each refusal the disputes page names, by the code and its `details` (the note
// under T034, Q2 and Q3 (a); T040; T059), and the page's generic words for any other failure
// (`admin.common.loadError.text` for a read, `admin.dialogs.submitError` for an action). T058
// switches the generic words to `errorMessageKey` later.
import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';

/** The detail at `path`, when the refusal carries one. */
function detailOf(error: unknown, path: string): string | undefined {
  return errorDetailsOf(error).find((each) => each.path === path)?.code;
}

/** A chat read refused (`disputes.chat`, T040). */
export function chatFailure(error: unknown): MessageKey {
  switch (errorCodeOf(error)) {
    case 'CONFLICT':
      return detailOf(error, 'cause') === 'not_open'
        ? 'admin.disputes.chat.notOpen'
        : 'admin.common.loadError.text';
    case 'NOT_FOUND':
      return 'admin.disputes.chat.notFound';
    default:
      return 'admin.common.loadError.text';
  }
}

/**
 * The standing move a `party_*` ruling asks, refused by `StandingService` (Q3 (a)): `CONFLICT`
 * naming the party's account status (`studentUserId`, `teacherUserId`) or, for an active teacher,
 * the approval that does not stand.
 */
function standingFailure(error: unknown): MessageKey | undefined {
  const student = detailOf(error, 'studentUserId');
  const teacher = detailOf(error, 'teacherUserId');
  const status = student ?? teacher;
  if (status === undefined) return undefined;
  if (status === 'suspended') return 'admin.disputes.resolve.refused.alreadySuspended';
  if (status === 'banned') return 'admin.disputes.resolve.refused.alreadyBanned';
  if (teacher !== undefined) return 'admin.disputes.resolve.refused.notApproved';
  return 'admin.disputes.resolve.refused.standing';
}

/** A ruling refused (`disputes.resolve`). */
export function resolveFailure(error: unknown): MessageKey {
  switch (errorCodeOf(error)) {
    case 'CONFLICT': {
      const cause = detailOf(error, 'cause');
      if (cause === 'not_evaluated') return 'admin.disputes.resolve.refused.notEvaluated';
      if (cause === 'not_open') return 'admin.disputes.resolve.refused.notOpen';
      return standingFailure(error) ?? 'admin.dialogs.submitError';
    }
    case 'NOT_FOUND':
      return 'admin.disputes.resolve.refused.notFound';
    default:
      return 'admin.dialogs.submitError';
  }
}

/** A revision refused (`disputes.revise`, T059). */
export function reviseFailure(error: unknown): MessageKey {
  switch (errorCodeOf(error)) {
    case 'RULING_FINAL': {
      const cause = detailOf(error, 'cause');
      if (cause === 'window_closed') return 'admin.disputes.revise.refused.windowClosed';
      if (cause === 'remedy_offered') return 'admin.disputes.revise.refused.remedyOffered';
      return 'admin.disputes.revise.refused.notNow';
    }
    case 'RULING_SUPERSEDED':
      return 'admin.disputes.revise.refused.superseded';
    case 'DISPUTE_OPEN':
      return 'admin.disputes.revise.refused.disputeOpen';
    case 'SESSION_UNDER_REVIEW':
      return 'admin.disputes.revise.refused.underReview';
    case 'CONFLICT':
      return 'admin.disputes.revise.refused.keyReused';
    case 'NOT_FOUND':
      return 'admin.disputes.revise.refused.notFound';
    default:
      return 'admin.dialogs.submitError';
  }
}
