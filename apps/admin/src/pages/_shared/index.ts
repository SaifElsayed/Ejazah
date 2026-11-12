// B42 lane S (the conflict check's Q10 (a)): the pieces more than one page of B42 draws, each
// credited to its tasks. A page imports them from here and edits none; a change one needs is a
// question to the integration.
// - `PartyName`, `partyLabel`: a deleted party's stand-in (FR-426; T047, T049, T050, T058).
// - `NoShowMark`: the Teacher-No-Show count and the repeated-absence mark (FR-451; same tasks).
// - `CorrectionDialog`: an undisputed outcome's correction over T059's `sessions.review.revise`
//   (FR-439; T047, T048).
// - `ManualCaseDialog`: the manual compensation case over T064's `cases.openManual` (FR-493;
//   T047, T050).
// - `HeldFilesSection`: a deleted party's held files over T040's `disputes.heldFiles` and
//   `disputes.heldFileLink` (FR-487; T049, T050).
export { CorrectionDialog, type CorrectionDialogProps } from './CorrectionDialog';
export { HeldFilesSection, type HeldFilesSectionProps } from './HeldFilesSection';
export { ManualCaseDialog, type ManualCaseDialogProps } from './ManualCaseDialog';
export { NoShowMark } from './NoShowMark';
export { partyLabel, PartyName, type PartyRole } from './PartyName';
