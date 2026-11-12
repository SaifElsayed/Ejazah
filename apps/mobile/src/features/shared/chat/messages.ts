// T045 of specs/004-sessions (FR-427, FR-488, FR-492; contracts/app-surface.md, `chat` and `live`):
// the chat's messages, the same for both roles (R-MOBILE-3). `chat.list` answers a page newest
// first; a `chat` event of the live channel carries one message in that item's shape, `mine` for
// this recipient, merged into the open chat's first page by `messageId`: one already there is not
// added twice (the event both parties receive after the sender's own answer, a replay), and one
// that arrives out of order takes its place by `sentAt`, ties by `messageId` (UUID v7, ordered by
// time). The chat is read from the enrollment's confirmation and written in only while it is
// `confirmed`: read-only once it has ended, until its purge (FR-488). These decide what is drawn;
// the server decides what is sent (`CHAT_CLOSED`, R-MOBILE-13).
import type {
  ChatListOutput,
  ChatMessage,
  ChatUploadOutput,
  EnrollmentStatus,
} from '@ijazah/contracts';

/** Whether `a` is newer than `b` in the page's order: by `sentAt`, then by `messageId`. */
function newer(a: ChatMessage, b: ChatMessage): boolean {
  // Instants compared, never subtracted (R-TIME-1).
  const at = Date.parse(a.sentAt);
  const than = Date.parse(b.sentAt);
  return at === than ? a.messageId > b.messageId : at > than;
}

/** The first page with `message` in its place, or the page itself when it already holds it. */
export function mergeChatMessage(page: ChatListOutput, message: ChatMessage): ChatListOutput {
  if (page.messages.some(({ messageId }) => messageId === message.messageId)) return page;
  const at = page.messages.findIndex((shown) => newer(message, shown));
  const messages =
    at === -1
      ? [...page.messages, message]
      : [...page.messages.slice(0, at), message, ...page.messages.slice(at)];
  return { ...page, messages };
}

/** The first page then the older pages, newest first, each message once. */
export function chatMessagesOf(
  first: ChatListOutput | undefined,
  older: readonly ChatListOutput[],
): ChatMessage[] {
  const seen = new Set<string>();
  const shown: ChatMessage[] = [];
  for (const listed of [first, ...older]) {
    for (const message of listed?.messages ?? []) {
      if (seen.has(message.messageId)) continue;
      seen.add(message.messageId);
      shown.push(message);
    }
  }
  return shown;
}

/** The message a document the caller sent became, as `chat.list` would answer it. */
export function messageOfUpload(upload: ChatUploadOutput): ChatMessage {
  return {
    messageId: upload.messageId,
    mine: true,
    attachment: upload.attachment,
    sentAt: upload.sentAt,
    purged: false,
  };
}

/** Written in only while the enrollment is confirmed (FR-488; the server's `CHAT_CLOSED`). */
export function chatWritable(status: EnrollmentStatus): boolean {
  return status === 'confirmed';
}

/** Reached from the confirmation: an enrollment awaiting payment has no chat yet (FR-488). */
export function chatReachable(status: EnrollmentStatus): boolean {
  return status !== 'pending_payment';
}
