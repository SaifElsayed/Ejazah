// T063 of specs/004-sessions: what the live channel carries, `live.events`' events
// (specs/004-sessions/contracts/app-surface.md, "`live`"; research R-324, item 4; FR-427 to FR-429).
//
// A discriminated union on `type`. Each event is addressed by the server to the users the producing
// transaction read, and sent only after it commits; the client chooses no topic. A signal carries
// nothing but the ids to read again: on `session` the app reads `sessions.get` and the enrollment's
// screens, on `enrollment` the enrollment's screens and lists, on `account` `account.me`, after
// which the server ends the stream. What the screen shows is what those procedures answer.
//
// T066: the `chat` member, `{ enrollmentId, message }` with the message in `chat.list`'s item shape
// (`chatMessage`, T037), `mine` computed for each recipient; carried rather than signalled, so a
// message costs no `chat.list` per recipient (R-324, item 4). Additive only (R-API-9).
import { z } from 'zod';

import { chatMessage } from './chat.js';

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

/** T066: a message of the enrollment's chat, as `chat.list` answers it to this recipient. */
export const liveChatEvent = z.object({
  type: z.literal('chat'),
  enrollmentId: z.uuid(),
  message: chatMessage,
});

/**
 * T006 of specs/005-certification (contracts/app-surface.md, «Live event»; FR-608): the ijazah
 * request of this enrollment changed (sent, approved, rejected, signed off, revoked); the parties
 * read it again. Its enrollment only.
 */
export const liveIjazahRequestEvent = z.object({
  type: z.literal('ijazahRequest'),
  enrollmentId: z.uuid(),
});

/** One event of the live channel; every yielded event is parsed by it before it is sent. */
export const liveEvent = z.discriminatedUnion('type', [
  liveSessionEvent,
  liveEnrollmentEvent,
  liveAccountEvent,
  liveChatEvent,
  liveIjazahRequestEvent,
]);

export type LiveEvent = z.infer<typeof liveEvent>;
