// 005:T034 (R1a; SRS FR-SESS-13 as amended, DEC-100; contracts/admin-surface.md, `reports.chat`; the
// note under T034): an administrator reads an enrollment's chat under an open report, read-only, on
// the administrator call's transaction. The audit entry is the router's (`chat.read` on the
// enrollment, as `disputes.chat` records it).
//
// THE REPORT. Read through this module's `userReportOf`, admitted only while its `status` is `open`:
// none is `NOT_FOUND`, one no longer open `CONFLICT` with `details.cause` `not_open`, as
// `disputes.chat` refuses a matter (`sessions/dispute-matter.service.ts`). A profile report names no
// enrollment (ERD §15 rule 56) and is `NOT_FOUND`; so is an `enrollmentId` other than the report's,
// so the panel never reads a chat the report does not name. Nothing is locked: a read that meets a
// report closing at the same moment answers as it was, as the dispute's read does.
//
// THE CHAT. The `ReportChat` port, bound by `main.ts` to chat's `createDisputeChat()` (moderation
// imports no chat), asked with the report's enrollment, never the input's: the page as `chat.list`
// answers it, each sender named by its role (R-314). An enrollment the port no longer answers (soft
// deleted) is `NOT_FOUND`.
//
// THE LOG (the owner's rule). A refusal writes one info line of ids and its reason, marked «logged»;
// never the reporter's words. A read writes none.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { ReportChat, ReportChatPage } from './report-chat.port.js';
import { userReportOf, type UserReportRow } from './user-report.repository.js';
import type { ReportsLog } from './user-report.service.js';

/** What the read asks of this module's repository, with no lock; faked in a spec. */
export interface ReportChatStore {
  reportOf(tx: Transaction, reportId: string): Promise<UserReportRow | null>;
}

export const reportChatStore: ReportChatStore = { reportOf: userReportOf };

/** `reports.chat`'s input, as the contract parses it. */
export interface ReportChatAsked {
  readonly reportId: string;
  readonly enrollmentId: string;
  readonly cursor?: string | undefined;
}

export interface ReportChatReads {
  /** A page of the open report's enrollment chat, and the enrollment the audit names. */
  chat(
    tx: Transaction,
    adminId: string,
    asked: ReportChatAsked,
    log: ReportsLog,
  ): Promise<{ readonly enrollmentId: string; readonly page: ReportChatPage }>;
}

export interface ReportChatDependencies {
  /** The port `main.ts` binds to chat's `createDisputeChat()`. */
  readonly chat: ReportChat;
  readonly store?: ReportChatStore;
}

type RefusalReason = 'no_report' | 'not_open' | 'no_enrollment' | 'other_enrollment';

/** Logs the refusal with ids and its reason only, and answers the error to throw, marked logged. */
function refusal(
  log: ReportsLog,
  asked: ReportChatAsked,
  adminId: string,
  reason: RefusalReason,
): DomainError {
  const errorCode = reason === 'not_open' ? 'CONFLICT' : 'NOT_FOUND';
  const { reportId, enrollmentId } = asked;
  log.info(
    { adminId, reportId, enrollmentId, errorCode, reason },
    'A report chat read was refused',
  );
  return markRefusalLogged(
    errorCode === 'CONFLICT'
      ? new DomainError(errorCode, undefined, { details: [{ path: 'cause', code: reason }] })
      : new DomainError(errorCode),
  );
}

export function createReportChat({
  chat,
  store = reportChatStore,
}: ReportChatDependencies): ReportChatReads {
  return {
    chat: async (tx, adminId, asked, log) => {
      const report = await store.reportOf(tx, asked.reportId);
      if (report === null) throw refusal(log, asked, adminId, 'no_report');
      if (report.status !== 'open') throw refusal(log, asked, adminId, 'not_open');
      const { enrollmentId } = report;
      if (enrollmentId === null) throw refusal(log, asked, adminId, 'no_enrollment');
      if (enrollmentId !== asked.enrollmentId) {
        throw refusal(log, asked, adminId, 'other_enrollment');
      }
      const page = await chat.chatPage(tx, enrollmentId, asked.cursor);
      if (page === null) throw refusal(log, asked, adminId, 'no_enrollment');
      return { enrollmentId, page };
    },
  };
}
