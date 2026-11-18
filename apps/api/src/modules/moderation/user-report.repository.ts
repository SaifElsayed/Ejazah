// T011 of specs/005-certification (FR-611, FR-612; research R-408; data-model.md:65; ERD §15 rule
// 59; the note under T011, Q-R3 (a), Q-R6 (a)): the `user_reports` rows, each on the caller's
// transaction. Queries only; the rules (who may report whom, from where) are
// `user-report.service.ts`'s, and the one-open rule is the database's (`user_reports_one_open_key`,
// per reporter, reported user and context).
//
// No lock here: `reports.create` takes the two accounts by key share and then the enrollment
// (kernel.md, the row «a report raised») before the insert, whose foreign keys reference them. The
// resolution is one conditional update `WHERE status = 'open'`, so two resolutions at once write
// once: the second waits on the first's row lock, then reads the row again and matches nothing.
// The reads take none. Over the queue's `(status, created_at)` and the primary key; the page is
// bounded by `take`.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { isUniqueViolation } from '../../platform/db/db-errors.js';

type Client = Pick<Transaction, 'userReport'>;

/** Where a report comes from (`user_report_context`, ERD §10). */
export type UserReportContext = 'session' | 'chat' | 'profile';
/** A report's state (`user_report_status`, ERD §10). */
export type UserReportStatus = 'open' | 'actioned' | 'dismissed';
/** How an administrator closes a report (FR-612). */
export type UserReportOutcome = Exclude<UserReportStatus, 'open'>;

/** A report as it is inserted: the session and the enrollment as the server read them (R-408). */
export interface NewUserReport {
  readonly reporterUserId: string;
  readonly reportedUserId: string;
  readonly context: UserReportContext;
  readonly sessionId: string | null;
  readonly enrollmentId: string | null;
  readonly reason: string;
}

/** A report as the administrator reads it (ERD §10). */
export interface UserReportRow {
  readonly id: string;
  readonly context: UserReportContext;
  readonly status: UserReportStatus;
  readonly reporterUserId: string;
  readonly reportedUserId: string;
  readonly sessionId: string | null;
  readonly enrollmentId: string | null;
  readonly reason: string;
  readonly createdAt: Date;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: Date | null;
  readonly resolvedByAdminId: string | null;
}

/** One page of the queue: a status, after a report id, at most `take`. */
export interface UserReportPageQuery {
  readonly status: UserReportStatus;
  readonly after?: string | undefined;
  readonly take: number;
}

/** An administrator's closing of an open report (FR-612). */
export interface UserReportResolution {
  readonly reportId: string;
  readonly outcome: UserReportOutcome;
  readonly note: string;
  readonly adminId: string;
  readonly at: Date;
}

/**
 * Inserts an open report; its id, or null when the database refuses it because the reporter already
 * has one open on that person in that context. Any other refusal is thrown as it is. A null leaves
 * the transaction aborted: the caller refuses and rolls it back.
 */
export async function insertUserReport(tx: Client, row: NewUserReport): Promise<string | null> {
  try {
    const { id } = await tx.userReport.create({
      data: { ...row, status: 'open' },
      select: { id: true },
    });
    return id;
  } catch (error: unknown) {
    if (isUniqueViolation(error, 'user_reports_one_open_key')) return null;
    throw error;
  }
}

/** One report by its id, or null; no lock. */
export function userReportOf(tx: Client, reportId: string): Promise<UserReportRow | null> {
  return tx.userReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      context: true,
      status: true,
      reporterUserId: true,
      reportedUserId: true,
      sessionId: true,
      enrollmentId: true,
      reason: true,
      createdAt: true,
      resolutionNotes: true,
      resolvedAt: true,
      resolvedByAdminId: true,
    },
  });
}

/** The queue's page: the open reports oldest first, the closed ones newest first, after `after`. */
export function userReportsPage(tx: Client, query: UserReportPageQuery): Promise<UserReportRow[]> {
  const open = query.status === 'open';
  return tx.userReport.findMany({
    where: {
      status: query.status,
      ...(query.after === undefined
        ? {}
        : { id: open ? { gt: query.after } : { lt: query.after } }),
    },
    orderBy: { id: open ? 'asc' : 'desc' },
    take: query.take,
    select: {
      id: true,
      context: true,
      status: true,
      reporterUserId: true,
      reportedUserId: true,
      sessionId: true,
      enrollmentId: true,
      reason: true,
      createdAt: true,
      resolutionNotes: true,
      resolvedAt: true,
      resolvedByAdminId: true,
    },
  });
}

/**
 * Closes the report if it is still open, writing the outcome, the note, the instant and the
 * administrator together (rule 59); answers whether it did. A report no longer open, or none, is
 * left as it is.
 */
export async function resolveUserReport(
  tx: Client,
  { reportId, outcome, note, adminId, at }: UserReportResolution,
): Promise<boolean> {
  const { count } = await tx.userReport.updateMany({
    where: { id: reportId, status: 'open' },
    data: { status: outcome, resolutionNotes: note, resolvedAt: at, resolvedByAdminId: adminId },
  });
  return count === 1;
}
