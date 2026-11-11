// T039 of specs/004-sessions/tasks.md (FR-492; ERD §6 `chat_messages`, §15 rules 8 and 47; research
// R-314; contracts/kernel.md, the purge's row; the notes under T039): the purge's queries over
// chat's own table, and the enrollment's row lock it decides under.
//
// THE LOCK. `chat_messages.enrollment_id` references `enrollments`, so this module locks that row
// through `lockRows` only, reading and writing no column of it (the owner's decision of 2026-11-02,
// `platform/db/row-lock.ts`'s head); every case opening takes the same lock (`lockCasesOf`), so no
// case opens while the purge decides (B40's conflict check, F13).
//
// THE PURGE (Q2 (a)). One update NULLs each unpurged message's body, attachment name and type and
// sets `purged_at`; the attachment's key stays until its file is removed after the commit, then is
// cleared only where the row still holds that key, so a removal that failed is found again by
// `heldFilesAfter` on the next run. Rules 8 and 47 accept a purged row holding its key alone
// (migrations `20261007000000_init` and `20261108120000_sessions_pass`).
//
// THE READS. Each page is bounded by its limit and walks a key after the last one read. The
// enrollments with an unpurged message are grouped over `chat_messages_enrollment_id_idx`; the
// held files are the purged rows still holding a key, in enrollment then id order, so one
// enrollment's files are read together. Neither has an index of its own (data-model.md §2.10,
// R-DB-9): a daily sweep, worth a measurement after launch.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lockRows } from '../../platform/db/row-lock.js';

/** A purged message whose file is still stored, by its key. */
export interface HeldChatFile {
  readonly messageId: string;
  readonly enrollmentId: string;
  readonly storageKey: string;
}

/** What one enrollment's purge wrote: the messages purged and the files still to remove. */
export interface PurgedMessages {
  readonly messages: number;
  readonly files: readonly HeldChatFile[];
}

/** Of the enrollments with an unpurged message, those after `after` in id order, at most `limit`. */
export async function unpurgedEnrollmentsAfter(
  tx: Pick<Transaction, 'chatMessage'>,
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const groups = await tx.chatMessage.groupBy({
    by: ['enrollmentId'],
    where: { purgedAt: null, ...(after === undefined ? {} : { enrollmentId: { gt: after } }) },
    orderBy: { enrollmentId: 'asc' },
    take: limit,
  });
  return groups.map(({ enrollmentId }) => enrollmentId);
}

/** Locks the enrollment's row, FOR UPDATE, until the transaction ends (this file's head). */
export function lockEnrollmentOf(tx: Transaction, enrollmentId: string): Promise<void> {
  return lockRows(tx, 'enrollments', [enrollmentId]);
}

/** Purges every unpurged message of the enrollment at `at`, keeping each attachment's key. */
export async function purgeMessagesOf(
  tx: Pick<Transaction, 'chatMessage'>,
  enrollmentId: string,
  at: Date,
): Promise<PurgedMessages> {
  const rows = await tx.chatMessage.updateManyAndReturn({
    where: { enrollmentId, purgedAt: null },
    data: { body: null, attachmentFilename: null, attachmentMime: null, purgedAt: at },
    select: { id: true, attachmentKey: true },
  });
  return {
    messages: rows.length,
    files: rows.flatMap(({ id, attachmentKey }) =>
      attachmentKey === null ? [] : [{ messageId: id, enrollmentId, storageKey: attachmentKey }],
    ),
  };
}

/** The purged messages still holding a key, in enrollment then id order after `after`, at most `limit`. */
export async function heldFilesAfter(
  tx: Pick<Transaction, 'chatMessage'>,
  after: HeldChatFile | undefined,
  limit: number,
): Promise<readonly HeldChatFile[]> {
  const rows = await tx.chatMessage.findMany({
    where: {
      purgedAt: { not: null },
      attachmentKey: { not: null },
      ...(after === undefined
        ? {}
        : {
            OR: [
              { enrollmentId: { gt: after.enrollmentId } },
              { enrollmentId: after.enrollmentId, id: { gt: after.messageId } },
            ],
          }),
    },
    orderBy: [{ enrollmentId: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, enrollmentId: true, attachmentKey: true },
  });
  return rows.flatMap(({ id, enrollmentId, attachmentKey }) =>
    attachmentKey === null ? [] : [{ messageId: id, enrollmentId, storageKey: attachmentKey }],
  );
}

/** Clears the key of a purged message once its file is gone, only where it still holds `storageKey`. */
export async function clearPurgedKey(
  tx: Pick<Transaction, 'chatMessage'>,
  { messageId, storageKey }: HeldChatFile,
): Promise<boolean> {
  const { count } = await tx.chatMessage.updateMany({
    where: { id: messageId, attachmentKey: storageKey, purgedAt: { not: null } },
    data: { attachmentKey: null },
  });
  return count === 1;
}
