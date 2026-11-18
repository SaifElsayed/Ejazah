// @ijazah/contracts/admin (T067): the administrator surface's schemas, exported apart from the user
// surface's (FR-048, R-API-11), so apps/mobile never reaches them through `@ijazah/contracts`.
// Additive-only once merged, as the rest of the package (R-API-9).
export * from './admins.js';
export * from './applications.js';
export * from './audit.js';
export * from './auth.js';
// T035 of specs/004-sessions: the `cases` namespace.
export * from './cases.js';
export * from './credentials.js';
export * from './documents.js';
export * from './empty-input.js';
// 005:T007 (B46, Q-C1 (a)): the `ijazahRequests` namespace, the administrators' review.
export * from './ijazahs.js';
export * from './payments.js';
export * from './sessions.js';
export * from './students.js';
export * from './teachers.js';
// T034 of specs/004-sessions: the disputes queue and its resolution.
export * from './disputes.js';
// T058 of specs/004-sessions: the user directory, `users.list` and `users.get`.
export * from './users.js';
// T070 of specs/004-sessions: the `enrollments` namespace, `enrollments.releaseSlot`.
export * from './enrollments.js';
// 005:T011 (B47): the `reports` namespace, the administrators' queue of reports.
export * from './reports.js';
// 005:T013 to T015 (B47): the `genderFlags` namespace, the flags' queue, the correction and the fraud ban.
export * from './gender-flags.js';
// 003:T105: the `payouts` namespace, «تحويلات المعلمين»: the list, a teacher's detail and the mark.
export * from './payouts.js';
