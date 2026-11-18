// 005:T019 (FR-603, FR-608; contracts/app-surface.md, `teacher.ijazahRequests.preview` and `.send`,
// `certificates.link`): the ijazah request as the teacher's enrollment screen calls it. The preview
// reads the certificate as it will be filled with no lock; the send is keyed as a session's request is
// (`keyed-reason.ts`: one key per completion date and language, reused after a failure, a new one once
// it went through), and every answer of the server, the request sent or a refusal, reads the
// enrollment again. A refusal of FR-603 is told apart by its detail's code; a missing signature leads
// to the signature screen. The certificate opens by the signed link `certificates.link` answers;
// until an administrator signs it off it answers `not_ready` (FR-629), said as being prepared.
import type {
  IjazahRequestsPreviewInput,
  IjazahRequestsPreviewOutput,
  IjazahRequestsSendOutput,
} from '@ijazah/contracts';
import { useQueryClient } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';
import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';
import { useReasonKey } from '../../shared/sessions/keyed-reason';
import { enrollmentQueryKey } from './api';

/** The words for each refusal of FR-603 and the future completion date, by the detail's code. */
const REFUSALS: ReadonlyMap<string, ErrorMessage> = new Map<string, ErrorMessage>([
  ['not_active', { key: 'teacher.ijazahRequest.refused.notActive' }],
  ['not_ijazah_track', { key: 'teacher.ijazahRequest.refused.notIjazahTrack' }],
  ['no_credential', { key: 'teacher.ijazahRequest.refused.noCredential' }],
  ['student_barred', { key: 'teacher.ijazahRequest.refused.studentBarred' }],
  ['request_open', { key: 'teacher.ijazahRequest.refused.requestOpen' }],
  ['already_issued', { key: 'teacher.ijazahRequest.refused.alreadyIssued' }],
  ['in_future', { key: 'teacher.ijazahRequest.refused.inFuture' }],
]);

/** A refused preview or send: a missing signature apart, its own words, or T065's. */
export type RequestFailure = { readonly kind: 'no_signature' } | ErrorMessage;

const REFUSING_CODES: ReadonlySet<string> = new Set(['CONFLICT', 'VALIDATION_FAILED']);

export function requestFailureOf(error: unknown): RequestFailure {
  const code = errorCodeOf(error);
  if (code !== undefined && REFUSING_CODES.has(code)) {
    for (const detail of errorDetailsOf(error)) {
      if (detail.code === 'no_signature') return { kind: 'no_signature' };
      const own = REFUSALS.get(detail.code);
      if (own !== undefined) return own;
    }
  }
  return genericErrorKey(error, 'common.state.actionError');
}

/** The certificate's link refused: «being prepared» until it is signed off, else T065's. */
export function certificateFailureOf(error: unknown): ErrorMessage {
  const notReady = errorDetailsOf(error).some(({ code }) => code === 'not_ready');
  if (errorCodeOf(error) === 'CONFLICT' && notReady) {
    return { key: 'teacher.enrollment.ijazahRequest.preparing' };
  }
  return genericErrorKey(error, 'common.state.actionError');
}

export interface IjazahRequestActions {
  preview(input: IjazahRequestsPreviewInput): Promise<IjazahRequestsPreviewOutput>;
  /** Sends the request keyed, then reads the enrollment again, whatever the server answered. */
  send(input: IjazahRequestsPreviewInput): Promise<IjazahRequestsSendOutput>;
  /** The certificate's signed link. */
  certificateLink(ijazahId: string): Promise<string>;
}

export function useIjazahRequestActions(enrollmentId: string): IjazahRequestActions {
  const { client } = useApi();
  const queries = useQueryClient();
  const key = useReasonKey();
  const readAgain = () => queries.invalidateQueries({ queryKey: enrollmentQueryKey(enrollmentId) });
  return {
    preview: (input) => client.api.teacher.ijazahRequests.preview.query(input),
    async send(input) {
      const idempotencyKey = key.keyFor(`${input.completionDate} ${input.language}`);
      let answer: IjazahRequestsSendOutput;
      try {
        answer = await client.api.teacher.ijazahRequests.send.mutate({ ...input, idempotencyKey });
      } catch (error) {
        if (errorCodeOf(error) !== undefined) await readAgain();
        throw error;
      }
      key.done();
      await readAgain();
      return answer;
    },
    async certificateLink(ijazahId) {
      const { link } = await client.api.certificates.link.query({ ijazahId });
      return link;
    },
  };
}
