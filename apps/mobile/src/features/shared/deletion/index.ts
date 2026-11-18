// T084 (FR-140, FR-141, ADR 0015 D1): what the student's and the teacher's deletion share: the
// screen's frame, the last confirmation, and the proof by the account's method. Its own entry, not
// `shared/account`'s, since the proof loads the providers' native modules (`../auth/providers`).
export { confirmationOf, type DeletionConfirmation, useAccountDeletion } from './api';
// T080 of specs/004-sessions: the refusal of an ongoing enrollment, told apart from other failures.
export { isOngoingRefusal } from './api';
// 005:T031 of specs/005-certification: each refusal by its cause (an undecided ijazah request too).
export { type DeletionRefusal, deletionRefusalOf } from './api';
export { type DeletionCopy, DeletionScreen } from './components/DeletionScreen';
export { DeletionSheet, type DeletionSheetCopy } from './components/DeletionSheet';
