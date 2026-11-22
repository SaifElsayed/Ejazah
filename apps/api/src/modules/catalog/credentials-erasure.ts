// T174 (SRS DEC-97, FR-AUTH-14, ADR 0015 D3 as amended; the note under T174, (5)): catalog's subscriber
// to identity's consequences registry (R-121: catalog imports identity's entry, never the reverse),
// subscribed by `main.ts` as verification's `documentErasureConsequence` is.
//
// On `account_deleted` of a teacher never approved (`approved_at` null, read through identity's entry
// on the deletion's transaction, under the account's lock the deletion holds, after `eraseAccount`,
// which never clears it): every credential's holder name, riwaya, tariq and review reason are blanked
// and its chain deleted, then the credentials' history erased (`eraseOfTeacher`, which reads
// `approved_at` again and refuses a teacher once approved). A teacher once approved keeps all of it,
// with no end date, after the kept data's erasure too (DEC-97). Any other cause changes nothing.
//
// ⚠️ Irreversible: the blanked transcription and the erased history cannot be recovered.
import { type AccountConsequence, everApprovedTeacher } from '../identity/index.js';
import { blankTranscriptionsOfTeacher } from './credentials.repository.js';
import { credentialHistory } from './credentials-history.repository.js';

/** The subscriber the composition adds to the consequences registry (`main.ts`). */
export function catalogDeletionConsequence(): AccountConsequence {
  return async (tx, userId, cause) => {
    if (cause !== 'account_deleted') return;
    if (await everApprovedTeacher(tx, userId)) return;
    await blankTranscriptionsOfTeacher(tx, userId);
    await credentialHistory.eraseOfTeacher(tx, userId);
  };
}
