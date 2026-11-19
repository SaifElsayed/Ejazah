// 005:T022 (B49; FR-609, FR-610, FR-629; the note under T022, Q-I1 (a)): the words the ijazahs
// say, each by what the server answered. An ijazah's status as `ijazahs.list` names it (revoked
// first, whatever else it holds, R-HONEST-6); its number in groups of four (FR-605); and a refused
// action by its code: `CONFLICT` with one of `packages/contracts/src/admin/ijazahs.ts`'s refusals
// in its own words (another key's conflict is the panel's reused-key words), `NOT_FOUND`, and
// `RATE_LIMITED` with when to try again through T058's `errorMessageKey`, which keeps the generic
// words for any other failure.
import type { AdminIjazahStatus } from '@ijazah/contracts/admin';

import type { StatusTone } from '../../design/components';
import type { MessageKey } from '../../i18n';
import { errorCodeOf, errorDetailsOf } from '../../lib/client';
import { type ErrorMessage, errorMessageKey } from '../../lib/error-message';

export const IJAZAH_STATUS: Readonly<
  Record<AdminIjazahStatus, { readonly label: MessageKey; readonly tone: StatusTone }>
> = {
  preparing: { label: 'admin.ijazahs.status.preparing', tone: 'neutral' },
  rendered: { label: 'admin.ijazahs.status.rendered', tone: 'warning' },
  signed_off: { label: 'admin.ijazahs.status.signedOff', tone: 'success' },
  revoked: { label: 'admin.status.ijazah.revoked', tone: 'danger' },
};

/** A certificate number as printed: four groups of four (FR-605). */
export function groupedNumber(certificateNumber: string): string {
  return certificateNumber.match(/.{1,4}/g)?.join('-') ?? certificateNumber;
}

/** Each refusal of the `ijazahs` writes (`ijazahsRefusal`, `ijazahSignOffRefusal`), in its own words. */
const REFUSED: Readonly<Record<string, MessageKey>> = {
  already_revoked: 'admin.ijazahs.refused.alreadyRevoked',
  already_barred: 'admin.ijazahs.refused.alreadyBarred',
  not_barred: 'admin.ijazahs.refused.notBarred',
  not_rendered: 'admin.ijazahs.refused.notRendered',
  revoked: 'admin.ijazahs.refused.revoked',
  already_signed_off: 'admin.ijazahs.refused.alreadySignedOff',
  student_barred: 'admin.ijazahs.refused.studentBarred',
};

/** The words of a refused sign-off, re-render, revocation, bar or lift. */
export function ijazahFailure(error: unknown): ErrorMessage {
  switch (errorCodeOf(error)) {
    case 'NOT_FOUND':
      return { key: 'admin.ijazahs.refused.notFound' };
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
