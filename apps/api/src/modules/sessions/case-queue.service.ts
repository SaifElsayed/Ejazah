// T035 of specs/004-sessions/tasks.md (FR-478, FR-480, FR-451, FR-452; R-MONEY-6, R-API-6; research
// R-312, R-313; contracts/admin-surface.md, `cases.list` and `cases.get`): the compensation-case
// queue's two reads on the administrator call's transaction. Nothing here writes or locks; the
// audit entries are the router's. No amount is read or answered (FR-467): the orders are
// `/payments`', linked by the enrollment's id.
//
// THE LIST. Moderation's queue page (`caseQueuePage`): every compensation case, Phase 2's reasons
// included, and every complaint of a teacher's absence, the open `student_suspended` cases first,
// then the rest by their opening (the owner's decision of 2026-11-05 on the analysis), pages of
// `admin_list_page_size`. The cursor is the last row's part and id, `first:<id>` or `rest:<id>`.
// Each row carries its enrollment's Teacher-No-Show count (T015) and its mark at
// `repeated_absence_flag_count` (FR-451: nothing follows from it). A complaint's text is the
// detail's only, so a row of one has no `reason`.
//
// THE DETAIL. The case (a session dispute is `disputes.get`'s, so NOT_FOUND here), its enrollment
// and its parties through `EnrollmentSide` (sessions reads no booking table, R-301), and what it
// covers (R-312, R-313), each session once, by sequence number:
//   - the sessions whose remedy the case holds (`session_remedies.case_id`);
//   - the sessions whose `cancelled_by_admin` event names it (`session_events.case_id`, C4), but
//     for a `dismissed` `student_suspended` case only its ordinary ones, owed nothing: the make-ups
//     it cancelled are owed under the fault case (T036; the owner's decision of 2026-11-11 on lane
//     B's questions, item 2, (c));
//   - for the case an enrollment's end opened (`absence_termination`, `teacher_ended`,
//     `student_banned`, `student_fault_confirmed`): every session of the enrollment owed a remedy
//     never offered (`teacher_no_show`, `both_no_show`, `cancelled_by_agreement` with no remedy row;
//     C1, I1), and the sessions cancelled by each `student_suspended` case whose
//     `covered_by_case_id` names this case (ERD §15 rule 49; the note under T036, the owner's
//     decision (c) on PR #133's Major 1): one resolved, cleared on an enrollment already ended, every
//     session (U2); one dismissed, its fault confirmed into this case opened or joined, only the
//     make-ups (U1). T036 writes the link with the closing, so no instant is compared: the database
//     writes `resolved_at` and the application `created_at`.
// A complaint answers its text, its raising and its decision, read from its closing (T060 writes
// it): `resolved` with `enrollment_ended` is `end_enrollment`, with `party_suspended`
// `suspend_teacher`; `dismissed` is `close`.
//
// THE LOG (the owner's rule). A case no read returns is refused NOT_FOUND through this file's one
// `refusal`, one info line of ids and a reason code; a read writes no line.
import type {
  CaseCoveredSession,
  CaseDetail,
  CasesGetOutput,
  CasesListInput,
  CasesListOutput,
  ComplaintDecision,
  MonitorParty,
} from '@ijazah/contracts/admin';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { displayNamesOf } from '../identity/index.js';
import {
  type CaseQueuePage,
  caseQueuePage,
  type CaseQueuePosition,
  type CaseQueueQuery,
  type CaseRecord,
  caseRecordOf,
  type SuspensionCase,
  suspensionCasesCoveredBy,
} from '../moderation/index.js';
import {
  type CoveredSessionRow,
  type MakeupFilter,
  owedNeverOfferedOf,
  sessionsCancelledByCases,
  sessionsOfCaseRemedies,
} from './case-covers.repository.js';
import type { EnrollmentSide } from './enrollment-side.port.js';
import { teacherNoShowCountsOf } from './repeated-absence.repository.js';
import { REPEATED_ABSENCE_FLAG_SETTING, repeatedAbsenceFlagCount } from './repeated-absence.service.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** The reasons of the case an enrollment's end opens (R-312, as T004 lists them). */
export const END_REASONS: ReadonlySet<string> = new Set([
  'absence_termination',
  'teacher_ended',
  'student_banned',
  'student_fault_confirmed',
]);

/** What the queue reads, each through its owner on the caller's transaction; faked in a spec. */
export interface CaseQueueStore {
  /** Moderation's: a page of the queue. */
  caseQueuePage(tx: Transaction, query: CaseQueueQuery): Promise<CaseQueuePage>;
  /** Moderation's: a `disputes` row by id. */
  caseRecordOf(tx: Transaction, caseId: string): Promise<CaseRecord | null>;
  /** Moderation's: the `student_suspended` cases whose sessions the case owes (rule 49's link). */
  suspensionCasesCoveredBy(tx: Transaction, caseId: string): Promise<readonly SuspensionCase[]>;
  teacherNoShowCountsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  /** Identity's: display names by account, a deleted account absent. */
  namesOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  sessionsOfCaseRemedies(tx: Transaction, caseId: string): Promise<readonly CoveredSessionRow[]>;
  sessionsCancelledByCases(
    tx: Transaction,
    caseIds: readonly string[],
    options: { readonly makeups: MakeupFilter },
  ): Promise<readonly CoveredSessionRow[]>;
  owedNeverOfferedOf(tx: Transaction, enrollmentId: string): Promise<readonly CoveredSessionRow[]>;
}

/** The store over sessions' queries and the owners' entries (R-API-6). */
export const caseQueueStore: CaseQueueStore = {
  caseQueuePage,
  caseRecordOf,
  suspensionCasesCoveredBy,
  teacherNoShowCountsOf,
  namesOf: displayNamesOf,
  sessionsOfCaseRemedies,
  sessionsCancelledByCases,
  owedNeverOfferedOf,
};

export interface CaseQueue {
  /** `cases.list` (this file's head). */
  list(tx: Transaction, adminId: string, input: CasesListInput): Promise<CasesListOutput>;
  /** `cases.get` (this file's head). */
  get(tx: Transaction, adminId: string, input: { readonly caseId: string }): Promise<CasesGetOutput>;
}

/** Why a queue read was refused, as its one log line names it. */
type RefusalReason = 'not_found';

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged»
 * so `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: { readonly adminId: string; readonly caseId: string },
  errorCode: ErrorCode,
  reason: RefusalReason,
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'A case queue read was refused');
  return markRefusalLogged(new DomainError(errorCode));
}

/** The cursor a page answers: the last row's part and id. */
function cursorOf({ first, caseId }: CaseQueuePosition): string {
  return `${first ? 'first' : 'rest'}:${caseId}`;
}

/** The position a cursor names (its form checked by the contract's schema). */
function positionOf(cursor: string): CaseQueuePosition {
  const [part, caseId = ''] = cursor.split(':');
  return { first: part === 'first', caseId };
}

/** A party as this phase names one: a deleted account (no name answered) unnamed (FR-426). */
function partyOf(userId: string, names: ReadonlyMap<string, string>): MonitorParty {
  const displayName = names.get(userId);
  return displayName === undefined
    ? { userId, displayName: null, deleted: true }
    : { userId, displayName, deleted: false };
}

/** A complaint's decision, read from its closing (this file's head). */
function decisionOf(record: CaseRecord): ComplaintDecision | undefined {
  if (record.status === 'dismissed') return 'close';
  if (record.resolution === 'enrollment_ended') return 'end_enrollment';
  if (record.resolution === 'party_suspended') return 'suspend_teacher';
  return undefined;
}

const CLOSING_RESOLUTIONS = ['compensation_ordered', 'enrollment_ended', 'party_suspended'] as const;

/** The resolution a case's closing wrote, of the three a case or complaint is closed with. */
function resolutionOf(record: CaseRecord): CaseDetail['resolution'] {
  return CLOSING_RESOLUTIONS.find((resolution) => resolution === record.resolution);
}

/** The case as the detail shows it. */
function detailOf(record: CaseRecord & { readonly kind: CaseDetail['kind'] }): CaseDetail {
  const resolution = resolutionOf(record);
  return {
    caseId: record.caseId,
    kind: record.kind,
    enrollmentId: record.enrollmentId,
    ...(record.kind === 'compensation_case'
      ? // A closed list in code (`COMPENSATION_REASONS`); the output's schema checks it.
        { reason: record.reason as NonNullable<CaseDetail['reason']> }
      : {}),
    status: record.status,
    openedAt: record.createdAt.toISOString(),
    ...(record.resolvedAt === null ? {} : { closedAt: record.resolvedAt.toISOString() }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(record.resolutionNotes === null ? {} : { note: record.resolutionNotes }),
  };
}

/** The covered session as the contract shows it. */
function coveredOf(row: CoveredSessionRow): CaseCoveredSession {
  return {
    sessionId: row.sessionId,
    sequenceNumber: row.sequenceNumber,
    // `session_status` and `remedy_status`, the database's closed enums; the output's schema checks them.
    status: row.status as CaseCoveredSession['status'],
    ...(row.remedy === null
      ? {}
      : {
          remedy: {
            remedyId: row.remedy.remedyId,
            kind: row.remedy.kind,
            status: row.remedy.status as NonNullable<CaseCoveredSession['remedy']>['status'],
          },
        }),
  };
}

export function createCaseQueue({
  enrollments,
  settings,
  log,
  store = caseQueueStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentPage'>;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info'>;
  readonly store?: CaseQueueStore;
}): CaseQueue {
  /** Each enrollment's count and its mark. */
  const countsOf = async (tx: Transaction, enrollmentIds: readonly string[]) => {
    const [counts, flagCount] = await Promise.all([
      store.teacherNoShowCountsOf(tx, [...new Set(enrollmentIds)]),
      settings.read(REPEATED_ABSENCE_FLAG_SETTING, repeatedAbsenceFlagCount),
    ]);
    return (enrollmentId: string) => {
      const teacherNoShows = counts.get(enrollmentId) ?? 0;
      return { teacherNoShows, repeatedAbsence: teacherNoShows >= flagCount };
    };
  };

  /** The sessions the case covers, each once, by sequence number (this file's head). */
  const coversOf = async (tx: Transaction, record: CaseRecord): Promise<CaseCoveredSession[]> => {
    const ends = END_REASONS.has(record.reason) && record.kind === 'compensation_case';
    const linked = ends ? await store.suspensionCasesCoveredBy(tx, record.caseId) : [];
    const linkedThat = (closed: 'resolved' | 'dismissed') =>
      linked.filter(({ status }) => status === closed).map(({ caseId }) => caseId);
    // A dismissed suspension case keeps the ordinary sessions it cancelled, owed nothing, and
    // leaves out the make-ups, owed under the fault case (T036; the owner's decision of 2026-11-11
    // on lane B's questions, item 2, (c)).
    const faultConfirmed =
      record.kind === 'compensation_case' &&
      record.reason === 'student_suspended' &&
      record.status === 'dismissed';
    const parts = await Promise.all([
      store.sessionsOfCaseRemedies(tx, record.caseId),
      store.sessionsCancelledByCases(tx, [record.caseId], {
        makeups: faultConfirmed ? 'none' : 'any',
      }),
      store.sessionsCancelledByCases(tx, linkedThat('resolved'), { makeups: 'any' }),
      ends ? store.owedNeverOfferedOf(tx, record.enrollmentId) : [],
      store.sessionsCancelledByCases(tx, linkedThat('dismissed'), { makeups: 'only' }),
    ]);
    const bySession = new Map<string, CoveredSessionRow>();
    for (const row of parts.flat()) {
      if (!bySession.has(row.sessionId)) bySession.set(row.sessionId, row);
    }
    return [...bySession.values()]
      .toSorted((one, other) => one.sequenceNumber - other.sequenceNumber)
      .map(coveredOf);
  };

  return {
    list: async (tx, _adminId, input) => {
      const limit = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const page = await store.caseQueuePage(tx, {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.cursor === undefined ? {} : { after: positionOf(input.cursor) }),
        limit,
      });
      const countOf = await countsOf(
        tx,
        page.rows.map(({ enrollmentId }) => enrollmentId),
      );
      const items = page.rows.map((row) => ({
        caseId: row.caseId,
        kind: row.kind,
        enrollmentId: row.enrollmentId,
        ...(row.kind === 'compensation_case'
          ? // A closed list in code (`COMPENSATION_REASONS`); the output's schema checks it.
            { reason: row.reason as NonNullable<CasesListOutput['items'][number]['reason']> }
          : {}),
        status: row.status,
        openedAt: row.createdAt.toISOString(),
        ...(row.resolvedAt === null ? {} : { closedAt: row.resolvedAt.toISOString() }),
        ...countOf(row.enrollmentId),
      }));
      return page.next === undefined ? { items } : { items, nextCursor: cursorOf(page.next) };
    },

    get: async (tx, adminId, { caseId }) => {
      const record = await store.caseRecordOf(tx, caseId);
      if (record === null || record.kind === 'session_dispute') {
        throw refusal(log, { adminId, caseId }, 'NOT_FOUND', 'not_found');
      }
      const caseRecord = { ...record, kind: record.kind };
      const {
        items: [item],
      } = await enrollments.enrollmentPage(
        tx,
        { enrollmentIds: [record.enrollmentId] },
        undefined,
        1,
      );
      // `disputes.enrollment_id` is a foreign key to the enrollment (ERD §10).
      if (item === undefined) throw new Error('case queue: a case without its enrollment');
      const [names, countOf, covers] = await Promise.all([
        store.namesOf(tx, [item.studentUserId, item.teacherUserId]),
        countsOf(tx, [item.enrollmentId]),
        coversOf(tx, record),
      ]);
      const decision = record.kind === 'absence_complaint' ? decisionOf(record) : undefined;
      return {
        case: detailOf(caseRecord),
        ...(record.kind === 'absence_complaint'
          ? {
              complaint: {
                reason: record.reason,
                raisedAt: record.createdAt.toISOString(),
                ...(decision === undefined ? {} : { decision }),
              },
            }
          : {}),
        enrollment: {
          enrollmentId: item.enrollmentId,
          student: partyOf(item.studentUserId, names),
          teacher: partyOf(item.teacherUserId, names),
          status: item.status,
          track: item.track,
          ...countOf(item.enrollmentId),
        },
        covers,
        paymentsLink: { enrollmentId: item.enrollmentId },
      };
    },
  };
}
