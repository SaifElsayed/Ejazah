// 006:T019 (app-surface.md `programme.*`): what the student's programme panel reads and sends.
// `programme.get` under a key holding the enrollment's id, so the live channel's `enrollment` signal
// reads it again (lib/live-channel.ts `keyHoldsAny`). Each action is keyed (the kernel's
// idempotency key): one key per action and input, the same after a failure, a new one once it went
// through, as `checkout.pay` keys its quoted summary. After any answer of the server the
// enrollment's screens are read again. A payment's answer is the gateway's hosted page, which the
// caller opens through the checkout's `hosted.ts`.
import type {
  ProgrammeActionOutput,
  ProgrammeCheckoutOutput,
  ProgrammeGetOutput,
  ProgrammePlan,
} from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { keyHoldsAny } from '../../../lib/live-channel';

export const programmeQueryKey = (enrollmentId: string) =>
  ['student', 'programme', enrollmentId] as const;

/** `programme.get` on `enrollmentId`; idle until `enabled`. */
export function useProgramme(enrollmentId: string, enabled: boolean) {
  const { client } = useApi();
  return useQuery<ProgrammeGetOutput>({
    queryKey: programmeQueryKey(enrollmentId),
    queryFn: () => client.api.programme.get.query({ enrollmentId }),
    enabled,
  });
}

export interface ProgrammeActions {
  pay(plan: ProgrammePlan, saveCard: boolean): Promise<ProgrammeCheckoutOutput>;
  renew(saveCard: boolean): Promise<ProgrammeCheckoutOutput>;
  autoRenewOff(): Promise<ProgrammeActionOutput>;
  cancel(): Promise<ProgrammeActionOutput>;
}

/** The student's four actions on the programme of `enrollmentId`. */
export function useProgrammeActions(enrollmentId: string): ProgrammeActions {
  const { client } = useApi();
  const queries = useQueryClient();
  const keyed = useRef<{ readonly input: string; readonly key: string } | null>(null);
  return useMemo(() => {
    const readAgain = () =>
      queries.invalidateQueries({ predicate: (query) => keyHoldsAny(query.queryKey, [enrollmentId]) });
    async function run<Answer>(input: object, send: (key: string) => Promise<Answer>) {
      const written = JSON.stringify(input);
      if (keyed.current?.input !== written) {
        keyed.current = { input: written, key: Crypto.randomUUID() };
      }
      let answer: Answer;
      try {
        answer = await send(keyed.current.key);
      } catch (error) {
        if (errorCodeOf(error) !== undefined) await readAgain();
        throw error;
      }
      keyed.current = null;
      await readAgain();
      return answer;
    }
    return {
      pay: (plan, saveCard) =>
        run({ action: 'pay', plan, saveCard }, (idempotencyKey) =>
          client.api.programme.pay.mutate({ enrollmentId, plan, saveCard, idempotencyKey }),
        ),
      renew: (saveCard) =>
        run({ action: 'renew', saveCard }, (idempotencyKey) =>
          client.api.programme.renew.mutate({ enrollmentId, saveCard, idempotencyKey }),
        ),
      autoRenewOff: () =>
        run({ action: 'autoRenewOff' }, (idempotencyKey) =>
          client.api.programme.autoRenewOff.mutate({ enrollmentId, idempotencyKey }),
        ),
      cancel: () =>
        run({ action: 'cancel' }, (idempotencyKey) =>
          client.api.programme.cancel.mutate({ enrollmentId, idempotencyKey }),
        ),
    };
  }, [client, queries, enrollmentId]);
}
