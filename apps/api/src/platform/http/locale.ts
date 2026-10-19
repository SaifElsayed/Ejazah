// T017 (PR #79 review, finding 1): the request's language is a kernel concept, read by the request
// context (the session's `preferred_language`) and by the public pages (`?lang=en`), so it lives
// under `platform/` and `surfaces/context.ts` re-exports it.

/** The two languages of ERD §2 (`users.preferred_language`). */
export type Locale = 'ar' | 'en';

/** Arabic unless the session or the query says otherwise (contracts/kernel.md). */
export const DEFAULT_LOCALE: Locale = 'ar';
