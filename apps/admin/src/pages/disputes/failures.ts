// T049: the words of each refusal the disputes page names, by the code and its `details` (the note
// under T034, Q2 and Q3 (a); T040; T059), and the page's generic words for any other failure
// (`admin.common.loadError.text` for a read, `admin.dialogs.submitError` for an action), through
// T058's `errorMessageKey`, which says when to try again on `RATE_LIMITED`.
import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';

/** The detail at `path`, when the refusal carries one. */
function detailOf(error: unknown, path: string): string | undefined {
  return errorDetailsOf(error).find((each) => each.path === path)?.code;
}

/** The words of a chat read's two refusals, in the words of the matter that opens the chat. */
export interface ChatRefusalWords {
  /** `CONFLICT` `not_open`: the matter is no longer open. */
  readonly notOpen: MessageKey;
  /** `NOT_FOUND`. */
  readonly notFound: MessageKey;
}

/** A chat read refused, said in `words` (005:T034: a dispute's or a report's). */
export function chatFailureIn(words: ChatRefusalWords): (error: unknown) => ErrorMessage {
  return (error) => {
    switch (errorCodeOf(error)) {
      case 'CONFLICT':
        return {
          key:
            detailOf(error, 'cause') === 'not_open' ? words.notOpen : 'admin.common.loadError.text',
        };
      case 'NOT_FOUND':
        return { key: words.notFound };
      default:
        return errorMessageKey(error, 'admin.common.loadError.text');
    }
  };
}

/** A chat read refused (`disputes.chat`, T040). */
export const chatFailure = chatFailureIn({
  notOpen: 'admin.disputes.chat.notOpen',
  notFound: 'admin.disputes.chat.notFound',
});

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
export function resolveFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'CONFLICT': {
      const cause = detailOf(error, 'cause');
      if (cause === 'not_evaluated') return { key: 'admin.disputes.resolve.refused.notEvaluated' };
      if (cause === 'not_open') return { key: 'admin.disputes.resolve.refused.notOpen' };
      return { key: standingFailure(error) ?? 'admin.dialogs.submitError' };
    }
    case 'NOT_FOUND':
      return { key: 'admin.disputes.resolve.refused.notFound' };
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}

/** A revision refused (`disputes.revise`, T059). */
export function reviseFailure(error: unknown): ErrorMessage {
  const named = reviseRefusal(error);
  return named === undefined ? errorMessageKey(error, 'admin.dialogs.submitError') : { key: named };
}

/** The words of a revision's refusal the task names, by its code and cause. */
function reviseRefusal(error: unknown): MessageKey | undefined {
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
      return undefined;
  }
}
