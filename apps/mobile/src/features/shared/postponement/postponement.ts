// 003:T112 (SRS §3.8.6, FR-POSTPONE-1 to FR-POSTPONE-5, DEC-86, DEC-90; the owner's Q-1 (a) and
// Q-3 (a) of 2026-11-19): a one-week postponement, the same for both roles (R-MOBILE-3). It is offered
// on a `confirmed` enrollment that is not paused (a paused one is answered with no session); display
// only (R-MOBILE-12): the server decides which sessions of the caller's coming week it moves, the
// notice and the interval, each a setting the phone cannot read.
//
// `sessions.postpone` is keyed by the client as `sessions.cancellation.request` is
// (`../sessions/keyed-reason.ts`): one key per reason sent, reused when the same reason is sent again
// after a failure, a new one once it went through or the reason changed. A reason blank or longer than
// the contract's bound sends nothing (`participantReasonOf`). An answer from the server reads the
// enrollment's screens again: a refusal the enrollment's, a postponement those and the sessions it
// moved; a call that never reached it reads nothing again. Each refusal in its own words: the three
// `CONFLICT` causes of `sessionsPostponeRefusalCause` and `ACCOUNT_RESTRICTED`, which names no
// account; every other failure through `genericErrorKey` (T065).
import type { SessionsPostponeOutput, SessionsPostponeRefusalCause } from '@ijazah/contracts';
import { useQueryClient } from '@tanstack/react-query';

import type { MessageKey } from '../../../i18n';
import { useApi } from '../../../lib/api';
import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';
import { keyHoldsAny } from '../../../lib/live-channel';
import { useReasonKey } from '../sessions/keyed-reason';
import { participantReasonOf } from '../sessions/reason';

/** Whether the postponement is offered: a confirmed enrollment, not paused. */
export function postponeOffered(enrollment: {
  readonly status: string;
  readonly paused: boolean;
}): boolean {
  return enrollment.status === 'confirmed' && !enrollment.paused;
}

const CAUSE_WORDS: Readonly<Record<SessionsPostponeRefusalCause, MessageKey>> = {
  no_session_in_week: 'postponement.refused.noSessionInWeek',
  interval_not_passed: 'postponement.refused.intervalNotPassed',
  enrollment_not_confirmed: 'postponement.refused.enrollmentNotConfirmed',
};

function isRefusalCause(cause: string | undefined): cause is SessionsPostponeRefusalCause {
  return cause !== undefined && Object.hasOwn(CAUSE_WORDS, cause);
}

/** The words for a refused postponement, by its code and `details.cause`. */
export function postponementRefusal(error: unknown): ErrorMessage {
  const code = errorCodeOf(error);
  if (code === 'ACCOUNT_RESTRICTED') return { key: 'postponement.refused.accountRestricted' };
  if (code === 'CONFLICT') {
    const cause = errorDetailsOf(error).find(({ path }) => path === 'cause')?.code;
    if (isRefusalCause(cause)) return { key: CAUSE_WORDS[cause] };
  }
  return genericErrorKey(error, 'common.state.actionError');
}

export interface Postpone {
  /** `sessions.postpone` with `text` trimmed; undefined, nothing sent, when it is not a reason. */
  postpone(text: string): Promise<SessionsPostponeOutput | undefined>;
}

/** Postpones the caller's coming week on `enrollmentId`, its screens read again after the answer. */
export function usePostpone(enrollmentId: string): Postpone {
  const { client } = useApi();
  const key = useReasonKey();
  const queries = useQueryClient();
  const readAgain = (ids: readonly string[]) =>
    queries.invalidateQueries({ predicate: (query) => keyHoldsAny(query.queryKey, ids) });
  return {
    async postpone(text) {
      const reason = participantReasonOf(text);
      if (reason === undefined) return undefined;
      const idempotencyKey = key.keyFor(reason);
      let answer: SessionsPostponeOutput;
      try {
        answer = await client.api.sessions.postpone.mutate({
          enrollmentId,
          reason,
          idempotencyKey,
        });
      } catch (error) {
        if (errorCodeOf(error) !== undefined) await readAgain([enrollmentId]);
        throw error;
      }
      key.done();
      await readAgain([enrollmentId, ...answer.sessionIds]);
      return answer;
    },
  };
}
