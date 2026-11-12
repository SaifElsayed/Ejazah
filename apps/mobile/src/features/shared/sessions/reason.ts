// T041 and T042 of specs/004-sessions: a participant's reason as the phone sends it: the contract's
// own bound (`PARTICIPANT_REASON_MAX_LENGTH`, 1 to 500 characters once trimmed; `sessions.ts`), the
// same for a cancellation request, a dispute and a complaint of the teacher's absence. A blank
// reason sends nothing; the server's parse decides again.
import { PARTICIPANT_REASON_MAX_LENGTH } from '@ijazah/contracts';

/** `text` trimmed when it is a reason the procedures take, else undefined. */
export function participantReasonOf(text: string): string | undefined {
  const reason = text.trim();
  return reason.length > 0 && reason.length <= PARTICIPANT_REASON_MAX_LENGTH ? reason : undefined;
}

/** Whether `text`, trimmed, is longer than a reason may be. */
export function reasonTooLong(text: string): boolean {
  return text.trim().length > PARTICIPANT_REASON_MAX_LENGTH;
}
