// T042 of specs/004-sessions (FR-452; SRS FR-NOSHOW-4; T060; the note under T042, Q6 (a)): the
// student's complaint of the teacher's absence. Offered on a `confirmed` enrollment only; while
// `enrollments.get`'s `complaintOpen` is true it reads «شكوتك قيد المراجعة» and sends nothing.
// Display only: the server decides (`COMPLAINT_OPEN`, its own limit, `RATE_LIMITED`).
// `sessions.complaint.raise` is not keyed (the one-open rule answers a retry); a blank reason sends
// nothing; the server's answer, the complaint opened or a refusal, reads the enrollment again.
//
// Its own words for `RATE_LIMITED` (Q6 (a)): a sentence of its own with the time from
// `retryAfterSeconds` when the refusal gives one, read as `genericErrorKey` reads it (whole minutes
// rounded up, `lib/error-message.ts`), and without a time otherwise; never a count of complaints,
// the limit being a setting the phone cannot read.
import type { EnrollmentsGetOutput, SessionsComplaintRaiseOutput } from '@ijazah/contracts';
import { useQueryClient } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';
import { participantReasonOf } from '../../shared/sessions';
import { enrollmentQueryKey } from './api';

/** What the complaint shows: nothing, the button, or «شكوتك قيد المراجعة». */
export type ComplaintState = 'none' | 'offered' | 'open';

export function complaintStateOf(
  enrollment: Pick<EnrollmentsGetOutput, 'status' | 'complaintOpen'>,
): ComplaintState {
  if (enrollment.status !== 'confirmed') return 'none';
  return enrollment.complaintOpen ? 'open' : 'offered';
}

/** The words for a refused complaint: `COMPLAINT_OPEN` and `RATE_LIMITED` its own, every other T065's. */
export function complaintRefusal(error: unknown): ErrorMessage {
  const code = errorCodeOf(error);
  if (code === 'COMPLAINT_OPEN') return { key: 'student.complaint.refused.open' };
  const generic = genericErrorKey(error, 'common.state.actionError');
  if (code !== 'RATE_LIMITED') return generic;
  return generic.key === 'common.state.rateLimitedIn' && generic.values !== undefined
    ? { key: 'student.complaint.refused.rateLimitedIn', values: generic.values }
    : { key: 'student.complaint.refused.rateLimited' };
}

export interface RaiseComplaint {
  /** `sessions.complaint.raise` with `text` trimmed; undefined, nothing sent, when it is blank. */
  raise(text: string): Promise<SessionsComplaintRaiseOutput | undefined>;
}

/** Complains of the teacher's absence on `enrollmentId`, the enrollment read again after the answer. */
export function useRaiseComplaint(enrollmentId: string): RaiseComplaint {
  const { client } = useApi();
  const queries = useQueryClient();
  const readAgain = () => queries.invalidateQueries({ queryKey: enrollmentQueryKey(enrollmentId) });
  return {
    async raise(text) {
      const reason = participantReasonOf(text);
      if (reason === undefined) return undefined;
      let answer: SessionsComplaintRaiseOutput;
      try {
        answer = await client.api.sessions.complaint.raise.mutate({ enrollmentId, reason });
      } catch (error) {
        if (errorCodeOf(error) !== undefined) await readAgain();
        throw error;
      }
      await readAgain();
      return answer;
    },
  };
}
