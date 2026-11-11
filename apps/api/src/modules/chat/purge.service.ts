// T039 of specs/004-sessions/tasks.md (FR-492; SRS FR-SESS-13; ERD §6 `chat_messages`, §15 rules 8
// and 47; research R-314, R-323 row P3-26; contracts/kernel.md, the purge's row and its jobs row;
// the notes under T039): the chat purge, run daily by `jobs/purge-chat.ts`.
//
// WHEN. An enrollment's chat is purged when, read under the enrollment's lock, it is `completed`,
// `terminated_no_show` or `cancelled` (booking's entry), the latest scheduled end among its sessions
// (sessions' entry) + `dispute_window_hours` + `chat_retention_days` has passed by the database's
// clock (`clockTimestamp`), and no `disputes` row of any kind is open on it, a session dispute, a
// compensation case or a complaint of the teacher's absence (moderation's
// `enrollmentsWithOpenMatterAmong`, R-301). An enrollment no ordinary read returns, or with no
// session, is left as it is. Each read is the owner's, never a table of another module (R-API-6).
//
// THE LOCK (B40's conflict check, F13; T005 rule 1). Each page is first narrowed with no lock, then
// each enrollment left is purged in its own transaction: the enrollment's row locked first (the lock
// every case opening takes), every condition read again under it, then the one update. A case opened
// while the purge waited is read and keeps the chat. No other lock: a send locks its sender, then the
// enrollment, and refuses an enrollment that has ended.
//
// THE FILES (Q2 (a)). The update keeps each attachment's key; after the commit each file is removed
// through the storage port (an absent one is not an error) and its key cleared where the row still
// holds it. A removal that failed keeps its key, and every run first takes the purged rows still
// holding one and tries them again, as `erase-deleted-files` does.
//
// THE LINES (the owner's decision of 2026-11-06; Q2 (a)). One `info` `{ enrollmentId, messages,
// files }` per enrollment purged, the messages purged and the files removed, after its removals; a
// later run that removes files held back writes `{ enrollmentId, messages: 0, files }`, once per
// enrollment; one `warn` `{ messageId }` per removal that failed; nothing for an enrollment not
// purged. Never a body, a file name or a storage key, and no error object, which could carry a key:
// the failed removal is retried by the next run. An enrollment whose transaction fails writes one
// `error` `{ enrollmentId }` and is reported, the others go on (the sweeps' rule).
//
// IRREVERSIBLE (FR-492, by design). The bodies, the attachments' names and types, and the files are
// gone; the rows stay with their `purged_at`, the evidence (R-323 row P3-26).
import type { EnrollmentStatus } from '@ijazah/contracts';
import { addDays, addHours } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { orderEnrollmentPartiesAmong } from '../booking/index.js';
import { enrollmentsWithOpenMatterAmong } from '../moderation/index.js';
import {
  DISPUTE_WINDOW_SETTING,
  disputeWindowHours,
  sessionsOfEnrollments,
} from '../sessions/index.js';
import {
  clearPurgedKey,
  type HeldChatFile,
  heldFilesAfter,
  lockEnrollmentOf,
  type PurgedMessages,
  purgeMessagesOf,
  unpurgedEnrollmentsAfter,
} from './purge.repository.js';

/** The days a chat is kept after its last dispute window has closed (SRS §3.14; data-model.md §4). */
export const CHAT_RETENTION_SETTING = 'chat_retention_days';

/** The retention's schema: whole days, zero included (the setting's earlier default). */
export const chatRetentionDays = z.int().nonnegative();

/** The statuses an enrollment's chat may be purged in (FR-492). */
const ENDED: ReadonlySet<EnrollmentStatus> = new Set([
  'completed',
  'terminated_no_show',
  'cancelled',
]);

/** What the purge reads and writes, each on the caller's transaction; faked in the job's spec. */
export interface ChatPurgeStore {
  unpurgedEnrollmentsAfter(
    tx: Transaction,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]>;
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  /** Booking's: each enrollment's status; one no ordinary read returns is absent. */
  statusesAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, EnrollmentStatus>>;
  /** Sessions': each enrollment's latest scheduled end; one with no session is absent. */
  lastScheduledEndsAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, Date>>;
  /** Moderation's: those with an open `disputes` row of any kind. */
  openMattersAmong(tx: Transaction, enrollmentIds: readonly string[]): Promise<ReadonlySet<string>>;
  purgeMessagesOf(tx: Transaction, enrollmentId: string, at: Date): Promise<PurgedMessages>;
  heldFilesAfter(
    tx: Transaction,
    after: HeldChatFile | undefined,
    limit: number,
  ): Promise<readonly HeldChatFile[]>;
  clearKey(tx: Transaction, file: HeldChatFile): Promise<boolean>;
}

/** The latest scheduled end of each enrollment's sessions, every session counted. */
async function lastScheduledEndsAmong(
  tx: Transaction,
  enrollmentIds: readonly string[],
): Promise<ReadonlyMap<string, Date>> {
  const sessions = await sessionsOfEnrollments(tx, enrollmentIds);
  const ends = new Map<string, Date>();
  for (const [enrollmentId, rows] of sessions) {
    for (const { endsAt } of rows) {
      const last = ends.get(enrollmentId);
      if (last === undefined || endsAt > last) ends.set(enrollmentId, endsAt);
    }
  }
  return ends;
}

/** The store over chat's queries and the owners' entries (R-API-6). */
export const chatPurgeStore: ChatPurgeStore = {
  unpurgedEnrollmentsAfter,
  lockEnrollment: lockEnrollmentOf,
  statusesAmong: async (tx, enrollmentIds) => {
    const parties = await orderEnrollmentPartiesAmong(tx, enrollmentIds);
    return new Map([...parties].map(([id, { status }]) => [id, status] as const));
  },
  lastScheduledEndsAmong,
  openMattersAmong: enrollmentsWithOpenMatterAmong,
  purgeMessagesOf,
  heldFilesAfter,
  clearKey: clearPurgedKey,
};

export interface ChatPurgeDependencies {
  readonly transactions: Transactions;
  readonly storage: Pick<StoragePort, 'remove'>;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info' | 'warn' | 'error'>;
  /** How many enrollments, or held files, each read takes (the job's constant). */
  readonly pageSize: number;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The database's clock on the call's transaction; `clockTimestamp` unless a spec sets one. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: ChatPurgeStore;
}

/** What one enrollment's purge did: the messages purged and the files removed. */
export interface ChatPurged {
  readonly messages: number;
  readonly files: number;
}

export interface ChatPurge {
  /** One run: the held files tried again, then every enrollment due purged (this file's head). */
  run(): Promise<void>;
  /** The enrollment purged under its lock if it is due, its files removed and its line written; null when not due. */
  purgeIfDue(enrollmentId: string): Promise<ChatPurged | null>;
}

export function createChatPurge({
  transactions,
  storage,
  settings,
  log,
  pageSize,
  report = reportError,
  clock = clockTimestamp,
  store = chatPurgeStore,
}: ChatPurgeDependencies): ChatPurge {
  const failedWith = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  /** Of `enrollmentIds`, those due at `at` (this file's head, WHEN). */
  async function dueAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
    at: Date,
  ): Promise<readonly string[]> {
    if (enrollmentIds.length === 0) return [];
    const statuses = await store.statusesAmong(tx, enrollmentIds);
    const ended = enrollmentIds.filter((id) => {
      const status = statuses.get(id);
      return status !== undefined && ENDED.has(status);
    });
    if (ended.length === 0) return [];
    const ends = await store.lastScheduledEndsAmong(tx, ended);
    const open = await store.openMattersAmong(tx, ended);
    const hours = await settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours);
    const days = await settings.read(CHAT_RETENTION_SETTING, chatRetentionDays);
    return ended.filter((id) => {
      const end = ends.get(id);
      if (end === undefined || open.has(id)) return false;
      const purgeAt = new Date(addDays(new Date(addHours(end, hours)), days));
      return at.getTime() >= purgeAt.getTime();
    });
  }

  /** Removes the file, then clears its key; whether both happened. A failure is one `warn`. */
  async function remove(file: HeldChatFile): Promise<boolean> {
    try {
      await storage.remove(file.storageKey);
      return await transactions.run((tx) => store.clearKey(tx, file));
    } catch {
      log.warn({ messageId: file.messageId }, 'Chat file removal failed');
      return false;
    }
  }

  /** Removes the files one after another, as `erase-deleted-files` does; how many were removed. */
  async function removeAll(files: readonly HeldChatFile[]): Promise<number> {
    let removed = 0;
    for (const file of files) {
      if (await remove(file)) removed += 1;
    }
    return removed;
  }

  async function purgeIfDue(enrollmentId: string): Promise<ChatPurged | null> {
    const purged = await transactions.run(async (tx) => {
      await store.lockEnrollment(tx, enrollmentId);
      const at = await clock(tx);
      const [due] = await dueAmong(tx, [enrollmentId], at);
      return due === undefined ? null : store.purgeMessagesOf(tx, enrollmentId, at);
    });
    // Nothing left to purge (a run before this one did it): not purged now, so no line.
    if (purged === null || purged.messages === 0) return null;
    const files = await removeAll(purged.files);
    log.info({ enrollmentId, messages: purged.messages, files }, 'Chat purged');
    return { messages: purged.messages, files };
  }

  /** The purged rows still holding a key, tried again, one line per enrollment that lost files. */
  async function retryHeldFiles(): Promise<void> {
    let after: HeldChatFile | undefined;
    let enrollmentId: string | undefined;
    let files = 0;
    const flush = () => {
      if (enrollmentId !== undefined && files > 0) {
        log.info({ enrollmentId, messages: 0, files }, 'Chat purged');
      }
    };
    for (;;) {
      const page = await transactions.run((tx) => store.heldFilesAfter(tx, after, pageSize));
      for (const file of page) {
        if (file.enrollmentId !== enrollmentId) {
          flush();
          enrollmentId = file.enrollmentId;
          files = 0;
        }
        if (await remove(file)) files += 1;
      }
      if (page.length < pageSize) break;
      after = page.at(-1);
    }
    flush();
  }

  async function purgeDue(): Promise<void> {
    let after: string | undefined;
    for (;;) {
      const page = await transactions.run((tx) =>
        store.unpurgedEnrollmentsAfter(tx, after, pageSize),
      );
      const candidates = await transactions.run(async (tx) => dueAmong(tx, page, await clock(tx)));
      for (const enrollmentId of candidates) {
        try {
          await purgeIfDue(enrollmentId);
        } catch (error: unknown) {
          log.error({ enrollmentId }, 'Chat purge failed');
          report(failedWith(error));
        }
      }
      if (page.length < pageSize) return;
      after = page.at(-1);
    }
  }

  return {
    run: async () => {
      await retryHeldFiles();
      await purgeDue();
    },
    purgeIfDue,
  };
}
