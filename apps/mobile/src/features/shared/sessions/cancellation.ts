// T065 of specs/004-sessions (FR-438; SRS FR-CANCEL-4; research R-324, item 7; contracts/app-surface.md,
// "`live`"): a cancellation request as both participants see it, the same for both roles
// (R-MOBILE-3); T041 draws it. A request's expiry is produced by the worker and not sent live, so a
// pending request is shown expired from its `expiresAt` against the phone's own clock, read through
// `secondsUntil` (R-TIME-1): display only, the server decides. An answer the server refuses
// (`CANCELLATION_EXPIRED`, or any refusal) reads `sessions.get` and the enrollment's screens again,
// so the screen shows what the server holds; an answer that never reached it reads nothing again.
import type { SessionsCancellationAnswerOutput, SessionsGetOutput } from '@ijazah/contracts';
import { secondsUntil } from '@ijazah/time/calendar';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { keyHoldsAny } from '../../../lib/live-channel';

export type CancellationView = NonNullable<SessionsGetOutput['cancellation']>;

const SECOND_MS = 1_000;
/** The longest single wait for the expiry: setTimeout overflows past 24.8 days. */
const LONGEST_WAIT_MS = 60_000;

/** Whether the request is shown expired at `now`: the server's `expired`, or pending past `expiresAt`. */
export function cancellationShownExpired(
  cancellation: CancellationView | undefined,
  now: Date,
): boolean {
  if (cancellation === undefined) return false;
  if (cancellation.status === 'expired') return true;
  return cancellation.status === 'pending' && secondsUntil(cancellation.expiresAt, now) === 0;
}

/** The same, drawn again when the phone's clock reaches `expiresAt`. */
export function useCancellationShownExpired(cancellation: CancellationView | undefined): boolean {
  const status = cancellation?.status;
  const expiresAt = cancellation?.expiresAt;
  const [shown, setShown] = useState(() => cancellationShownExpired(cancellation, new Date()));
  useEffect(() => {
    if (status === undefined || expiresAt === undefined) {
      setShown(false);
      return;
    }
    const view = { status, expiresAt } as CancellationView;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const follow = () => {
      const now = new Date();
      const expired = cancellationShownExpired(view, now);
      setShown(expired);
      if (expired || status !== 'pending') return;
      timer = setTimeout(
        follow,
        Math.min(secondsUntil(expiresAt, now) * SECOND_MS, LONGEST_WAIT_MS),
      );
    };
    follow();
    return () => clearTimeout(timer);
  }, [status, expiresAt]);
  return shown;
}

export interface AnswerCancellation {
  /** `sessions.cancellation.answer`; a refusal reads the session's screens again, then rejects. */
  answer(requestId: string, accept: boolean): Promise<SessionsCancellationAnswerOutput>;
}

/** Answers the counterparty's request on `session`, its screens read again after a refusal. */
export function useAnswerCancellation(session: {
  readonly sessionId: string;
  readonly enrollmentId: string;
}): AnswerCancellation {
  const { client } = useApi();
  const queries = useQueryClient();
  const { sessionId, enrollmentId } = session;
  return {
    async answer(requestId, accept) {
      try {
        return await client.api.sessions.cancellation.answer.mutate({ requestId, accept });
      } catch (error) {
        if (errorCodeOf(error) !== undefined) {
          await queries.invalidateQueries({
            predicate: (query) => keyHoldsAny(query.queryKey, [sessionId, enrollmentId]),
          });
        }
        throw error;
      }
    },
  };
}
