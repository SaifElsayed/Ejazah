// 005:T034 (R1a; SRS FR-SESS-13 as amended, DEC-100; contracts/admin-surface.md, `reports.chat`; the
// note under T034): what `reports.chat` needs of an enrollment's chat, which only the chat module
// owns. Chat imports booking, which imports moderation, so moderation never imports chat; it asks
// this port instead, and `main.ts` binds it to chat's `createDisputeChat()`, the binding sessions'
// `DisputeChat` port already has (T040 of specs/004-sessions), as `Pairings` is bound to sessions' and
// booking's entries.
//
// Moderation checks the report open and its enrollment first, then asks with the report's
// enrollment. The page is the one `chat.list` answers, each message's sender named by its role in
// the enrollment in place of `mine`: the administrator is no party. It runs on the caller's
// transaction and takes no lock; nothing of it is a storage key (R-SEC-3).
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** One message as the administrator reads it. */
export interface ReportChatMessage {
  readonly messageId: string;
  /** The enrollment's party who sent it. */
  readonly senderRole: 'student' | 'teacher';
  /** Absent for a document alone and once purged. */
  readonly body?: string | undefined;
  /** Its name and type only; absent for text alone and once purged. */
  readonly attachment?:
    | {
        readonly filename: string;
        readonly mime: 'application/pdf' | 'text/plain';
      }
    | undefined;
  /** An ISO instant. */
  readonly sentAt: string;
  /** The retention purge removed its body and attachment (FR-492). */
  readonly purged: boolean;
}

/** `chat_page_size` messages, newest first; `nextCursor` while more follow. */
export interface ReportChatPage {
  readonly messages: ReportChatMessage[];
  readonly nextCursor?: string;
}

export interface ReportChat {
  /** A page of the enrollment's chat after the message `cursor` names; null for no enrollment. */
  chatPage(
    tx: Transaction,
    enrollmentId: string,
    cursor: string | undefined,
  ): Promise<ReportChatPage | null>;
}
