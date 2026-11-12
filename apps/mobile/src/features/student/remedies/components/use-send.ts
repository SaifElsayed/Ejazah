// T043 of specs/004-sessions: one remedy action as a sheet sends it: busy while it runs, closed on
// its answer, and on a failure the words of T065's `genericErrorKey`, so a `RATE_LIMITED` answer
// says when to try again and any other the generic failure; the sheet stays open for the retry.
import { useState } from 'react';

import { type ErrorMessage, genericErrorKey } from '../../../../lib/error-message';

export interface Send {
  readonly busy: boolean;
  readonly failure: ErrorMessage | null;
  send(call: () => Promise<unknown>): Promise<void>;
}

export function useSend(onDone: () => void): Send {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  return {
    busy,
    failure,
    async send(call) {
      setBusy(true);
      setFailure(null);
      try {
        await call();
        onDone();
      } catch (caught: unknown) {
        setFailure(genericErrorKey(caught, 'common.state.actionError'));
      } finally {
        setBusy(false);
      }
    },
  };
}
