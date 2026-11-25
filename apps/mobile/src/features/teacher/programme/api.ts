// 006:T020 (app-surface.md `programme.get`, `programme.offer`, `programme.request`): what the
// teacher's programme panel reads and sends. `programme.get` under a key holding the enrollment's id,
// so the live channel's `enrollment` signal reads it again (lib/live-channel.ts `keyHoldsAny`). Each
// action is keyed (the kernel's idempotency key): one key per action and input, the same after a
// failure, a new one once it went through, as the student's panel keys its own. After any answer of
// the server the enrollment's screens are read again.
import type {
  ProgrammeGetOutput,
  ProgrammeOfferInput,
  ProgrammeOfferOutput,
  ProgrammeRequestOutput,
} from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useMemo, useRef } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { keyHoldsAny } from '../../../lib/live-channel';

export const teacherProgrammeQueryKey = (enrollmentId: string) =>
  ['teacher', 'programme', enrollmentId] as const;

/** `programme.get` on `enrollmentId`; idle until `enabled`. */
export function useTeacherProgramme(enrollmentId: string, enabled: boolean) {
  const { client } = useApi();
  return useQuery<ProgrammeGetOutput>({
    queryKey: teacherProgrammeQueryKey(enrollmentId),
    queryFn: () => client.api.programme.get.query({ enrollmentId }),
    enabled,
  });
}

/** The offer's terms as the form holds them; the enrollment and the key are the hook's. */
export type OfferTerms = Omit<ProgrammeOfferInput, 'enrollmentId' | 'idempotencyKey'>;

export interface TeacherProgrammeActions {
  offer(terms: OfferTerms): Promise<ProgrammeOfferOutput>;
  /** The stop request (FR-723); the only kind the teacher sends (SRS DEC-112). */
  requestStop(reason: string): Promise<ProgrammeRequestOutput>;
}

/** The teacher's two actions on the programme of `enrollmentId`. */
export function useTeacherProgrammeActions(enrollmentId: string): TeacherProgrammeActions {
  const { client } = useApi();
  const queries = useQueryClient();
  const keyed = useRef<{ readonly input: string; readonly key: string } | null>(null);
  return useMemo(() => {
    const readAgain = () =>
      queries.invalidateQueries({
        predicate: (query) => keyHoldsAny(query.queryKey, [enrollmentId]),
      });
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
      offer: (terms) =>
        run({ action: 'offer', ...terms }, (idempotencyKey) =>
          client.api.programme.offer.mutate({ enrollmentId, ...terms, idempotencyKey }),
        ),
      requestStop: (reason) =>
        run({ action: 'stop', reason }, (idempotencyKey) =>
          client.api.programme.request.mutate({
            enrollmentId,
            kind: 'stop',
            reason,
            idempotencyKey,
          }),
        ),
    };
  }, [client, queries, enrollmentId]);
}
