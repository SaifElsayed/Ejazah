// T037 of specs/004-sessions: every query of `chat_messages` the chat procedures make (R-API-6; the
// chat module owns the table, `packages/config/module-tables.json`), each on the caller's
// transaction.
//
// A page is keyset on the message's id, a UUID v7 the database mints in time order, newest first:
// the enrollment's foreign-key index finds its rows and the primary key orders them; no new index
// (data-model.md §2.10, R-DB-9). Nothing here answers a storage key: the page selects the name and
// the type of an attachment only (R-SEC-3).
//
// The sender's lock (contracts/kernel.md, the `chat.send` row; the third analysis, L-B): a message
// references the sender by a foreign key, so the sending paths lock that `users` row first through
// the kernel's `lockRows`, reading no column of `users` (`platform/db/row-lock.ts`, the owner's
// decision of 2026-11-02).
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

/** A message as the procedures decide on it: never its storage key. */
export interface ChatMessageRow {
  readonly id: string;
  readonly senderUserId: string;
  readonly body: string | null;
  readonly attachmentFilename: string | null;
  readonly attachmentMime: string | null;
  readonly sentAt: Date;
  readonly purgedAt: Date | null;
}

/** A text message to insert. */
export interface NewChatMessage {
  readonly enrollmentId: string;
  readonly senderUserId: string;
  readonly body: string;
  readonly sentAt: Date;
}

/** Which page: the enrollment's messages before the message `before` names, at most `take`. */
export interface ChatPageQuery {
  readonly enrollmentId: string;
  readonly before?: string | undefined;
  readonly take: number;
}

/** The enrollment's messages newest first, after the cursor; no lock. */
export async function messagePage(
  tx: Pick<Transaction, 'chatMessage'>,
  { enrollmentId, before, take }: ChatPageQuery,
): Promise<ChatMessageRow[]> {
  return tx.chatMessage.findMany({
    where: { enrollmentId, ...(before === undefined ? {} : { id: { lt: before } }) },
    orderBy: { id: 'desc' },
    take,
    select: {
      id: true,
      senderUserId: true,
      body: true,
      attachmentFilename: true,
      attachmentMime: true,
      sentAt: true,
      purgedAt: true,
    },
  });
}

/** Inserts a text message and answers it as a page shows it. */
export async function insertMessage(
  tx: Pick<Transaction, 'chatMessage'>,
  row: NewChatMessage,
): Promise<ChatMessageRow> {
  return tx.chatMessage.create({
    data: row,
    select: {
      id: true,
      senderUserId: true,
      body: true,
      attachmentFilename: true,
      attachmentMime: true,
      sentAt: true,
      purgedAt: true,
    },
  });
}

/** T175: a message as a page shows it, by the primary key, or null; no lock (`chat.send`'s replay). */
export async function messageById(
  tx: Pick<Transaction, 'chatMessage'>,
  messageId: string,
): Promise<ChatMessageRow | null> {
  return tx.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      senderUserId: true,
      body: true,
      attachmentFilename: true,
      attachmentMime: true,
      sentAt: true,
      purgedAt: true,
    },
  });
}

/** T038: a message's document as `chat.attachmentLink` decides on it; the key never leaves chat. */
export interface ChatAttachmentRow {
  readonly enrollmentId: string;
  readonly attachmentKey: string | null;
  readonly purgedAt: Date | null;
}

/** T038: a document's message to insert: the key private, the name and the type by content. */
export interface NewChatAttachment {
  readonly enrollmentId: string;
  readonly senderUserId: string;
  readonly attachmentKey: string;
  readonly attachmentFilename: string;
  readonly attachmentMime: 'application/pdf' | 'text/plain';
  readonly sentAt: Date;
}

/** T038: the message's enrollment, its document's key and its purge, by the primary key; no lock. */
export async function attachmentOf(
  tx: Pick<Transaction, 'chatMessage'>,
  messageId: string,
): Promise<ChatAttachmentRow | null> {
  return tx.chatMessage.findUnique({
    where: { id: messageId },
    select: { enrollmentId: true, attachmentKey: true, purgedAt: true },
  });
}

/** T038: inserts a document's message, no body, and answers it as a page shows it. */
export async function insertAttachment(
  tx: Pick<Transaction, 'chatMessage'>,
  row: NewChatAttachment,
): Promise<ChatMessageRow> {
  return tx.chatMessage.create({
    data: row,
    select: {
      id: true,
      senderUserId: true,
      body: true,
      attachmentFilename: true,
      attachmentMime: true,
      sentAt: true,
      purgedAt: true,
    },
  });
}

/** Locks the sender's `users` row, `FOR UPDATE` (the `chat.send` row of contracts/kernel.md). */
export async function lockSender(tx: Transaction, userId: string): Promise<void> {
  await lockRows(tx, 'users', [userId]);
}
