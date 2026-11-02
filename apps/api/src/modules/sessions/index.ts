// PUBLIC ENTRY of the sessions module (T017, ADR 0005 D2). Other modules import this file and nothing below it (R-API-3).
// booking requests session generation through this entry; it never writes the sessions table itself.

/** Each enrollment's final session's local date, for a slot's release (T026, R-205, FR-394). */
export { lastSessionDateOf } from './sessions.repository.js';
