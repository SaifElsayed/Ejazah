// T045 of specs/004-sessions (FR-488 to FR-491; contracts/app-surface.md, `chat`): the words a failed
// send or document says. The chat's own refusals in its own words, `CHAT_CLOSED` (the enrollment
// has ended, or is not confirmed) and `ATTACHMENT_REFUSED` (not a PDF or a text by its content, or
// an image by its content or its name); every other failure through `genericErrorKey`, so a
// `RATE_LIMITED` answer reads «طلبات كثيرة…» (T065, the owner's decision of 2026-11-06).
import { errorCodeOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';

export function chatErrorMessage(error: unknown): ErrorMessage {
  const code = errorCodeOf(error);
  if (code === 'CHAT_CLOSED') return { key: 'chat.thread.closed' };
  if (code === 'ATTACHMENT_REFUSED') return { key: 'chat.thread.refused' };
  return genericErrorKey(error, 'common.state.actionError');
}
