// T041 and T042 of specs/004-sessions: what a session's request and its dispute share. A keyed
// procedure takes one key per reason sent, reused when the same reason is sent again after a
// failure, and a new one once it went through or the reason changed, as `checkout.pay` keys its
// quoted summary (`features/student/checkout/api.ts`). After the server's answer the session's
// screens are read again: `sessions.get` and the enrollment's (`keyHoldsAny`), as a refused
// cancellation answer reads them (`cancellation.ts`).
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef } from 'react';

import { keyHoldsAny } from '../../../lib/live-channel';

export interface ReasonKey {
  /** The key for `reason`: the last one while the reason is the same, else a new one. */
  keyFor(reason: string): string;
  /** The action went through: the next one takes a new key. */
  done(): void;
}

export function useReasonKey(): ReasonKey {
  const keyed = useRef<{ readonly reason: string; readonly key: string } | null>(null);
  return {
    keyFor(reason) {
      if (keyed.current?.reason !== reason) keyed.current = { reason, key: Crypto.randomUUID() };
      return keyed.current.key;
    },
    done() {
      keyed.current = null;
    },
  };
}

/** The session's screens, read again: `sessions.get` and the enrollment's. */
export function useReadSessionAgain(session: {
  readonly sessionId: string;
  readonly enrollmentId: string;
}): () => Promise<void> {
  const queries = useQueryClient();
  const { sessionId, enrollmentId } = session;
  return () =>
    queries.invalidateQueries({
      predicate: (query) => keyHoldsAny(query.queryKey, [sessionId, enrollmentId]),
    });
}
