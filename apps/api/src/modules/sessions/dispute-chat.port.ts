// T040 of specs/004-sessions/tasks.md (FR-475, FR-480; research R-301, R-314; contracts/admin-surface.md,
// `disputes.chat`; contracts/kernel.md, "The composition root"): what `disputes.chat` needs of an
// enrollment's chat, which only the chat module owns. Chat imports booking, which imports sessions,
// so sessions may not import chat (the cycle chat → booking → sessions; the owner's decision of
// 2026-11-05 on the analysis, C5); sessions asks this port instead, and `main.ts` binds it to chat's
// `createDisputeChat()`, as `EnrollmentSide` is bound to booking's.
//
// Sessions checks the dispute is open first, then asks with the dispute's enrollment. The page is
// the one `chat.list` answers, with each message's sender named by its role in the enrollment in
// place of `mine`: the administrator is no party. It runs on the caller's transaction and takes no
// lock; nothing of it is a storage key (R-SEC-3).
import type { Transaction } from '../../platform/db/prisma.repository.js';

/** One message as the administrator reads it. */
export interface DisputeChatMessage {
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
export interface DisputeChatPage {
  readonly messages: DisputeChatMessage[];
  readonly nextCursor?: string;
}

export interface DisputeChat {
  /** A page of the enrollment's chat after the message `cursor` names; null for no enrollment. */
  chatPage(
    tx: Transaction,
    enrollmentId: string,
    cursor: string | undefined,
  ): Promise<DisputeChatPage | null>;
}
