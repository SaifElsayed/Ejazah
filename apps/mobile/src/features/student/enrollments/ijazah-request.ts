// T020 of specs/005-certification (FR-602, FR-605, FR-607, FR-608; R-HONEST-6): the ijazah request
// as the student reads it on the enrollment. Waiting for the student's certificate name (the student
// enters it here), pending the administrator's decision, issued (with the certificate once an
// administrator signed it off, being prepared before), revoked, or rejected (FR-608: both parties
// learn of it; the reason is the teacher's, and `enrollments.get` omits it). A closed request (the
// student's deletion) shows nothing. `certificateName.set` is keyed: one key per name sent, reused
// when the same name is sent again after a failure; `already_set` and a refused name have their
// own words. The server decides; this reads its answers.
import type { CertificateItem, EnrollmentsGetOutput } from '@ijazah/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useRef } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';
import { certificateStateOf } from '../certificates';

/** What the enrollment shows of its ijazah request. */
export type StudentRequestState =
  'none' | 'awaitingName' | 'pending' | 'rejected' | 'preparing' | 'issued' | 'revoked';

/** The request's state, with the student's certificates read to know whether it is signed off. */
export function studentRequestStateOf(
  request: EnrollmentsGetOutput['ijazahRequest'],
  certificates: readonly Pick<CertificateItem, 'ijazahId' | 'revoked' | 'ready'>[] | undefined,
): StudentRequestState {
  if (request === null) return 'none';
  if (request.status === 'awaiting_student_name') return 'awaitingName';
  if (request.status === 'pending') return 'pending';
  if (request.status !== 'approved') return request.status === 'rejected' ? 'rejected' : 'none';
  if (request.revoked === true) return 'revoked';
  const certificate = certificates?.find(({ ijazahId }) => ijazahId === request.ijazahId);
  if (certificate === undefined) return 'preparing';
  const state = certificateStateOf(certificate);
  return state === 'ready' ? 'issued' : state;
}

/** The words for a refused name: `already_set` and a refused name their own, every other T065's. */
export function certificateNameRefusal(error: unknown): ErrorMessage {
  const code = errorCodeOf(error);
  if (
    code === 'CONFLICT' &&
    errorDetailsOf(error).some((detail) => detail.code === 'already_set')
  ) {
    return { key: 'student.certificateName.refused.alreadySet' };
  }
  if (code === 'VALIDATION_FAILED') return { key: 'student.certificateName.refused.invalid' };
  return genericErrorKey(error, 'common.state.actionError');
}

export interface SetCertificateName {
  /** `account.certificateName.set` with `text` trimmed; false, nothing sent, when it is blank. */
  set(text: string): Promise<boolean>;
}

/** Sets the student's certificate name; every enrollment of theirs is read again after the answer. */
export function useSetCertificateName(): SetCertificateName {
  const { client } = useApi();
  const queries = useQueryClient();
  const keyed = useRef<{ readonly name: string; readonly key: string } | null>(null);
  const readAgain = () => queries.invalidateQueries({ queryKey: ['student', 'enrollments'] });
  return {
    async set(text) {
      const name = text.trim();
      if (name === '') return false;
      if (keyed.current?.name !== name) keyed.current = { name, key: randomUUID() };
      try {
        await client.api.account.certificateName.set.mutate({
          name,
          idempotencyKey: keyed.current.key,
        });
      } catch (error) {
        if (errorCodeOf(error) !== undefined) await readAgain();
        throw error;
      }
      keyed.current = null;
      await readAgain();
      return true;
    },
  };
}
