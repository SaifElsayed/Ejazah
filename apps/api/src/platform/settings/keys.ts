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

/**
 * The most live streams one account holds, the oldest ended when one more opens (T063 of
 * specs/004-sessions, FR-428; SRS §3.14 «Live channel connections per User», seeded at 3 by T001).
 */
export const LIVE_MAX_CONNECTIONS_SETTING = 'live_channel_max_connections_per_user';

/** Its schema: a whole number of streams, at least one. */
export const liveMaxConnections = z.int().positive();

/**
 * The build floor (002:T184; SRS §3.14 «Minimum app build admitted», DEC-99): a phone sending a
 * build number below it is refused `UPDATE_REQUIRED`; seeded 0, no floor.
 */
export const MIN_APP_BUILD_SETTING = 'min_app_build';

/** Its schema: a whole build number, 0 included (Play's version code; DEC-109). */
export const minAppBuild = z.int().min(0);
