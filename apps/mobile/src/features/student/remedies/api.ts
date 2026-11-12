// T043 of specs/004-sessions (FR-463 to FR-466; contracts/app-surface.md, "`sessions.remedy`";
// R-320): the student's remedy procedures. Each answer is the remedy as `sessions.get` shows it, put
// in the session's read, then the session's and the enrollment's screens are read again, so the
// panel draws what the server holds. A refusal reads them again too and rejects, as T065's
// cancellation answer does (`features/shared/sessions/cancellation.ts`); an answer that never
// reached the server reads nothing again. The counter options are read each time the counter sheet
// opens (H4: read again for each counter-proposal).
import type {
  CounterOption,
  RemedyView,
  SessionsGetOutput,
  SessionsRemedyCounterOptionsOutput,
} from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { keyHoldsAny } from '../../../lib/live-channel';
import { sessionQueryKey } from '../../shared/room';

export const counterOptionsQueryKey = (sessionId: string) =>
  ['sessions', 'remedy', 'counterOptions', sessionId] as const;

/** `sessions.remedy.counterOptions`, read again on every opening of the sheet. */
export function useCounterOptions(sessionId: string) {
  const { client } = useApi();
  return useQuery<SessionsRemedyCounterOptionsOutput>({
    queryKey: counterOptionsQueryKey(sessionId),
    queryFn: () => client.api.sessions.remedy.counterOptions.query({ sessionId }),
    refetchOnMount: 'always',
  });
}

export interface RemedyActions {
  /** `sessions.remedy.choose` with a refund. */
  chooseRefund(): Promise<RemedyView>;
  /** `sessions.remedy.accept`: the proposal booked, a pending counter withdrawn. */
  accept(): Promise<RemedyView>;
  /** `sessions.remedy.counter` naming `option`, under the action's own key. */
  counter(option: CounterOption, idempotencyKey: string): Promise<RemedyView>;
}

/** The student's remedy procedures for `session`, its screens read again after each answer. */
export function useRemedyActions(session: {
  readonly sessionId: string;
  readonly enrollmentId: string;
}): RemedyActions {
  const { client } = useApi();
  const queries = useQueryClient();
  const { sessionId, enrollmentId } = session;
  const readAgain = () =>
    queries.invalidateQueries({
      predicate: (query) => keyHoldsAny(query.queryKey, [sessionId, enrollmentId]),
    });
  async function settle(call: () => Promise<RemedyView>): Promise<RemedyView> {
    let answer: RemedyView;
    try {
      answer = await call();
    } catch (error) {
      if (errorCodeOf(error) !== undefined) await readAgain();
      throw error;
    }
    queries.setQueryData<SessionsGetOutput>(sessionQueryKey(sessionId), (read) =>
      read === undefined ? read : { ...read, remedy: answer },
    );
    void readAgain();
    return answer;
  }
  const remedy = client.api.sessions.remedy;
  return {
    chooseRefund: () => settle(() => remedy.choose.mutate({ sessionId, choice: 'refund' })),
    accept: () => settle(() => remedy.accept.mutate({ sessionId })),
    counter: (option, idempotencyKey) =>
      settle(() =>
        remedy.counter.mutate({
          sessionId,
          slotId: option.slotId,
          localDate: option.localDate,
          idempotencyKey,
        }),
      ),
  };
}
