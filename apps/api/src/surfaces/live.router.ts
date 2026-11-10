// T063 of specs/004-sessions: `live.events`, the live channel (contracts/app-surface.md, "`live`";
// FR-427 to FR-429, FR-437, FR-438; research R-324; the owner's decision of 2026-11-05).
//
// ONE CHANNEL PER SIGNED-IN DEVICE: a user-kind subscription with no input, so the client chooses
// no topic and there is none to forge; every event on it was addressed by the server to this caller
// (`platform/live/`). Served as Server-Sent Events by the existing user-surface mount
// (`GET /trpc/live.events`): the same context, bearer, standing, caller kind, limiter and headers as
// every call, and no WebSocket server. The bearer comes from the `Authorization` header only: the
// mount still refuses `connectionParams` (`app.module.ts`, `refusalOf`), so no token reaches a URL.
//
// Its opening declares `rate_limit_live_channel` (10 per 60 s), the caller as subject, failing
// closed as every declared limit does; a restricted standing is refused as every user kind refuses
// it. The stream lives in the process's registry (`serveLiveEvents`): at most
// `live_channel_max_connections_per_user` per account, the oldest ended; it ends at its access
// token's expiry, after an `account` event, on a sign-out of its session, when it falls behind, and
// before the API stops; each event is parsed by `liveEvent` before it is sent. The ping comment and
// the client's restart are the user instance's (`procedures.ts`).
import { liveEvent } from '@ijazah/contracts';
import { z } from 'zod';

import { LIVE_CHANNEL_RATE_LIMIT } from '../platform/guards/rate-limit.guard.js';
import { serveLiveEvents } from '../platform/live/live-registry.js';
import { createAppRouter, eventStream, userProcedure } from './procedures.js';

export const liveRouter = createAppRouter({
  events: userProcedure({
    input: z.void(),
    output: eventStream(liveEvent),
    rateLimit: { key: LIVE_CHANNEL_RATE_LIMIT, subject: 'caller' },
  }).subscription(({ ctx, signal }) =>
    serveLiveEvents(ctx.liveStreams, ctx.caller, signal, ctx.log),
  ),
});
