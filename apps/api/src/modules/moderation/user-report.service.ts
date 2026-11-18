// T011 of specs/005-certification: reports (FR-611, FR-612, FR-613; research R-408; R-GENDER-2;
// contracts/app-surface.md, `reports.create`; contracts/admin-surface.md, `reports.*`; the note
// under T011, Q-R2 (a) as amended, Q-R3 (a), Q-R4 (a), Q-R5 (a), Q-R6 (a), Q-R8 (a)). The specs are
// user-report.service.spec.ts's and tests/db-integrity/{user-reports,user-report-race}.spec.ts's.
//
// REPORTS.CREATE (a signed-in user; keyed `reports.create` in its own transaction, `run`; its limit,
// `rate_limit_user_report`, the procedure's, applied by the kind before this service).
// - Where it comes from. A session report: the caller a party of the session and the reported user
//   its counterpart, both through `Pairings.partyOfSession`, which also answers the enrollment. A
//   chat report: the same of the enrollment, through `Pairings.partyOfEnrollment`. A profile report:
//   a student's, of a teacher identity's `visibleTeachers` answers to the student's own gender
//   (Q-R4 (a)); a teacher reports a student from a session or a chat, never a profile. The parties
//   are compared, never their genders (Q-R5 (a)): a real counterpart stays reportable after a
//   correction, and a non-party of the other gender is refused as a non-party (#143 r3).
// - Anything the caller may not report answers one NOT_FOUND, the shape a session that does not
//   exist answers (R-GENDER-2; `procedures.ts`'s participant kind). `self` (the reported user is the
//   caller) and `open_exists` (one open report per reporter, reported user and context, the
//   database's `user_reports_one_open_key`, Q-R6 (a)) are CONFLICT. The refused insert aborts the
//   transaction, which is rolled back with the key's claim before the refusal is thrown.
// - Every session and chat report stores its enrollment, set by the server from the port's answer,
//   never the input's (R-408). The reason is stored as free text (Q-R8 (a)).
// - LOCKS (kernel.md, «a report raised»; Q-R2 (a) as amended by the review). The parties are read
//   first with no lock: they never change. Then the two accounts by key share in one call
//   (`keyShareRows`, id order), then a session or chat report's enrollment (`lockCasesOf`, FOR
//   UPDATE), then the insert. Why: the insert's foreign keys key-share both accounts, the enrollment
//   and the session, and a path that holds an account FOR UPDATE and then locks the enrollment
//   (`chat.send`, kernel.md) deadlocks with an insert that holds the enrollment first (the
//   foreign-key deadlock class, kernel.md's `keyShareRows` row, H1). There is no purge gap: the
//   insert's key share on the enrollment orders it against the chat purge's FOR UPDATE.
// - The answer is `{ received: true }` and nothing else (spec.md:305).
//
// THE ADMINISTRATOR'S (on the administrator kind's transaction, which audits the call).
// `list`: the queue by status (the contract's default `open`) under `admin_list_page_size`, a report
// id as the cursor. `get`: one report, its reason, and its resolution once there is one. `resolve`
// (keyed `reports.resolve` on the kind's transaction, `runOn`): one conditional update `WHERE status
// = 'open'` writing the outcome, the note (`resolution_notes`), the database's instant and the
// administrator together (rule 59), so a report already resolved is refused `already_resolved` and
// left as it is; NOT_FOUND for an unknown report.
//
// THE LOG. Each refusal writes one info line of ids and its reason, marked «logged» so the handler's
// one-place refusal log writes no second line; a report received one line of ids after its commit.
// Never the reporter's reason or the administrator's note, never a name or a gender (R-SEC-2).
import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { keyShareRows } from '../../platform/db/row-lock.js';
import {
  DomainError,
  type ErrorCode,
  type FieldIssue,
} from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { z } from 'zod';

import { visibleTeachers } from '../identity/index.js';
import { lockCasesOf } from './compensation-case.repository.js';
import type { PairingParty, Pairings } from './pairings.port.js';
import {
  insertUserReport,
  type NewUserReport,
  resolveUserReport,
  type UserReportContext,
  type UserReportOutcome,
  type UserReportPageQuery,
  type UserReportResolution,
  type UserReportRow,
  type UserReportStatus,
  userReportOf,
  userReportsPage,
} from './user-report.repository.js';

/** What the reports lock, read and write, each on the call's transaction; faked in a spec. */
export interface UserReportStore {
  /** Whether identity's visibility predicate answers the teacher to the requester (`discover`). */
  visibleTeacher(
    tx: Transaction,
    requester: RequesterGender,
    teacherUserId: string,
  ): Promise<boolean>;
  /** The accounts, `FOR KEY SHARE`, id order, one call (kernel.md, `keyShareRows`). */
  keyShareAccounts(tx: Transaction, userIds: readonly string[]): Promise<void>;
  /** The enrollment's row, `FOR UPDATE` (`lockCasesOf`). */
  lockEnrollment(tx: Transaction, enrollmentId: string): Promise<void>;
  insert(tx: Transaction, row: NewUserReport): Promise<string | null>;
  reportOf(tx: Transaction, reportId: string): Promise<UserReportRow | null>;
  page(tx: Transaction, query: UserReportPageQuery): Promise<UserReportRow[]>;
  resolve(tx: Transaction, resolution: UserReportResolution): Promise<boolean>;
}

/** The store over this module's repository, the kernel's key share and identity's entry. */
export const userReportStore: UserReportStore = {
  visibleTeacher: async (tx, requester, teacherUserId) =>
    (await visibleTeachers(tx, requester, { purpose: 'discover', teacherIds: [teacherUserId] }))
      .length === 1,
  keyShareAccounts: (tx, userIds) => keyShareRows(tx, 'users', userIds),
  lockEnrollment: lockCasesOf,
  insert: insertUserReport,
  reportOf: userReportOf,
  page: userReportsPage,
  resolve: resolveUserReport,
};

/** Who reports: the session's account, role and gender, never the input's (R-GENDER-4). */
export interface ReportCaller {
  readonly userId: string;
  readonly role: 'student' | 'teacher';
  readonly gender: RequesterGender;
}

/** `reports.create`'s input, as the contract parses it (contracts/app-surface.md). */
export interface ReportAsked {
  readonly reportedUserId: string;
  readonly context: UserReportContext;
  readonly sessionId?: string | undefined;
  readonly enrollmentId?: string | undefined;
  readonly reason: string;
  readonly idempotencyKey: string;
}

/** The lines the service writes: ids and a reason. */
export interface ReportsLog {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
}

/** A report as the queue lists it (`adminReportsListItem`). */
export interface ReportItem {
  readonly reportId: string;
  readonly context: UserReportContext;
  readonly status: UserReportStatus;
  readonly reporterUserId: string;
  readonly reportedUserId: string;
  readonly sessionId: string | null;
  readonly enrollmentId: string | null;
  readonly createdAt: string;
}

export interface ReportsPage {
  readonly items: readonly ReportItem[];
  readonly nextCursor?: string;
}

/** A report as `reports.get` answers it (`adminReportsGetOutput`). */
export interface ReportDetail extends ReportItem {
  readonly reason: string;
  readonly resolution: {
    readonly outcome: UserReportOutcome;
    readonly note: string | null;
    readonly resolvedAt: string;
    readonly resolvedByAdminId: string;
  } | null;
}

export interface UserReportsDependencies {
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run' | 'runOn'>;
  /** Sessions' and booking's parties, bound by `main.ts` (R-408). */
  readonly pairings: Pairings;
  readonly settings: SettingsReader;
  /** The database's clock on the transaction; `clockTimestamp` in production. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: UserReportStore;
}

export interface UserReports {
  /** `reports.create` (this file's head). */
  create(caller: ReportCaller, asked: ReportAsked, log: ReportsLog): Promise<{ received: true }>;
  /** `reports.list`, on the administrator kind's transaction. */
  list(
    tx: Transaction,
    adminId: string,
    query: { readonly status: UserReportStatus; readonly cursor?: string | undefined },
    log: ReportsLog,
  ): Promise<ReportsPage>;
  /** `reports.get`, on the administrator kind's transaction. */
  get(
    tx: Transaction,
    adminId: string,
    query: { readonly reportId: string },
    log: ReportsLog,
  ): Promise<ReportDetail>;
  /** `reports.resolve`, keyed on the administrator kind's transaction. */
  resolve(
    tx: Transaction,
    adminId: string,
    input: {
      readonly reportId: string;
      readonly outcome: UserReportOutcome;
      readonly note: string;
      readonly idempotencyKey: string;
    },
    log: ReportsLog,
  ): Promise<{ readonly replayed: boolean }>;
}

const CREATE_SCOPE = 'reports.create';
const RESOLVE_SCOPE = 'reports.resolve';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** Why a call was refused, as its one line names it. */
type RefusalReason =
  | 'self'
  | 'not_a_party'
  | 'not_the_counterpart'
  | 'not_a_student'
  | 'not_visible'
  | 'open_exists'
  | 'no_report'
  | 'already_resolved';

/** Logs the refusal with ids and its reason only, and answers the error to throw, marked logged. */
function refusal(
  log: ReportsLog,
  ids: Readonly<Record<string, string | undefined>>,
  errorCode: ErrorCode,
  reason: RefusalReason,
  details?: readonly FieldIssue[],
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A report call was refused');
  return markRefusalLogged(
    new DomainError(errorCode, undefined, details === undefined ? undefined : { details }),
  );
}

/** The one-open rule refused the insert; its transaction is rolled back before the refusal. */
class ReportAlreadyOpen extends Error {}

/** Where a report is filed: the session and the enrollment as the server read them. */
interface Place {
  readonly sessionId: string | null;
  readonly enrollmentId: string | null;
}

function itemOf(row: UserReportRow): ReportItem {
  return {
    reportId: row.id,
    context: row.context,
    status: row.status,
    reporterUserId: row.reporterUserId,
    reportedUserId: row.reportedUserId,
    sessionId: row.sessionId,
    enrollmentId: row.enrollmentId,
    createdAt: row.createdAt.toISOString(),
  };
}

function resolutionOf(row: UserReportRow): ReportDetail['resolution'] {
  if (row.status === 'open' || row.resolvedAt === null || row.resolvedByAdminId === null) {
    return null;
  }
  return {
    outcome: row.status,
    note: row.resolutionNotes,
    resolvedAt: row.resolvedAt.toISOString(),
    resolvedByAdminId: row.resolvedByAdminId,
  };
}

export function createUserReports({
  idempotency,
  pairings,
  settings,
  clock = clockTimestamp,
  store = userReportStore,
}: UserReportsDependencies): UserReports {
  /** The session or chat the caller is a party of, whose counterpart is the reported user. */
  async function counterpartPlace(
    tx: Transaction,
    caller: ReportCaller,
    asked: ReportAsked,
    log: ReportsLog,
    ids: Readonly<Record<string, string | undefined>>,
  ): Promise<Place> {
    const party: PairingParty | null =
      asked.context === 'session'
        ? await pairings.partyOfSession(tx, asked.sessionId ?? '', caller.userId)
        : await pairings.partyOfEnrollment(tx, asked.enrollmentId ?? '', caller.userId);
    if (party === null) throw refusal(log, ids, 'NOT_FOUND', 'not_a_party');
    if (party.counterpartUserId !== asked.reportedUserId) {
      throw refusal(log, ids, 'NOT_FOUND', 'not_the_counterpart');
    }
    return {
      sessionId: asked.context === 'session' ? (asked.sessionId ?? null) : null,
      enrollmentId: party.enrollmentId,
    };
  }

  /** A profile the caller can see: a student's, of a teacher the predicate answers (Q-R4 (a)). */
  async function visibleProfile(
    tx: Transaction,
    caller: ReportCaller,
    asked: ReportAsked,
    log: ReportsLog,
    ids: Readonly<Record<string, string | undefined>>,
  ): Promise<Place> {
    if (caller.role !== 'student') throw refusal(log, ids, 'NOT_FOUND', 'not_a_student');
    if (!(await store.visibleTeacher(tx, caller.gender, asked.reportedUserId))) {
      throw refusal(log, ids, 'NOT_FOUND', 'not_visible');
    }
    return { sessionId: null, enrollmentId: null };
  }

  return {
    create: async (caller, asked, log) => {
      const { reportedUserId, context, sessionId, enrollmentId, reason, idempotencyKey } = asked;
      const ids = { userId: caller.userId, reportedUserId, context, sessionId, enrollmentId };
      if (reportedUserId === caller.userId) {
        throw refusal(log, ids, 'CONFLICT', 'self', [{ path: 'reportedUserId', code: 'self' }]);
      }
      let received: { readonly reportId: string; readonly place: Place } | undefined;
      try {
        await idempotency.run(
          {
            scope: CREATE_SCOPE,
            key: idempotencyKey,
            actorId: caller.userId,
            input: {
              reportedUserId,
              context,
              ...(sessionId === undefined ? {} : { sessionId }),
              ...(enrollmentId === undefined ? {} : { enrollmentId }),
              reason,
            },
          },
          async (tx) => {
            const place =
              context === 'profile'
                ? await visibleProfile(tx, caller, asked, log, ids)
                : await counterpartPlace(tx, caller, asked, log, ids);
            await store.keyShareAccounts(tx, [caller.userId, reportedUserId]);
            if (place.enrollmentId !== null) await store.lockEnrollment(tx, place.enrollmentId);
            const reportId = await store.insert(tx, {
              reporterUserId: caller.userId,
              reportedUserId,
              context,
              sessionId: place.sessionId,
              enrollmentId: place.enrollmentId,
              reason,
            });
            if (reportId === null) throw new ReportAlreadyOpen();
            received = { reportId, place };
            return { received: true };
          },
        );
      } catch (error: unknown) {
        if (!(error instanceof ReportAlreadyOpen)) throw error;
        throw refusal(log, ids, 'CONFLICT', 'open_exists', [
          { path: 'reportedUserId', code: 'open_exists' },
        ]);
      }
      if (received !== undefined) {
        const { reportId, place } = received;
        log.info(
          {
            reportId,
            userId: caller.userId,
            reportedUserId,
            context,
            ...(place.sessionId === null ? {} : { sessionId: place.sessionId }),
            ...(place.enrollmentId === null ? {} : { enrollmentId: place.enrollmentId }),
          },
          'A report was received',
        );
      }
      return { received: true };
    },

    list: async (tx, _adminId, { status, cursor }) => {
      const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const read = await store.page(tx, { status, after: cursor, take: pageSize + 1 });
      const page = read.slice(0, pageSize);
      const last = page.at(-1);
      return {
        items: page.map(itemOf),
        ...(read.length > pageSize && last !== undefined ? { nextCursor: last.id } : {}),
      };
    },

    get: async (tx, adminId, { reportId }, log) => {
      const row = await store.reportOf(tx, reportId);
      if (row === null) throw refusal(log, { adminId, reportId }, 'NOT_FOUND', 'no_report');
      return { ...itemOf(row), reason: row.reason, resolution: resolutionOf(row) };
    },

    resolve: async (tx, adminId, { reportId, outcome, note, idempotencyKey }, log) => {
      const { replayed } = await idempotency.runOn<null>(
        tx,
        {
          scope: RESOLVE_SCOPE,
          key: idempotencyKey,
          actorId: adminId,
          input: { reportId, outcome, note },
        },
        async (on) => {
          const at = await clock(on);
          if (await store.resolve(on, { reportId, outcome, note, adminId, at })) return null;
          const ids = { adminId, reportId };
          if ((await store.reportOf(on, reportId)) === null) {
            throw refusal(log, ids, 'NOT_FOUND', 'no_report');
          }
          throw refusal(log, ids, 'CONFLICT', 'already_resolved', [
            { path: 'reportId', code: 'already_resolved' },
          ]);
        },
      );
      return { replayed };
    },
  };
}
