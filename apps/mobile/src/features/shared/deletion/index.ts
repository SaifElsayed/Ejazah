// T084 (FR-140, FR-141, ADR 0015 D1): what the student's and the teacher's deletion share: the
// screen's frame, the last confirmation, and the proof by the account's method. Its own entry, not
// `shared/account`'s, since the proof loads the providers' native modules (`../auth/providers`).
export { confirmationOf, type DeletionConfirmation, useAccountDeletion } from './api';
export { type DeletionCopy, DeletionScreen } from './components/DeletionScreen';
export { DeletionSheet, type DeletionSheetCopy } from './components/DeletionSheet';
