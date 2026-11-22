// R1a, `specs/002-identity/tasks.md` T176 (SRS §3.14, DEC-100, DEC-67, NFR-COMP-2, OPEN-05; the note
// under T176, Q-3 (a); specs/004-sessions/contracts/kernel.md, the document sweep's row and "Jobs"):
// what the daily `erase-identity-documents` runs, verification's. ⚠️ Automatic: an identity document
// on a live account is marked erased once `identity_document_retention_days` have passed since its
// decision, and the hourly `erase-deleted-files` then removes its file, after which there is no way
// back.
//
// WHAT COUNTS (the note under T176, (1)). An applicant's `teacher_profiles.identity_document_id`
// while the application is `rejected` or `banned` (Q-3 (a)), counted from `application_decided_at`
// (`in_review` and `needs_document` are no decision); a ban never before `ban_restore_window_days`
// has passed too, so its days are the later of the two. An identity request's
// `verification_requests.document_id` once `satisfied` or `replaced`, counted from `resolved_at`.
// Never a document of a teacher once approved (`approved_at` set, never cleared; DEC-67), never one
// an open matter holds (`held`, FR-AUTH-14's held files), never one already erased or kept.
//
// THE CANDIDATES. Each source a page at a time in its own id order, read with no lock: the
// applications through identity's entry, the requests from this module's table; each page's owners
// asked once through `held` (booking's `heldFileOwnersAmong`, bound in `worker.ts`, as
// `erase-deleted-files` is), a held owner's document left for a later run.
//
// THE LOCKS (kernel.md, the document sweep's row; `platform/db/row-lock.ts`'s one order). Each
// document on its own transaction: the account (`lockAccount`), the application (`lockApplication`,
// a no-op for a person with no profile), then the document (`lockRows('verification_documents', …)`);
// everything read again under them (rule 1), and the mark one conditional update `WHERE erased_at
// IS NULL AND kept_at IS NULL` (T077's precedent), its key kept for the file's removal.
//
// THE LOG (the owner's rule). One info line `{ documentId, userId, reason }` per document marked,
// after its commit; each document's failure caught on its own, rolled back, logged by its ids at
// error and reported, and the run goes on; the next run tries it again.
// IDEMPOTENT (R-API-14): a second run finds the document erased under its lock and marks nothing.
import { addDays } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { reportError } from '../../platform/errors/reporting.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type ApplicationStatus,
  everApprovedTeacher,
  lockAccount,
  lockApplication,
  readApplicant,
  readApplication,
} from '../identity/index.js';
import { BAN_RESTORE_WINDOW_SETTING, windowDaysOf } from '../sessions/index.js';
import {
  documentMarksOf,
  lockDocument,
  markIdentityDocumentErased,
  requestDocumentsDue,
  requestHoldingDocument,
} from './verification.repository.js';

/** SRS §3.14 «Identity document retention on a live account after its decision…» (DEC-100). */
export const IDENTITY_DOCUMENT_RETENTION_SETTING = 'identity_document_retention_days';

/** The retention's schema: whole days, at least one (the registry's `positiveWhole`). */
export const identityDocumentRetentionDays = z.int().positive();

/** Why a document was marked: its source and the decision that started its days. */
export type RetentionReason =
  'application_rejected' | 'application_banned' | 'request_satisfied' | 'request_replaced';

/** A document a page lists, read with no lock: its owner and the source row's id it is paged by. */
export interface RetentionCandidate {
  readonly cursor: string;
  readonly userId: string;
  readonly documentId: string;
}

/** The latest decision instants a page admits, at or before each. */
export interface RetentionCutoffs {
  /** A rejection, a satisfied or a replaced request: now less the retention. */
  readonly decidedBefore: Date;
  /** A ban: now less the later of the retention and the restore window (Q-3 (a)). */
  readonly bannedBefore: Date;
}

/** The application as read again under the locks (identity's entry). */
export interface RetainedApplication {
  readonly status: ApplicationStatus | null;
  readonly decidedAt: Date | null;
  readonly identityDocumentId: string | null;
}

/** The identity request holding a document, as read again under the locks. */
export interface RetainedRequest {
  readonly userId: string;
  readonly status: 'open' | 'satisfied' | 'expired' | 'replaced';
  readonly resolvedAt: Date | null;
}

/** The document as read again under its lock. */
export interface RetainedDocument {
  readonly userId: string;
  readonly erasedAt: Date | null;
  readonly keptAt: Date | null;
}

/** What the sweep reads, locks and writes, each on the caller's transaction; faked in a spec. */
export interface IdentityRetentionStore {
  /** Identity's applicants due by `cutoffs`, never approved, in profile id order after `after`. */
  applicationsDue(
    tx: Transaction,
    cutoffs: RetentionCutoffs,
    after: string | undefined,
    limit: number,
  ): Promise<readonly RetentionCandidate[]>;
  /** This module's satisfied or replaced requests closed by `decidedBefore`, in request id order. */
  requestsDue(
    tx: Transaction,
    decidedBefore: Date,
    after: string | undefined,
    limit: number,
  ): Promise<readonly RetentionCandidate[]>;
  lockAccount(tx: Transaction, userId: string): Promise<void>;
  lockApplication(tx: Transaction, userId: string): Promise<void>;
  lockDocument(tx: Transaction, documentId: string): Promise<void>;
  everApproved(tx: Transaction, userId: string): Promise<boolean>;
  applicationOf(tx: Transaction, userId: string): Promise<RetainedApplication | null>;
  requestHolding(tx: Transaction, documentId: string): Promise<RetainedRequest | null>;
  documentOf(tx: Transaction, documentId: string): Promise<RetainedDocument | null>;
  /** `erased_at` set where the row is neither erased nor kept, its key kept; whether it did. */
  markErased(tx: Transaction, documentId: string, at: Date): Promise<boolean>;
}

/** What a run did, by document id. */
export interface IdentityRetentionRun {
  /** The documents this run marked erased. */
  readonly erased: readonly string[];
  /** The documents whose marking failed, left for the next run. */
  readonly failed: readonly string[];
}

export interface IdentityRetentionSweep {
  /** One run of the sweep (this file's head). */
  run(): Promise<IdentityRetentionRun>;
}

export interface IdentityRetentionDependencies {
  readonly transactions: Transactions;
  /** The retention and the ban's restore window, read on every run (FR-034). */
  readonly settings: Pick<SettingsReader, 'read'>;
  /** Of some owners, those an open matter holds (booking's `heldFileOwnersAmong`). */
  readonly held: (userIds: readonly string[]) => Promise<ReadonlySet<string>>;
  /** The sweep's lines: one info per document marked, one error per document failed. */
  readonly log: Pick<Logger, 'info' | 'error'>;
  /** How many candidates each page reads (the job's). */
  readonly pageSize: number;
  /** Error tracking; `reportError` unless a spec sets one. */
  readonly report?: (error: Error) => void;
  /** The database's clock on the transaction (`clockTimestamp`). */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store: IdentityRetentionStore;
}

/** The days a decision waits: the retention, and for a ban the later of it and the window. */
interface RetentionDays {
  readonly retention: number;
  readonly banned: number;
}

/** Whether a decision made at `decidedAt`, waiting `days`, is due at `now`. */
function isDue(decidedAt: Date | null, days: number, now: Date): boolean {
  return decidedAt !== null && new Date(addDays(decidedAt, days)).getTime() <= now.getTime();
}

/** The reason an application's document is due under the locks, or null. */
function applicationReason(
  application: RetainedApplication | null,
  documentId: string,
  days: RetentionDays,
  now: Date,
): RetentionReason | null {
  if (application === null || application.identityDocumentId !== documentId) return null;
  if (application.status === 'rejected') {
    return isDue(application.decidedAt, days.retention, now) ? 'application_rejected' : null;
  }
  if (application.status === 'banned') {
    return isDue(application.decidedAt, days.banned, now) ? 'application_banned' : null;
  }
  return null;
}

/** The reason a request's document is due under the locks, or null. */
function requestReason(
  request: RetainedRequest | null,
  userId: string,
  days: RetentionDays,
  now: Date,
): RetentionReason | null {
  if (request === null || request.userId !== userId) return null;
  if (!isDue(request.resolvedAt, days.retention, now)) return null;
  if (request.status === 'satisfied') return 'request_satisfied';
  if (request.status === 'replaced') return 'request_replaced';
  return null;
}

type Source = 'application' | 'request';

const SOURCES: readonly Source[] = ['application', 'request'];

export function createIdentityRetentionSweep({
  transactions,
  settings,
  held,
  log,
  pageSize,
  report = reportError,
  clock = clockTimestamp,
  store,
}: IdentityRetentionDependencies): IdentityRetentionSweep {
  const failedWith = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

  const daysOf = async (): Promise<RetentionDays> => {
    const [retention, window] = await Promise.all([
      settings.read(IDENTITY_DOCUMENT_RETENTION_SETTING, identityDocumentRetentionDays),
      windowDaysOf(settings)(BAN_RESTORE_WINDOW_SETTING),
    ]);
    return { retention, banned: Math.max(retention, window) };
  };

  const pageOf = (
    tx: Transaction,
    source: Source,
    cutoffs: RetentionCutoffs,
    after: string | undefined,
  ) =>
    source === 'application'
      ? store.applicationsDue(tx, cutoffs, after, pageSize)
      : store.requestsDue(tx, cutoffs.decidedBefore, after, pageSize);

  /** One document under its locks, read and judged again; the reason it was marked, or null. */
  const markOne = async (
    tx: Transaction,
    source: Source,
    { userId, documentId }: RetentionCandidate,
    days: RetentionDays,
  ): Promise<RetentionReason | null> => {
    await store.lockAccount(tx, userId);
    await store.lockApplication(tx, userId);
    await store.lockDocument(tx, documentId);
    const now = await clock(tx);
    if (await store.everApproved(tx, userId)) return null;
    const document = await store.documentOf(tx, documentId);
    if (document?.userId !== userId || document.erasedAt !== null || document.keptAt !== null) {
      return null;
    }
    const reason =
      source === 'application'
        ? applicationReason(await store.applicationOf(tx, userId), documentId, days, now)
        : requestReason(await store.requestHolding(tx, documentId), userId, days, now);
    if (reason === null) return null;
    return (await store.markErased(tx, documentId, now)) ? reason : null;
  };

  return {
    run: async () => {
      const erased: string[] = [];
      const failed: string[] = [];
      const days = await daysOf();
      const now = await transactions.run((tx) => clock(tx));
      const cutoffs: RetentionCutoffs = {
        decidedBefore: new Date(addDays(now, -days.retention)),
        bannedBefore: new Date(addDays(now, -days.banned)),
      };
      for (const source of SOURCES) {
        let after: string | undefined;
        for (;;) {
          const page = await transactions.run((tx) => pageOf(tx, source, cutoffs, after));
          const holding =
            page.length === 0
              ? new Set<string>()
              : await held([...new Set(page.map(({ userId }) => userId))]);
          for (const candidate of page) {
            if (holding.has(candidate.userId)) continue;
            const { documentId, userId } = candidate;
            try {
              const reason = await transactions.run((tx) => markOne(tx, source, candidate, days));
              if (reason === null) continue;
              erased.push(documentId);
              log.info(
                { documentId, userId, reason },
                'An identity document was erased after its retention',
              );
            } catch (error: unknown) {
              failed.push(documentId);
              log.error({ documentId, userId }, 'An identity document’s erasure failed');
              report(failedWith(error));
            }
          }
          if (page.length < pageSize) break;
          after = page.at(-1)?.cursor;
        }
      }
      return { erased, failed };
    },
  };
}

/**
 * The store over identity's entry and this module's rows (R-API-6; R-121: verification imports
 * identity, never the reverse). `applicationsDue` is identity's page of the applicants due, handed in.
 */
export function identityRetentionStoreOver(
  applicationsDue: IdentityRetentionStore['applicationsDue'],
): IdentityRetentionStore {
  return {
    applicationsDue,
    requestsDue: requestDocumentsDue,
    lockAccount,
    lockApplication,
    lockDocument,
    everApproved: everApprovedTeacher,
    applicationOf: async (tx, userId) => {
      const application = await readApplication(tx, userId);
      if (application === null) return null;
      const applicant = await readApplicant(tx, userId);
      return {
        status: application.status,
        decidedAt: application.decidedAt,
        identityDocumentId: applicant?.identityDocumentId ?? null,
      };
    },
    requestHolding: requestHoldingDocument,
    documentOf: documentMarksOf,
    markErased: markIdentityDocumentErased,
  };
}
