// T063 of specs/004-sessions: the live channel's transport and protection numbers (research R-324,
// item 8; contracts/kernel.md, "The live channel"). Each is a named constant under R-MONEY-12's
// exception (constitution 2.6.1, the owner's decisions of 2026-11-06, C1 and the fifth analysis's C3
// and C4), not a setting, for the reason beside it; the queue's fixed retry numbers are the
// precedent (`apps/api/src/jobs/README.md`). The channel's own limits, `rate_limit_live_channel` and
// `live_channel_max_connections_per_user`, stay settings. `surfaces/procedures.ts` imports the ping
// and the restart, so neither number is written in `surfaces/`.

/**
 * The server's ping comment on every open stream, under nginx's 60 s default read timeout and
 * Cloudflare's 100 s. Not a setting: an administrator changing it from the panel could break every
 * stream, past the proxy's read timeout or the client's inactivity restart below.
 */
export const LIVE_PING_INTERVAL_MS = 25_000;

/**
 * The client restarts a stream silent this long, which catches a half-open connection after a
 * network switch. Tied to the ping: tRPC refuses a ping interval above it.
 */
export const LIVE_RECONNECT_AFTER_INACTIVITY_MS = 60_000;

/**
 * The most events one stream holds unsent; a stream whose reader falls this far behind is ended
 * (`queue_overflow`) rather than held in memory. It protects the API's memory: events are a few per
 * minute per person, so a reader this far behind is not reading.
 */
export const LIVE_STREAM_QUEUE_BOUND = 32;
