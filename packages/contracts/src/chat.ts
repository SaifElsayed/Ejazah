// T037 of specs/004-sessions: the `chat` namespace of the user surface, `chat.list` and `chat.send`
// (specs/004-sessions/contracts/app-surface.md, "`chat`"; FR-488, FR-491; research R-314).
//
// The caller names the enrollment and nothing else (R-GENDER-4): an enrollment the caller is not a
// party of, one whose counterparty is of the other gender by the server's records, and one that does
// not exist answer one `NOT_FOUND` (R-GENDER-2). A message names its sender only as `mine`, so
// nothing of the counterparty crosses, and never a storage key (R-SEC-3): an attachment is its name
// and its type, its bytes reached through a signed link (T038). A purged message keeps its id, its
// side and its instant, with neither body nor attachment (FR-492).
//
// `chatMessage` is its own schema: T066's live `chat` event carries a message in this shape
// (`live.ts`). Additive only once merged (R-API-9).
import { z } from 'zod';

import { idempotencyKey } from './idempotency-key.js';

/** The two types a chat document may be, by its content (FR-489; plan.md decision 12). */
export const chatAttachmentMime = z.enum(['application/pdf', 'text/plain']);

/** A message's document as the parties see it: its name and its type, never its key. */
export const chatAttachment = z.object({
  filename: z.string(),
  mime: chatAttachmentMime,
});

/** One message of an enrollment's chat (app-surface.md, `chat.list`'s item). */
export const chatMessage = z.object({
  messageId: z.uuid(),
  /** The caller sent it; the counterparty otherwise. */
  mine: z.boolean(),
  /** Absent for a document alone and once purged. */
  body: z.string().optional(),
  /** Absent for text alone and once purged. */
  attachment: chatAttachment.optional(),
  sentAt: z.iso.datetime(),
  /** The retention purge removed its body and attachment (FR-492). */
  purged: z.boolean(),
});

/** The longest message, in characters (app-surface.md, `chat.send`). */
export const CHAT_BODY_MAX_LENGTH = 2000;

/** A page of the enrollment's chat, newest first, after the message `cursor` names. */
export const chatListInput = z.object({
  enrollmentId: z.uuid(),
  cursor: z.uuid().optional(),
});

/** `chat_page_size` messages, newest first; `nextCursor` while more follow. */
export const chatListOutput = z.object({
  messages: z.array(chatMessage),
  nextCursor: z.uuid().optional(),
});

/** A text message to the enrollment's chat, keyed by the kernel's idempotency; never blank. */
export const chatSendInput = z.object({
  enrollmentId: z.uuid(),
  body: z.string().trim().min(1).max(CHAT_BODY_MAX_LENGTH),
  idempotencyKey,
});

/** The message sent, as `chat.list` shows it. */
export const chatSendOutput = chatMessage;

export type ChatMessage = z.infer<typeof chatMessage>;
export type ChatListInput = z.infer<typeof chatListInput>;
export type ChatListOutput = z.infer<typeof chatListOutput>;
export type ChatSendInput = z.infer<typeof chatSendInput>;
export type ChatSendOutput = z.infer<typeof chatSendOutput>;
