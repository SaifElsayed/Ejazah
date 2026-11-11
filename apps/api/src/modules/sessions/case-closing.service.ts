// T035 of specs/004-sessions/tasks.md (FR-422, FR-478, FR-480; R-MONEY-6; research R-312, R-322;
// contracts/admin-surface.md, `cases.resolve` and `cases.dismiss`; the notes under T035): an
// administrator's closing of a compensation case, on the administrator call's transaction, through
// moderation's `closeCase` (the enrollment's row lock first, then one conditional update writing the
// closing and `resolved_at` by the database's clock). `cases.resolve` closes it `resolved` with
// `compensation_ordered`, the note saying what Platform Administration did outside the platform;
// `cases.dismiss` closes it `dismissed` with no resolution. Nothing here computes or moves an
// amount (FR-DISPUTE-6, R-MONEY-6). The audit entry, with the note, is the router's.
//
// WHAT IS REFUSED, each writing nothing. NOT_FOUND for no such case, a session dispute
// (`disputes.*`'), and a complaint of a teacher's absence, which `cases.decideComplaint` alone
// decides (R-322). CONFLICT with `details.cause` `not_open` for a case no longer open: the
// conditional update changed no row (the note under T035, Q2).
//
// NO COMPLETION CHECK (the note under T035, F9). Closing a case that holds an enrollment's
// completion (`student_suspended`, `admin_cancellation`) releases the hold, and `advance-remedies`'
// completion step completes the enrollment on its next run, within a minute.
//
// THE LOG (the owner's rule). A refusal writes one info line of ids and a reason code, through this
// file's one `refusal`, marked «logged»; the closing itself is the audit entry's.
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode, type FieldIssue } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import { type CaseClosing, closeCase, type CaseRecord, caseRecordOf } from '../moderation/index.js';

/** What the closing reads and writes, each through moderation's entry; faked in a spec. */
export interface CaseClosingStore {
  caseRecordOf(tx: Transaction, caseId: string): Promise<CaseRecord | null>;
  /** The enrollment's lock, then the conditional update; the closing instant, null if not open. */
  closeCase(tx: Transaction, caseId: string, closing: CaseClosing): Promise<Date | null>;
}

/** The store over moderation's entry (R-API-6). */
export const caseClosingStore: CaseClosingStore = { caseRecordOf, closeCase };

export interface CaseClosingInput {
  readonly caseId: string;
  /** The administrator's mandatory note, written to `resolution_notes` and the audit entry. */
  readonly note: string;
}

export interface CaseClosingService {
  /** `cases.resolve` (this file's head). */
  resolve(
    tx: Transaction,
    adminId: string,
    input: CaseClosingInput,
  ): Promise<{ readonly caseId: string; readonly status: 'resolved' }>;
  /** `cases.dismiss` (this file's head). */
  dismiss(
    tx: Transaction,
    adminId: string,
    input: CaseClosingInput,
  ): Promise<{ readonly caseId: string; readonly status: 'dismissed' }>;
}

/** Why a closing was refused, as its one log line names it. */
type RefusalReason = 'not_found' | 'complaint' | 'not_open';

/** The ids a refusal's line names. */
interface RefusalIds {
  readonly adminId: string;
  readonly caseId: string;
  readonly enrollmentId?: string;
}

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged»
 * so `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: RefusalIds,
  errorCode: ErrorCode,
  reason: RefusalReason,
  details?: readonly FieldIssue[],
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A case closing was refused');
  return markRefusalLogged(
    new DomainError(errorCode, undefined, details === undefined ? undefined : { details }),
  );
}

export function createCaseClosing({
  log,
  store = caseClosingStore,
}: {
  readonly log: Pick<Logger, 'info'>;
  readonly store?: CaseClosingStore;
}): CaseClosingService {
  /** The compensation case, or the refusal of anything else (this file's head). */
  const compensationCase = async (
    tx: Transaction,
    adminId: string,
    caseId: string,
  ): Promise<CaseRecord> => {
    const found = await store.caseRecordOf(tx, caseId);
    if (found === null || found.kind === 'session_dispute') {
      throw refusal(log, { adminId, caseId }, 'NOT_FOUND', 'not_found');
    }
    if (found.kind === 'absence_complaint') {
      throw refusal(log, { adminId, caseId }, 'NOT_FOUND', 'complaint');
    }
    return found;
  };

  /** Closes the case as `closing` says, or refuses a case no longer open. */
  const close = async (tx: Transaction, found: CaseRecord, closing: CaseClosing) => {
    if ((await store.closeCase(tx, found.caseId, closing)) === null) {
      throw refusal(
        log,
        { adminId: closing.adminId, caseId: found.caseId, enrollmentId: found.enrollmentId },
        'CONFLICT',
        'not_open',
        [{ path: 'cause', code: 'not_open' }],
      );
    }
  };

  return {
    resolve: async (tx, adminId, { caseId, note }) => {
      const found = await compensationCase(tx, adminId, caseId);
      await close(tx, found, {
        status: 'resolved',
        resolution: 'compensation_ordered',
        note,
        adminId,
      });
      return { caseId, status: 'resolved' };
    },

    dismiss: async (tx, adminId, { caseId, note }) => {
      const found = await compensationCase(tx, adminId, caseId);
      await close(tx, found, { status: 'dismissed', resolution: null, note, adminId });
      return { caseId, status: 'dismissed' };
    },
  };
}
