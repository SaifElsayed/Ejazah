// T063 of specs/004-sessions: what the live channel carries, `live.events`' events
// (specs/004-sessions/contracts/app-surface.md, "`live`"; research R-324, item 4; FR-427 to FR-429).
//
// A discriminated union on `type`. Each event is addressed by the server to the users the producing
// transaction read, and sent only after it commits; the client chooses no topic. A signal carries
// nothing but the ids to read again: on `session` the app reads `sessions.get` and the enrollment's
// screens, on `enrollment` the enrollment's screens and lists, on `account` `account.me`, after
// which the server ends the stream. What the screen shows is what those procedures answer.
//
// Additive only (R-API-9): T066 adds the `chat` member, `{ enrollmentId, message }` in `chat.list`'s
// item shape, once T037 has written that schema.
import { z } from 'zod';

/** Something about this session changed: read it again. */
export const liveSessionEvent = z.object({
  type: z.literal('session'),
  sessionId: z.uuid(),
  enrollmentId: z.uuid(),
});

/** Read the enrollment's screens again. */
export const liveEnrollmentEvent = z.object({
  type: z.literal('enrollment'),
  enrollmentId: z.uuid(),
});

/** Read `account.me` again; the server then ends the stream. */
export const liveAccountEvent = z.object({ type: z.literal('account') });

/** One event of the live channel; every yielded event is parsed by it before it is sent. */
export const liveEvent = z.discriminatedUnion('type', [
  liveSessionEvent,
  liveEnrollmentEvent,
  liveAccountEvent,
]);

export type LiveEvent = z.infer<typeof liveEvent>;
