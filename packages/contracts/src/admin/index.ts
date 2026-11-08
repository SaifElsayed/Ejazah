// @ijazah/contracts/admin (T067): the administrator surface's schemas, exported apart from the user
// surface's (FR-048, R-API-11), so apps/mobile never reaches them through `@ijazah/contracts`.
// Additive-only once merged, as the rest of the package (R-API-9).
export * from './admins.js';
export * from './applications.js';
export * from './audit.js';
export * from './auth.js';
export * from './credentials.js';
export * from './documents.js';
export * from './empty-input.js';
export * from './payments.js';
export * from './students.js';
export * from './teachers.js';
