// T042 of specs/004-sessions (FR-473, FR-474, FR-495; SRS FR-DISPUTE-1; the note under T042): raising
// a dispute over a session, the same for both roles (R-MOBILE-3). The control is shown only while
// `sessions.get`'s `canRaiseDispute` says the server would take it (T026's hint, read with no lock):
// display only, the raise decides (`DISPUTE_WINDOW_CLOSED`, `DISPUTE_OPEN`, `SESSION_UNDER_REVIEW`,
// `NOT_DISPUTABLE`, R-MOBILE-13). `sessions.dispute.raise` is keyed as a cancellation request is
// (`keyed-reason.ts`): a blank reason sends nothing, and the server's answer, the dispute opened or
// a refusal, reads the session's screens again.
import type { SessionsDisputeRaiseOutput, SessionsGetOutput } from '@ijazah/contracts';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';
import { useReadSessionAgain, useReasonKey } from './keyed-reason';
import { participantReasonOf } from './reason';

/** Whether the dispute control is shown: only while `canRaiseDispute` (T026). */
export function disputeRaiseShown(session: Pick<SessionsGetOutput, 'canRaiseDispute'>): boolean {
  return session.canRaiseDispute === true;
}

/** The refusals the raise names, each in the screen's own words. */
const REFUSALS: ReadonlyMap<string, ErrorMessage> = new Map<string, ErrorMessage>([
  ['DISPUTE_WINDOW_CLOSED', { key: 'session.dispute.refused.windowClosed' }],
  ['DISPUTE_OPEN', { key: 'session.dispute.refused.open' }],
  ['SESSION_UNDER_REVIEW', { key: 'session.dispute.refused.underReview' }],
  ['NOT_DISPUTABLE', { key: 'session.dispute.refused.notDisputable' }],
]);

/** The words for a refused raise: its four refusals in plain words, every other through T065's. */
export function disputeRefusal(error: unknown): ErrorMessage {
  const code = errorCodeOf(error);
  const own = code === undefined ? undefined : REFUSALS.get(code);
  return own ?? genericErrorKey(error, 'common.state.actionError');
}

export interface RaiseDispute {
  /** `sessions.dispute.raise` with `text` trimmed; undefined, nothing sent, when it is blank. */
  raise(text: string): Promise<SessionsDisputeRaiseOutput | undefined>;
}

/** Disputes `session`, its screens read again after the server's answer. */
export function useRaiseDispute(session: {
  readonly sessionId: string;
  readonly enrollmentId: string;
}): RaiseDispute {
  const { client } = useApi();
  const key = useReasonKey();
  const readAgain = useReadSessionAgain(session);
  return {
    async raise(text) {
      const reason = participantReasonOf(text);
      if (reason === undefined) return undefined;
      const idempotencyKey = key.keyFor(reason);
      let answer: SessionsDisputeRaiseOutput;
      try {
        answer = await client.api.sessions.dispute.raise.mutate({
          sessionId: session.sessionId,
          reason,
          idempotencyKey,
        });
      } catch (error) {
        if (errorCodeOf(error) !== undefined) await readAgain();
        throw error;
      }
      key.done();
      await readAgain();
      return answer;
    },
  };
}
