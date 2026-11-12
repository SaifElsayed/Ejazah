// T044 of specs/004-sessions (FR-465; contracts/app-surface.md, "`sessions.remedy`"; R-320): the
// teacher's answer, `sessions.remedy.answerCounter`. Its answer is put in the session's read, then
// the session's and the enrollment's screens are read again, so the panel draws what the server
// holds; a refusal reads them again too and rejects, as T065's cancellation answer does; an answer
// that never reached the server reads nothing again.
import type { RemedyView, SessionsGetOutput } from '@ijazah/contracts';
import { useQueryClient } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { keyHoldsAny } from '../../../lib/live-channel';
import { sessionQueryKey } from '../../shared/room';

/** Answers the pending counter-proposal on `session`: `accept` books it, else it is declined. */
export function useAnswerCounter(session: {
  readonly sessionId: string;
  readonly enrollmentId: string;
}): (accept: boolean) => Promise<RemedyView> {
  const { client } = useApi();
  const queries = useQueryClient();
  const { sessionId, enrollmentId } = session;
  const readAgain = () =>
    queries.invalidateQueries({
      predicate: (query) => keyHoldsAny(query.queryKey, [sessionId, enrollmentId]),
    });
  return async (accept) => {
    let answer: RemedyView;
    try {
      answer = await client.api.sessions.remedy.answerCounter.mutate({ sessionId, accept });
    } catch (error) {
      if (errorCodeOf(error) !== undefined) await readAgain();
      throw error;
    }
    queries.setQueryData<SessionsGetOutput>(sessionQueryKey(sessionId), (read) =>
      read === undefined ? read : { ...read, remedy: answer },
    );
    void readAgain();
    return answer;
  };
}
