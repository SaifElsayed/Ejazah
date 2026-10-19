// T038: the settings keys the kernel itself reads, each named once, and (T024) the one two modules
// share. A module's own keys are the module's; a rate limit's key is declared where the limit is
// (`rate-limit.guard.ts`).
import { z } from 'zod';

/** The current Terms version, shown on the Terms page and required by `onboarding.complete` (FR-127). */
export const TERMS_VERSION_SETTING = 'terms_version';

/** How long a signed document or photo link lives, in seconds (FR-151; data-model.md §4). */
export const DOCUMENT_LINK_TTL_SETTING = 'document_link_ttl_seconds';

/** The link lifetime's schema: whole seconds, at least one; the storage port caps it at seven days. */
export const documentLinkTtl = z.int().positive();
