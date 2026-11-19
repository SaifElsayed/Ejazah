// 005:T023 (B49; FR-613 to FR-617; the note under T023, Q-I1 (a)): the words the gender flags say,
// each by what the server answered. A flag's status as `genderFlags.list` names it (`fraud_ban`
// among them), and a refused action by its code: `CONFLICT` with one of
// `packages/contracts/src/admin/gender-flags.ts`'s refusals in its own words (another key's conflict
// is the panel's reused-key words), `NOT_FOUND`, and `RATE_LIMITED` with when to try again through
// T058's `errorMessageKey`, which keeps the generic words for any other failure. The reports page
// says a flag raised from a report in the same words.
import type { GenderFlagDecisionRefusal, GenderFlagStatus } from '@ijazah/contracts/admin';

import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';

export const GENDER_FLAG_STATUS: Readonly<
  Record<GenderFlagStatus, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  open: { label: 'admin.status.genderFlag.open', tone: 'warning' },
  corrected: { label: 'admin.status.genderFlag.corrected', tone: 'neutral' },
  fraud_ban: { label: 'admin.status.genderFlag.fraudBan', tone: 'danger' },
  dismissed: { label: 'admin.status.genderFlag.dismissed', tone: 'neutral' },
};

/** Each refusal of the `genderFlags` writes (`genderFlagDecisionRefusal`), in its own words. */
const REFUSED: Readonly<Record<GenderFlagDecisionRefusal, MessageKey>> = {
  already_resolved: 'admin.gender.refused.alreadyResolved',
  open_exists: 'admin.gender.refused.openExists',
  report_target_mismatch: 'admin.gender.refused.reportTargetMismatch',
  applicant_note_required: 'admin.gender.refused.applicantNoteRequired',
};

/** The words of a refused raise, dismissal, correction or fraud ban. */
export function genderFlagFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'NOT_FOUND':
      return { key: 'admin.gender.refused.notFound' };
    case 'CONFLICT': {
      const known = errorDetailsOf(error).find(({ code }) => Object.hasOwn(REFUSED, code));
      return {
        key:
          known === undefined
            ? 'admin.shared.keyReused'
            : REFUSED[known.code as GenderFlagDecisionRefusal],
      };
    }
    default:
      return errorMessageKey(error, 'admin.dialogs.submitError');
  }
}
