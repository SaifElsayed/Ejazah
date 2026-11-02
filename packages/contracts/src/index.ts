// @ijazah/contracts (T009): the only shared type surface between apps/api, apps/mobile and apps/admin.
// The admin surface and the user surface are exported separately and must stay disjoint (FR-048, R-API-11).
// Nothing here may be removed or renamed once merged; add and deprecate instead (R-API-9).
//
// Since T018 the package publishes built JavaScript to Node under `dist/` and its source under the
// export condition `@ijazah/source` (as `@ijazah/time` does, T151), because the API's kernel reads
// its lists at runtime; a test or a bundler resolves the source through the condition.
export * from './account.js';
export { AUDIT_LABEL_MAX_LENGTH } from './audit-label.js';
export * from './auth.js';
export { type AuthorityAllowList, authorityAllowList } from './authority-allow-list.js';
export * from './catalog.js';
export * from './empty-input.js';
export {
  type IdempotentProcedure,
  idempotentProcedures,
  isIdempotentProcedure,
} from './idempotent-procedures.js';
export * from './onboarding.js';
export * from './packages.js';
export * from './password.js';
export * from './payout.js';
export * from './platform.js';
export * from './slots.js';
export * from './teacher-application.js';
export * from './teacher-credentials.js';
export * from './teacher-profile.js';
