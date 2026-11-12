// T044 of specs/004-sessions (FR-465; R-MOBILE-12; R-320): what the teacher's answer panel draws,
// read from `sessions.get`'s `remedy` and nothing else: a counter-proposal is pending only on a
// `counter_proposed` remedy that carries one, and the server decides the answer again
// (`sessions.remedy.answerCounter`'s refusals, the answer window being the server's).
// `REMEDY_NOT_OPEN` (no counter pending any more, or its window closed) is said in plain words;
// every other failure is T065's `genericErrorKey`.
import type { RemedyView } from '@ijazah/contracts';

import { errorCodeOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';

export type PendingCounter = NonNullable<RemedyView['counter']>;

/** The counter-proposal awaiting the teacher's answer, if any. */
export function pendingCounterOf(remedy: RemedyView | undefined): PendingCounter | undefined {
  return remedy?.status === 'counter_proposed' ? remedy.counter : undefined;
}

/** The words for a failed answer. */
export function answerProblemOf(error: unknown): ErrorMessage {
  return errorCodeOf(error) === 'REMEDY_NOT_OPEN'
    ? { key: 'teacher.counter.notOpen' }
    : genericErrorKey(error, 'common.state.actionError');
}
