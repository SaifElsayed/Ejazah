// T037 of specs/004-sessions: `chat.list` and `chat.send` (FR-488, FR-491, FR-499; research R-314;
// plan.md decisions 8 and 11; contracts/app-surface.md, "`chat`"; contracts/kernel.md, the rows
// «`chat.send`, `POST /uploads/chat`» and «`chat.list`, `chat.attachmentLink`»).
//
// WHO (FR-488, FR-432, R-GENDER-2). The two parties of the enrollment, and only they: the
// enrollment's parties and status come through booking's entry (`ChatEnrollments`, bound by
// `main.ts` to booking's `createEnrollmentSide()`, R-301), the genders through identity's
// `sessionPartiesOf`. A caller who is not a party, an enrollment that does not exist, and one whose
// counterparty is of the other gender by the server's records answer one `NOT_FOUND` with no field,
// an administrator's gender correction included, since the records are read at each call. A
// deleted counterparty has no record and is not compared.
//
// THE READ takes no lock (the note under T037, Q3 (a)): the enrollment and its two parties are read
// in one transaction and the genders compared, as `sessions.get` reads, then a page of
// `chat_page_size` messages newest first, keyset on the message id. A chat stays readable after the
// enrollment ends, until the purge (decision 11).
//
// THE SEND is keyed by the kernel's idempotency under scope `chat.send` (the note under T037, F3), so
// the service opens the transaction (`IdempotencyService.run`). The enrollment is read once with no
// lock to learn its parties, so a stranger is refused before any lock; then the sender's `users` row
// is locked, then the enrollment, and its status and parties are read again under them (T005 rule 1;
// the third analysis, L-B), the counterparty's gender read, not locked. A party sending on any
// status but `confirmed`, a pending one included, answers `CHAT_CLOSED` (F17). The message's instant
// is the database's clock read under the locks.
//
// Every refusal writes one info line with the enrollment's and the caller's ids, the code and the
// reason, nothing else (never the body), its error marked «logged» so the handler's one-place
// refusal log writes no second line (PR #130's review, Minor 4).
//
// THE LIVE EVENT (T066 of specs/004-sessions; FR-427; research R-324, items 4 to 6; the note under
// T066, Q3 (a)). The send is handed the request's after-commit list by its router (`ctx.live`) and
// adds, inside the keyed effect, one `chat` event to each of the enrollment's two parties as the
// locks read them, the sender's other devices included, the message in `chat.list`'s item shape
// with `mine` computed for each recipient. A replay runs no effect and adds nothing; the participant
// kind sends the list once the handler resolves and drops it when it throws. No log line carries
// the body (R-SEC-2).
import {
  type ChatAttachmentLinkInput,
  type ChatAttachmentLinkOutput,
  type ChatListInput,
  type ChatListOutput,
  type ChatMessage,
  type ChatSendInput,
  type ChatSendOutput,
  chatSendOutput,
} from '@ijazah/contracts';
import { addSeconds } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type {
  IdempotencyService,
  JsonValue,
} from '../../platform/idempotency/idempotency.service.js';
import type { LivePublisher } from '../../platform/live/live-publisher.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { sessionPartiesOf } from '../identity/index.js';
import {
  attachmentOf,
  type ChatAttachmentRow,
  type ChatMessageRow,
  type ChatPageQuery,
  insertAttachment,
  insertMessage,
  lockSender,
  messagePage,
  type NewChatAttachment,
  type NewChatMessage,
} from './chat.repository.js';

/** The settings key of a page of the chat (SRS §3.14 «Chat page size (messages)», FR-491). */
export const CHAT_PAGE_SIZE_SETTING = 'chat_page_size';

const positiveWhole = z.int().positive();

/** `enrollments.status` (ERD §5), written out: only a repository may import the database client. */
export type ChatEnrollmentStatus =
  'pending_payment' | 'confirmed' | 'completed' | 'terminated_no_show' | 'cancelled';

/** What the chat decides on of an enrollment: its status and its two parties. */
export interface ChatEnrollmentTerms {
  readonly id: string;
  readonly status: ChatEnrollmentStatus;
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/**
 * What the chat asks of booking (R-301): booking's `EnrollmentSide` answers it, bound by `main.ts`.
 * `enrollmentFor` takes no lock; `lockEnrollments` locks the rows `FOR UPDATE`, id order.
 */
export interface ChatEnrollments {
  enrollmentFor(tx: Transaction, id: string): Promise<ChatEnrollmentTerms | null>;
  lockEnrollments(tx: Transaction, ids: readonly string[]): Promise<void>;
}

/** A party's record as the gender check reads it. */
export interface ChatPartyRecord {
  readonly gender: 'male' | 'female';
}

/** Every query the chat procedures make, each on the caller's transaction. */
export interface ChatStore {
  partiesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, ChatPartyRecord>>;
  lockSender(tx: Transaction, userId: string): Promise<void>;
  messagePage(tx: Transaction, query: ChatPageQuery): Promise<ChatMessageRow[]>;
  insertMessage(tx: Transaction, row: NewChatMessage): Promise<ChatMessageRow>;
  /** T038: a message's document, its enrollment and its purge, or null when there is no message. */
  attachmentOf(tx: Transaction, messageId: string): Promise<ChatAttachmentRow | null>;
  /** T038: a document's message, inserted. */
  insertAttachment(tx: Transaction, row: NewChatAttachment): Promise<ChatMessageRow>;
}

/** The chat's repository and identity's entry, as the services use them by default. */
export const chatStore: ChatStore = {
  partiesOf: sessionPartiesOf,
  lockSender,
  messagePage,
  insertMessage,
  attachmentOf,
  insertAttachment,
};

export interface ChatCaller {
  readonly userId: string;
}

export interface ChatServices {
  list(caller: ChatCaller, input: ChatListInput, log: Logger): Promise<ChatListOutput>;
  /** T066: `live` is the request's after-commit list (`ctx.live`), the message's `chat` events added to it. */
  send(
    caller: ChatCaller,
    input: ChatSendInput,
    log: Logger,
    live: LivePublisher,
  ): Promise<ChatSendOutput>;
  /** T038: a signed link to a message's document, valid `document_link_ttl_seconds`. */
  attachmentLink(
    caller: ChatCaller,
    input: ChatAttachmentLinkInput,
    log: Logger,
  ): Promise<ChatAttachmentLinkOutput>;
}

export interface ChatDependencies {
  readonly transactions: Transactions;
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  readonly settings: SettingsReader;
  readonly enrollments: ChatEnrollments;
  readonly store?: ChatStore;
  /** The database's clock on the transaction (`clock_timestamp()`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  /** T038: the storage port's signed links (R-SEC-3). */
  readonly storage: Pick<StoragePort, 'temporaryLink'>;
  /** T038: the process's clock, from which a link's `expiresAt` is told (as `documentLinkFor`). */
  readonly now?: () => Date;
}

/** Why a chat call was refused, as its log line names it. */
export type ChatRefusalReason =
  | 'not_a_party'
  | 'gender_differs'
  | 'not_confirmed'
  // T038: `chat.attachmentLink`'s.
  | 'no_message'
  | 'purged'
  | 'no_attachment';

export interface ChatRefusalIds {
  readonly enrollmentId?: string;
  readonly userId: string;
  /** T038: the message `chat.attachmentLink` names. */
  readonly messageId?: string;
}

/** The ids of a call on an enrollment's chat. */
export interface ChatEnrollmentIds extends ChatRefusalIds {
  readonly enrollmentId: string;
}

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked as logged
 * so the handler's one-place refusal log writes no second line.
 */
export function chatRefusal(
  log: Logger,
  ids: ChatRefusalIds,
  errorCode: ErrorCode,
  reason: ChatRefusalReason,
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A chat call was refused');
  return markRefusalLogged(new DomainError(errorCode));
}

/** A message as the caller reads it: `mine` from the sender, a purged one with nothing of it. */
export function chatMessageOf(row: ChatMessageRow, userId: string): ChatMessage {
  const common = {
    messageId: row.id,
    mine: row.senderUserId === userId,
    sentAt: row.sentAt.toISOString(),
  };
  if (row.purgedAt !== null) return { ...common, purged: true };
  return {
    ...common,
    ...(row.body === null ? {} : { body: row.body }),
    ...(row.attachmentFilename === null || row.attachmentMime === null
      ? {}
      : {
          attachment: {
            filename: row.attachmentFilename,
            mime: row.attachmentMime as 'application/pdf' | 'text/plain',
          },
        }),
    purged: false,
  };
}

/**
 * T066: the message's `chat` event added for each of the enrollment's two parties, the sender first,
 * `mine` computed for each, to be sent once the caller's transaction has committed.
 */
export function tellParties(
  live: LivePublisher,
  terms: Pick<ChatEnrollmentTerms, 'id' | 'studentUserId' | 'teacherUserId'>,
  row: ChatMessageRow,
): void {
  const other =
    row.senderUserId === terms.studentUserId ? terms.teacherUserId : terms.studentUserId;
  for (const recipient of [row.senderUserId, other]) {
    live.afterCommit([recipient], {
      type: 'chat',
      enrollmentId: terms.id,
      message: chatMessageOf(row, recipient),
    });
  }
}

/** A message as the idempotency key stores it: its fields with a value, no `undefined` (JSON). */
function storedOf({ body, attachment, ...message }: ChatMessage): JsonValue {
  return {
    ...message,
    ...(body === undefined ? {} : { body }),
    ...(attachment === undefined ? {} : { attachment }),
  };
}

const SEND_SCOPE = 'chat.send';

export function createChatServices({
  transactions,
  idempotency,
  settings,
  enrollments,
  store = chatStore,
  clock = clockTimestamp,
  storage,
  now = () => new Date(),
}: ChatDependencies): ChatServices {
  const { participantOf, lockedParticipantOf } = createChatAccess({ enrollments, store });

  return {
    list: async ({ userId }, { enrollmentId, cursor }, log) => {
      const pageSize = await settings.read(CHAT_PAGE_SIZE_SETTING, positiveWhole);
      return transactions.run(async (tx) => {
        await participantOf(tx, { enrollmentId, userId }, log);
        const rows = await store.messagePage(tx, {
          enrollmentId,
          before: cursor,
          take: pageSize + 1,
        });
        const page = rows.slice(0, pageSize);
        const last = page.at(-1);
        const messages = page.map((row) => chatMessageOf(row, userId));
        return rows.length > pageSize && last !== undefined
          ? { messages, nextCursor: last.id }
          : { messages };
      });
    },

    // The outcome is stored as it is answered and replayed from the store, so it is parsed by the
    // contract's schema on its way out, the first answer and a replay alike (as remedy's counter).
    send: async ({ userId }, { idempotencyKey, ...asked }, log, live) =>
      chatSendOutput.parse(
        await idempotency.run(
          { scope: SEND_SCOPE, key: idempotencyKey, actorId: userId, input: asked },
          async (tx) => {
            const ids = { enrollmentId: asked.enrollmentId, userId };
            const terms = await lockedParticipantOf(tx, ids, log);
            const sentAt = await clock(tx);
            const row = await store.insertMessage(tx, {
              enrollmentId: asked.enrollmentId,
              senderUserId: userId,
              body: asked.body,
              sentAt,
            });
            // T066: inside the keyed effect, so a replay adds nothing.
            tellParties(live, terms, row);
            return storedOf(chatMessageOf(row, userId));
          },
        ),
      ),

    // T038: the message and its enrollment's parties read with no lock (the note under T037, Q3
    // (a)); the link minted after the commit, so no transaction waits on the storage port.
    attachmentLink: async ({ userId }, { messageId }, log) => {
      const ttl = await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl);
      const key = await transactions.run(async (tx) => {
        const found = await store.attachmentOf(tx, messageId);
        if (found === null)
          throw chatRefusal(log, { messageId, userId }, 'NOT_FOUND', 'no_message');
        const ids = { enrollmentId: found.enrollmentId, messageId, userId };
        await participantOf(tx, ids, log);
        if (found.purgedAt !== null) throw chatRefusal(log, ids, 'NOT_FOUND', 'purged');
        if (found.attachmentKey === null) {
          throw chatRefusal(log, ids, 'NOT_FOUND', 'no_attachment');
        }
        return found.attachmentKey;
      });
      const url = await storage.temporaryLink(key, ttl);
      return { url, expiresAt: addSeconds(now(), ttl) };
    },
  };
}

/**
 * Who may read or write an enrollment's chat, shared by the procedures and T038's upload and link:
 * `participantOf` reads with no lock (the reads); `lockedParticipantOf` refuses a stranger before any
 * lock, then locks the sender's `users` row and the enrollment, reads both again under them and
 * refuses any status but `confirmed` `CHAT_CLOSED` (the sending paths).
 */
export function createChatAccess({
  enrollments,
  store,
}: {
  readonly enrollments: ChatEnrollments;
  readonly store: Pick<ChatStore, 'partiesOf' | 'lockSender'>;
}): {
  participantOf(tx: Transaction, ids: ChatEnrollmentIds, log: Logger): Promise<ChatEnrollmentTerms>;
  /** T038: `participantOf` and the status `confirmed`, with no lock (the upload's check before storing). */
  openParticipantOf(
    tx: Transaction,
    ids: ChatEnrollmentIds,
    log: Logger,
  ): Promise<ChatEnrollmentTerms>;
  lockedParticipantOf(
    tx: Transaction,
    ids: ChatEnrollmentIds,
    log: Logger,
  ): Promise<ChatEnrollmentTerms>;
} {
  /** The enrollment when the caller is one of its parties; NOT_FOUND otherwise. */
  async function partyEnrollment(
    tx: Transaction,
    ids: ChatEnrollmentIds,
    log: Logger,
  ): Promise<ChatEnrollmentTerms> {
    const terms = await enrollments.enrollmentFor(tx, ids.enrollmentId);
    if (
      terms === null ||
      (terms.studentUserId !== ids.userId && terms.teacherUserId !== ids.userId)
    ) {
      throw chatRefusal(log, ids, 'NOT_FOUND', 'not_a_party');
    }
    return terms;
  }

  /** The two parties' genders compared by the server's records; the other gender NOT_FOUND. */
  async function sameGender(
    tx: Transaction,
    terms: ChatEnrollmentTerms,
    ids: ChatEnrollmentIds,
    log: Logger,
  ): Promise<void> {
    const parties = await store.partiesOf(tx, [terms.studentUserId, terms.teacherUserId].sort());
    const own = parties.get(ids.userId);
    const other = parties.get(
      terms.studentUserId === ids.userId ? terms.teacherUserId : terms.studentUserId,
    );
    if (own === undefined) throw chatRefusal(log, ids, 'NOT_FOUND', 'not_a_party');
    if (other !== undefined && other.gender !== own.gender) {
      throw chatRefusal(log, ids, 'NOT_FOUND', 'gender_differs');
    }
  }

  /** Any status but `confirmed`, a pending one included, `CHAT_CLOSED` (F17). */
  function open(terms: ChatEnrollmentTerms, ids: ChatEnrollmentIds, log: Logger): void {
    if (terms.status !== 'confirmed') throw chatRefusal(log, ids, 'CHAT_CLOSED', 'not_confirmed');
  }

  const participantOf = async (
    tx: Transaction,
    ids: ChatEnrollmentIds,
    log: Logger,
  ): Promise<ChatEnrollmentTerms> => {
    const terms = await partyEnrollment(tx, ids, log);
    await sameGender(tx, terms, ids, log);
    return terms;
  };

  return {
    participantOf,
    openParticipantOf: async (tx, ids, log) => {
      const terms = await participantOf(tx, ids, log);
      open(terms, ids, log);
      return terms;
    },
    lockedParticipantOf: async (tx, ids, log) => {
      await partyEnrollment(tx, ids, log);
      await store.lockSender(tx, ids.userId);
      await enrollments.lockEnrollments(tx, [ids.enrollmentId]);
      const terms = await participantOf(tx, ids, log);
      open(terms, ids, log);
      return terms;
    },
  };
}
