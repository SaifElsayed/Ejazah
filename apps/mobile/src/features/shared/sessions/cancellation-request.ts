// T041 of specs/004-sessions (FR-456, FR-458; SRS FR-CANCEL-1, FR-CANCEL-4; the note under T041,
// Q2 (a)): asking to cancel a session, the same for both roles (R-MOBILE-3). `sessions.get` answers
// no field allowing a request, so the control is shown from what it does answer: the session
// `scheduled`, no `pending` request on it, and the phone's clock before `startsAt`, read through
// `secondsUntil` (R-TIME-1) and drawn again when the start comes. Display only (R-MOBILE-12): the
// server decides (`CANCELLATION_PENDING`, `CANCELLATION_EXPIRED`, R-MOBILE-13).
//
// `sessions.cancellation.request` is keyed by the client: one key per reason sent, reused when the
// same reason is sent again after a failure, and a new one once a request went through or the reason
// changed (`keyed-reason.ts`). A blank reason sends nothing. An answer from the server, a request
// or a refusal, reads the session's screens again, as a refused answer does (`cancellation.ts`); a
// request that never reached it reads nothing again.
import type { SessionsCancellationRequestOutput, SessionsGetOutput } from '@ijazah/contracts';
import { secondsUntil } from '@ijazah/time/calendar';
import { useEffect, useState } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';
import { type AnswerCancellation, useAnswerCancellation } from './cancellation';
import { useReadSessionAgain, useReasonKey } from './keyed-reason';
import { participantReasonOf } from './reason';

const SECOND_MS = 1_000;
/** The longest single wait for the start: setTimeout overflows past 24.8 days. */
const LONGEST_WAIT_MS = 60_000;

/** What the control is decided on, from `sessions.get`'s answer. */
export type RequestableSession = Pick<SessionsGetOutput, 'status' | 'startsAt'> & {
  readonly cancellation?:
    Pick<NonNullable<SessionsGetOutput['cancellation']>, 'status'> | undefined;
};

/** Whether the request control is shown at `now`: scheduled, no pending request, before the start. */
export function cancellationRequestShown(session: RequestableSession, now: Date): boolean {
  return (
    session.status === 'scheduled' &&
    session.cancellation?.status !== 'pending' &&
    secondsUntil(session.startsAt, now) > 0
  );
}

type Cancellation = NonNullable<SessionsGetOutput['cancellation']>;

/**
 * Whether the accept and decline are offered: to the counterparty, on a pending request (FR-456).
 * Display only; the server decides who may answer.
 */
export function cancellationAnswerShown(
  cancellation: Pick<Cancellation, 'status' | 'requestedByMe'>,
): boolean {
  return cancellation.status === 'pending' && !cancellation.requestedByMe;
}

export type SettledRequestKey =
  | 'session.cancellation.accepted'
  | 'session.cancellation.declined'
  | 'session.cancellation.declinedOnly'
  | 'session.cancellation.expired'
  | 'session.cancellation.over';

/**
 * The words of a request no longer waiting for its answer (FR-458, FR-495); undefined while it
 * waits. «The session stands» only while the session is `scheduled`: `sessions.get` answers a
 * pending request `expired` once its session is not (an administrator's cancel, a suspension, a
 * deletion; `cancellationViewOf`), and then the words say only that the request ended (PR #136,
 * Saif r1's Minor 1).
 */
export function settledRequestKey(
  sessionStatus: SessionsGetOutput['status'],
  requestStatus: Cancellation['status'],
  shownExpired: boolean,
): SettledRequestKey | undefined {
  const stands = sessionStatus === 'scheduled';
  if (shownExpired) return stands ? 'session.cancellation.expired' : 'session.cancellation.over';
  if (requestStatus === 'accepted') return 'session.cancellation.accepted';
  if (requestStatus === 'pending') return undefined;
  return stands ? 'session.cancellation.declined' : 'session.cancellation.declinedOnly';
}

/** The same, hidden by itself when the phone's clock reaches the start, the screen left open. */
export function useCancellationRequestShown(session: RequestableSession): boolean {
  const { status, startsAt } = session;
  const pending = session.cancellation?.status === 'pending';
  const [shown, setShown] = useState(() => cancellationRequestShown(session, new Date()));
  useEffect(() => {
    const view: RequestableSession = {
      status,
      startsAt,
      ...(pending ? { cancellation: { status: 'pending' as const } } : {}),
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const follow = () => {
      const now = new Date();
      const visible = cancellationRequestShown(view, now);
      setShown(visible);
      if (!visible) return;
      timer = setTimeout(
        follow,
        Math.min(secondsUntil(startsAt, now) * SECOND_MS, LONGEST_WAIT_MS),
      );
    };
    follow();
    return () => clearTimeout(timer);
  }, [status, startsAt, pending]);
  return shown;
}

/**
 * The words for a refused request or answer: `CANCELLATION_PENDING` and `CANCELLATION_EXPIRED` in
 * the screen's own words; every other failure through `genericErrorKey` (T065).
 */
export function cancellationRefusal(error: unknown): ErrorMessage {
  const code = errorCodeOf(error);
  if (code === 'CANCELLATION_PENDING') return { key: 'session.cancellation.refused.pending' };
  if (code === 'CANCELLATION_EXPIRED') return { key: 'session.cancellation.refused.expired' };
  return genericErrorKey(error, 'common.state.actionError');
}

/**
 * The counterparty's answer through T065's `useAnswerCancellation` (a refusal reads the screens
 * again there), and the screens read again once the server took it, so the answer shows.
 */
export function useAnswerRequest(session: {
  readonly sessionId: string;
  readonly enrollmentId: string;
}): AnswerCancellation {
  const answers = useAnswerCancellation(session);
  const readAgain = useReadSessionAgain(session);
  return {
    async answer(requestId, accept) {
      const answer = await answers.answer(requestId, accept);
      await readAgain();
      return answer;
    },
  };
}

export interface RequestCancellation {
  /** `sessions.cancellation.request` with `text` trimmed; undefined, nothing sent, when it is blank. */
  request(text: string): Promise<SessionsCancellationRequestOutput | undefined>;
}

/** Asks to cancel `session`, its screens read again after the server's answer. */
export function useRequestCancellation(session: {
  readonly sessionId: string;
  readonly enrollmentId: string;
}): RequestCancellation {
  const { client } = useApi();
  const key = useReasonKey();
  const readAgain = useReadSessionAgain(session);
  return {
    async request(text) {
      const reason = participantReasonOf(text);
      if (reason === undefined) return undefined;
      const idempotencyKey = key.keyFor(reason);
      let answer: SessionsCancellationRequestOutput;
      try {
        answer = await client.api.sessions.cancellation.request.mutate({
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
