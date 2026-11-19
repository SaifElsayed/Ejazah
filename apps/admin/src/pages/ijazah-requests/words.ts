// 005:T022 (B49; FR-604, FR-628; the note under T022, Q-I1 (a)): the words the ijazah requests
// say, each by what the server answered: a request's status, the teacher's standing now, and a
// refused decision by its code (`CONFLICT` with `not_pending` or `student_barred`, each in its own
// words; another key's conflict is the panel's reused-key words), `NOT_FOUND`, and `RATE_LIMITED`
// with when to try again through T058's `errorMessageKey`.
import type { IjazahRequestStatus } from '@ijazah/contracts';
import type { TeacherStandingStatus } from '@ijazah/contracts/admin';

import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';

interface Words {
  readonly label: MessageKey;
  readonly tone: StatusTone;
}

export const REQUEST_STATUS: Readonly<Record<IjazahRequestStatus, Words>> = {
  awaiting_student_name: {
    label: 'admin.ijazahRequests.status.awaitingStudentName',
    tone: 'neutral',
  },
  pending: { label: 'admin.status.ijazahRequest.inReview', tone: 'warning' },
  approved: { label: 'admin.status.ijazahRequest.issued', tone: 'success' },
  rejected: { label: 'admin.status.ijazahRequest.rejected', tone: 'danger' },
  closed: { label: 'admin.ijazahRequests.status.closed', tone: 'neutral' },
};

export const STANDING: Readonly<Record<TeacherStandingStatus, Words>> = {
  active: { label: 'admin.ijazahRequests.standing.active', tone: 'success' },
  verification_required: {
    label: 'admin.ijazahRequests.standing.verificationRequired',
    tone: 'warning',
  },
  suspended: { label: 'admin.ijazahRequests.standing.suspended', tone: 'warning' },
  revoked: { label: 'admin.ijazahRequests.standing.revoked', tone: 'danger' },
  banned: { label: 'admin.ijazahRequests.standing.banned', tone: 'danger' },
  deleted: { label: 'admin.ijazahRequests.standing.deleted', tone: 'neutral' },
};

/** Each refusal of a decision (`ijazahDecisionRefusal`), in its own words. */
const REFUSED: Readonly<Record<string, MessageKey>> = {
  not_pending: 'admin.ijazahRequests.refused.notPending',
  student_barred: 'admin.ijazahRequests.refused.studentBarred',
};

/** The words of a refused approval or rejection. */
export function decisionFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'NOT_FOUND':
      return { key: 'admin.ijazahRequests.refused.notFound' };
    case 'CONFLICT': {
      const known = errorDetailsOf(error).find(({ code }) => Object.hasOwn(REFUSED, code));
      return {
        key: known === undefined ? 'admin.shared.keyReused' : (REFUSED[known.code] as MessageKey),
      };
    }
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}
