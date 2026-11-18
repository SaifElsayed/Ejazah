// T049 (FR-390 to FR-393, FR-395; app-surface.md "`enrollments` and the teacher's lists"): the
// student's «اشتراكاتي» and the teacher's «طلابي» and «اليوم», each on one read transaction. Read-only,
// no lock: nothing is decided on what they read, and each answers what a person is shown (T005's
// rule 1 binds the paths that decide).
//
// OWNERSHIP (FR-395, M3). Every row is read by the caller's own id: the student's enrollments by
// `student_user_id`, the teacher's by `teacher_user_id`, a detail by its id and that party together,
// so another student's or another teacher's enrollment answers NOT_FOUND as one that never existed.
// The other party is a party of the enrollment, named whatever their state now, as `checkout.status`
// names the teacher (T037); no visibility predicate is asked, since nothing here is discovered.
// FR-GENDER-7's consequences for an enrollment are Phase 3's.
//
// THE ORDER (FR-390, the owner's decision of 2026-10-31). The active tab by next session, those with
// none (awaiting payment, or all sessions over) after them, newest first, in one page; the ended tab
// newest first, paged by enrollment id after the cursor, one row more read than the page so a cursor
// is written only while more remain.
//
// DERIVED, NEVER STORED (FR-392, R-DB-4). Upcoming, completed and remaining are the sessions
// module's `sessionProgress` over the enrollment's sessions and its snapshot's count, at the read's
// instant.
//
// THE SEARCH (FR-391, ADR 0021 D6, R-203). The teacher's typed name is matched through the kernel's
// `idsWithFoldedNamePrefix` over the tab's own students only, so a search never widens what the
// teacher sees: the active tab's students, or the students of the teacher's ended enrollments.
//
// TIMES (FR-393, ADR 0009 D5). Every session carries its local date, local start and zone beside its
// instants, so the phone shows it in the teacher's zone and the viewer's. «اليوم» is the teacher's
// local day in the teacher's current zone, its bounds from `packages/time` (R-TIME-1).
//
// FIELDS (FR-395, R-HONEST-4). The student is named by display name alone; nothing of a date of
// birth, a minor flag, a document or a dispute is read. The output schemas strip any other field.
//
// A PENDING CANCELLATION (004:T021; FR-456, FR-495). Each session carries `pendingCancellation`,
// sessions' `pendingCancellationsAmong` over the sessions the list answers at the read's instant (the
// database's clock on the read's transaction, the follow-up under 004:T021),
// through sessions' entry (R-API-6): sessions decides what is pending. `disputed` (004:T026): the
// session's status is `disputed`, as sessions' `isDisputed` answers it. `remedyStatus` (004:T028): the
// session's remedy by its status, sessions' `remedyStatusesAmong` through its entry, absent while it
// has none. `complaintOpen` (004:T060, FR-452): whether the student's complaint of the teacher's
// absence is open, moderation's `openComplaintOf` through its entry, on the detail only.
//
// A DELETED PARTY (T007, `003:T090`; FR-426). Identity's names leave out a deleted account (the
// client's extension, its name erased, FR-141), and a live account always has its name (ERD §15
// rule 32), while the enrollment's foreign key keeps the row: a party absent from the names is a
// deleted one, answered `displayNameOrNull: null`, `deleted: true` and the deprecated `displayName`
// `''` (the note under T007), so the phone draws its stand-in.
//
// PAUSED (004:T074; FR-506; DEC-69, Q11 (a); the note under T074, Q-O1 (a), Q-R7 (a), N3, N4). An
// item answers `paused: true` when its enrollment is paused by a teacher's suspension (`confirmed`,
// its `teacher_suspended` case open, T071) or closed by a ban or a revocation while its slot is held:
// the one closing rule's (`closingOf`, sessions' `restore-window.ts`) `student_banned` or
// `teacher_ended` closing, its case open, `slot_released_at` NULL and the read's instant before
// `restorableUntil` (the window of the closing's kind, read through `windowDaysOf(settings)`). A
// paused item carries no reason and no session: no `next`, no `last`, the detail's `sessions` empty;
// its three counts kept, its status and its tab unchanged; «اليوم» leaves its sessions out. Every
// other is `paused: false`, a complaint's or a fault's held closing and T082's `admin_ended` (N4)
// included. The cases are read through moderation's `compensationCasesAmong` once per read, only for
// the enrollments that could be paused. Only the other party ever reads one (FR-506): a suspended or
// banned account is refused before any list, and a revoked teacher the teacher's lists.
//
// A DIRECT END (004:T082; FR-513; SRS FR-CANCEL-10, DEC-68). An enrollment an administrator ended
// directly answers `endedByAdmin: { reason }`, its `admin_end_reason`, to both parties, in the lists
// and the details; the internal note is in the audit entry only and never read here. It is never
// paused (`BAN_CLOSINGS` leaves `admin_ended` out, N4); a restore clears the reason.
//
// THE IJAZAH REQUEST (005:T006; FR-608; contracts/app-surface.md, «Enrollment reads gain»; the note
// under T006, Q4 (a), Q-A3 (a)). Each detail answers `ijazahRequest`, the enrollment's latest
// request (its status, the ijazah once approved, the rejection's reason to the teacher only), or
// null without one. Certification imports booking, so booking declares the port
// `EnrollmentIjazahRequests` (`of(tx, enrollmentIds)`), which `main.ts` binds to certification's
// entry (`docs/ARCHITECTURE.md:195`'s pattern); booking reads no `ijazah_requests` row and imports
// no certification. One call per read, with every enrollment it answers.
import type {
  EnrollmentIjazahRequest,
  EnrollmentsGetInput,
  EnrollmentsGetOutput,
  EnrollmentsListInput,
  EnrollmentsListOutput,
  EnrollmentTerms,
  ListedPartyName,
  ListedSession,
  StudentEnrollmentItem,
  SubjectSummary,
  TeacherStudentItem,
  TeacherStudentsGetInput,
  TeacherStudentsGetOutput,
  TeacherStudentsListInput,
  TeacherStudentsListOutput,
  TeacherTodayOutput,
} from '@ijazah/contracts';
import { endOfLocalDay, localDateIn, startOfLocalDay } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import { idsWithFoldedNamePrefix } from '../../platform/db/folded-name.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { type PackageRow, subjectSummariesOf } from '../catalog/index.js';
import { accountTimezone, displayNamesOf } from '../identity/index.js';
import {
  compensationCasesAmong,
  type EnrollmentCase,
  openComplaintOf,
} from '../moderation/index.js';
import {
  type ClosingKind,
  closingOf,
  type DaySession,
  type EnrollmentSessionRow,
  isDisputed,
  latestEndCaseOf,
  pendingCancellationsAmong,
  remedyStatusesAmong,
  restorableUntil,
  sessionProgress,
  sessionsOfEnrollments,
  teacherSessionsBetween,
  type WindowDays,
  windowDaysOf,
} from '../sessions/index.js';
import {
  activeEnrollmentsOfStudent,
  activeEnrollmentsOfTeacher,
  endedEnrollmentPage,
  endedStudentIdsOf,
  type ListedEnrollmentRow,
  listedEnrollmentOf,
  type ListParty,
  teacherEnrollmentsAmong,
} from './enrollment-lists.repository.js';

export type { ListedEnrollmentRow, ListParty } from './enrollment-lists.repository.js';

/**
 * The ended tab's page size. The lists have no setting of their own (data-model §4); they read the
 * one size this phase's user lists are paged by, discovery's (FR-412).
 */
export const LIST_PAGE_SIZE_SETTING = 'discovery_page_size';

const positiveWhole = z.int().positive();

/**
 * 005:T006 (the note under T006, Q4 (a)): each enrollment's latest ijazah request among
 * `enrollmentIds`, absent for one with none; certification's, bound by `main.ts`.
 */
export interface EnrollmentIjazahRequests {
  of(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, EnrollmentIjazahRequest>>;
}

/** What the lists read, each through its owner's entry, on the caller's transaction; faked in a spec. */
export interface EnrollmentListsStore {
  activeOfStudent(tx: Transaction, studentUserId: string): Promise<readonly ListedEnrollmentRow[]>;
  activeOfTeacher(tx: Transaction, teacherUserId: string): Promise<readonly ListedEnrollmentRow[]>;
  endedPage(
    tx: Transaction,
    party: ListParty,
    page: {
      readonly after?: string;
      readonly limit: number;
      readonly studentUserIds?: readonly string[];
    },
  ): Promise<readonly ListedEnrollmentRow[]>;
  endedStudentIdsOf(tx: Transaction, teacherUserId: string): Promise<readonly string[]>;
  listedOf(
    tx: Transaction,
    enrollmentId: string,
    party: ListParty,
  ): Promise<ListedEnrollmentRow | null>;
  teacherEnrollmentsAmong(
    tx: Transaction,
    teacherUserId: string,
    enrollmentIds: readonly string[],
  ): Promise<readonly ListedEnrollmentRow[]>;
  sessionsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentSessionRow[]>>;
  teacherDay(
    tx: Transaction,
    teacherUserId: string,
    window: { readonly from: Date; readonly to: Date },
  ): Promise<readonly DaySession[]>;
  namesOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  subjectsOf(tx: Transaction, ids: readonly string[]): Promise<ReadonlyMap<string, SubjectSummary>>;
  /** Of `candidateIds`, those whose name, folded, begins with `typed`, folded (R-203). */
  namePrefixMatches(
    tx: Transaction,
    candidateIds: readonly string[],
    typed: string,
  ): Promise<readonly string[]>;
  timezoneOf(tx: Transaction, userId: string): Promise<string | null>;
  /** 004:T021: of `sessionIds`, those with a cancellation request pending at `at`. */
  pendingCancellationsOf(
    tx: Transaction,
    sessionIds: readonly string[],
    at: Date,
  ): Promise<ReadonlySet<string>>;
  /** 004:T028: of `sessionIds`, each one's remedy status, a lapsed one absent (sessions' entry). */
  remedyStatusesOf(
    tx: Transaction,
    sessionIds: readonly string[],
  ): Promise<ReadonlyMap<string, NonNullable<ListedSession['remedyStatus']>>>;
  /** 004:T060: whether the enrollment's complaint of the teacher's absence is open (moderation's). */
  complaintOpenOf(tx: Transaction, enrollmentId: string): Promise<boolean>;
  /** 004:T074: of `enrollmentIds`, each one's compensation cases, newest first (moderation's). */
  casesAmong(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentCase[]>>;
  /** 005:T006: each enrollment's latest ijazah request, through `EnrollmentIjazahRequests`. */
  ijazahRequestsOf: EnrollmentIjazahRequests['of'];
}

/**
 * The store over booking's own queries and the owners' entries (R-API-6); the ijazah requests are
 * the port's, joined by `createEnrollmentListServices` (005:T006).
 */
export const enrollmentListsStore: Omit<EnrollmentListsStore, 'ijazahRequestsOf'> = {
  activeOfStudent: activeEnrollmentsOfStudent,
  activeOfTeacher: activeEnrollmentsOfTeacher,
  endedPage: endedEnrollmentPage,
  endedStudentIdsOf,
  listedOf: listedEnrollmentOf,
  teacherEnrollmentsAmong,
  sessionsOf: sessionsOfEnrollments,
  teacherDay: teacherSessionsBetween,
  namesOf: displayNamesOf,
  subjectsOf: subjectSummariesOf,
  namePrefixMatches: idsWithFoldedNamePrefix,
  timezoneOf: accountTimezone,
  pendingCancellationsOf: pendingCancellationsAmong,
  remedyStatusesOf: remedyStatusesAmong,
  complaintOpenOf: async (tx, enrollmentId) => (await openComplaintOf(tx, enrollmentId)) !== null,
  casesAmong: compensationCasesAmong,
};

/** 004:T074: the case a teacher's suspension opens on each enrollment it pauses (T071, R-313). */
const SUSPENSION_CASE_REASON = 'teacher_suspended';

/** 004:T074: the closings a ban or a revocation makes, paused while their slot is held (N3). */
const BAN_CLOSINGS: ReadonlySet<ClosingKind> = new Set(['student_banned', 'teacher_ended']);

/** 004:T074: an enrollment that could be paused: confirmed, or cancelled with its slot not released. */
const mayBePaused = (row: ListedEnrollmentRow): boolean =>
  row.status === 'confirmed' || (row.status === 'cancelled' && row.slotReleasedAt === null);

/** 004:T074: whether the enrollment is paused, by its cases (this file's head, «PAUSED»). */
async function isPaused(
  row: ListedEnrollmentRow,
  cases: readonly EnrollmentCase[],
  now: Date,
  windowDays: WindowDays,
): Promise<boolean> {
  if (row.status === 'confirmed') {
    return cases.some(
      ({ reason, status }) => reason === SUSPENSION_CASE_REASON && status === 'open',
    );
  }
  const closing = closingOf({
    status: row.status,
    lastCancellationReason: row.cancellationReason,
    endCase: latestEndCaseOf(cases),
  });
  if (closing === undefined || !closing.restorable || !BAN_CLOSINGS.has(closing.kind)) return false;
  const until = await restorableUntil(closing.closingCase.createdAt, closing.kind, windowDays);
  return now.getTime() < until.getTime();
}

/** 004:T074: of `rows`, the paused ones; the cases read once, for those that could be paused. */
async function pausedAmong(
  tx: Transaction,
  store: EnrollmentListsStore,
  rows: readonly ListedEnrollmentRow[],
  now: Date,
  windowDays: WindowDays,
): Promise<ReadonlySet<string>> {
  const candidates = rows.filter(mayBePaused);
  if (candidates.length === 0) return new Set();
  const cases = await store.casesAmong(
    tx,
    candidates.map(({ id }) => id),
  );
  const paused = new Set<string>();
  for (const row of candidates) {
    if (await isPaused(row, cases.get(row.id) ?? [], now, windowDays)) paused.add(row.id);
  }
  return paused;
}

/** The read's instant, and the ended tab's page size read before the transaction. */
export interface ListClock {
  readonly now: Date;
  readonly pageSize: number;
}

/** The seconds a `time` column's local time carries, which the contract's `HH:MM` leaves out. */
const SECONDS = ':00';

/**
 * The session as the lists answer it, `pendingCancellation` from `pending` (004:T021) and `disputed`
 * from its status (004:T026); a disputed one's frozen outcome is left out (R-308).
 */
function listedSessionOf(
  session: EnrollmentSessionRow,
  pending: ReadonlySet<string>,
  remedies: ReadonlyMap<string, NonNullable<ListedSession['remedyStatus']>>,
): ListedSession {
  const remedyStatus = remedies.get(session.id);
  return {
    sessionId: session.id,
    sequenceNumber: session.sequenceNumber,
    localDate: session.localDate,
    startTimeLocal: session.startTimeLocal.slice(0, -SECONDS.length),
    timezone: session.timezone,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    status: session.status,
    pendingCancellation: pending.has(session.id),
    disputed: isDisputed(session.status),
    ...(remedyStatus === undefined ? {} : { remedyStatus }),
  };
}

function termsOf(
  row: ListedEnrollmentRow,
  subjects: ReadonlyMap<string, SubjectSummary>,
): EnrollmentTerms {
  const subject = subjects.get(row.snapshotSubjectId);
  // `enrollments.snapshot_subject_id` is a foreign key to the subject (ERD `enrollments`).
  if (subject === undefined) throw new Error('enrollments: an enrollment without its subject');
  return {
    subject,
    track: row.snapshotTrack,
    sessionCount: row.snapshotSessionCount,
    sessionDurationMinutes: row.snapshotDurationMinutes as PackageRow['sessionDurationMinutes'],
  };
}

/** A party as the lists name them: one absent from identity's names was deleted (this file's head). */
function partyNameOf(names: ReadonlyMap<string, string>, userId: string): ListedPartyName {
  const name = names.get(userId);
  return name === undefined
    ? { displayName: '', displayNameOrNull: null, deleted: true }
    : { displayName: name, displayNameOrNull: name, deleted: false };
}

/** An enrollment's status and progress, the part both sides' items share. */
type ItemCore = Pick<
  StudentEnrollmentItem,
  | 'enrollmentId'
  | 'summary'
  | 'status'
  | 'next'
  | 'last'
  | 'upcoming'
  | 'completed'
  | 'remaining'
  | 'paused'
  | 'endedByAdmin'
>;

/** What every item of some rows needs: their sessions, the other party's names, their subjects. */
interface ItemContext {
  readonly sessions: ReadonlyMap<string, readonly EnrollmentSessionRow[]>;
  readonly names: ReadonlyMap<string, string>;
  readonly subjects: ReadonlyMap<string, SubjectSummary>;
  /** 004:T021: the sessions with a cancellation request pending at `now`. */
  readonly pending: ReadonlySet<string>;
  /** 004:T028: the sessions' remedy statuses. */
  readonly remedies: ReadonlyMap<string, NonNullable<ListedSession['remedyStatus']>>;
  readonly now: Date;
  /** 004:T074: the paused enrollments, answered with no session. */
  readonly paused: ReadonlySet<string>;
}

async function contextOf(
  tx: Transaction,
  store: EnrollmentListsStore,
  rows: readonly ListedEnrollmentRow[],
  otherParty: (row: ListedEnrollmentRow) => string,
  now: Date,
  windowDays: WindowDays,
): Promise<ItemContext> {
  const [sessions, names, subjects, paused] = await Promise.all([
    store.sessionsOf(
      tx,
      rows.map(({ id }) => id),
    ),
    store.namesOf(tx, [...new Set(rows.map(otherParty))]),
    store.subjectsOf(tx, [...new Set(rows.map(({ snapshotSubjectId }) => snapshotSubjectId))]),
    pausedAmong(tx, store, rows, now, windowDays),
  ]);
  const sessionIds = [...sessions.values()].flatMap((rows) => rows.map(({ id }) => id));
  const [pending, remedies] = await Promise.all([
    store.pendingCancellationsOf(tx, sessionIds, now),
    store.remedyStatusesOf(tx, sessionIds),
  ]);
  return { sessions, names, subjects, pending, remedies, now, paused };
}

function coreOf(row: ListedEnrollmentRow, context: ItemContext): ItemCore {
  const progress = sessionProgress(context.sessions.get(row.id) ?? [], {
    sessionCount: row.snapshotSessionCount,
    now: context.now,
  });
  // 004:T074: a paused enrollment shows no session (this file's head, «PAUSED»).
  const paused = context.paused.has(row.id);
  return {
    enrollmentId: row.id,
    summary: termsOf(row, context.subjects),
    status: row.status,
    ...(paused || progress.next === undefined
      ? {}
      : { next: listedSessionOf(progress.next, context.pending, context.remedies) }),
    ...(paused || progress.last === undefined
      ? {}
      : { last: listedSessionOf(progress.last, context.pending, context.remedies) }),
    upcoming: progress.upcoming,
    completed: progress.completed,
    remaining: progress.remaining,
    paused,
    // 004:T082: a direct end's reason, never the internal note (this file's head, «A DIRECT END»).
    ...(row.adminEndReason === null ? {} : { endedByAdmin: { reason: row.adminEndReason } }),
  };
}

/** The detail's sessions, none for a paused enrollment (004:T074). */
function detailSessionsOf(row: ListedEnrollmentRow, context: ItemContext): ListedSession[] {
  if (context.paused.has(row.id)) return [];
  return (context.sessions.get(row.id) ?? []).map((one) =>
    listedSessionOf(one, context.pending, context.remedies),
  );
}

function studentItemOf(row: ListedEnrollmentRow, context: ItemContext): StudentEnrollmentItem {
  return {
    ...coreOf(row, context),
    teacher: { teacherId: row.teacherUserId, ...partyNameOf(context.names, row.teacherUserId) },
  };
}

function teacherItemOf(row: ListedEnrollmentRow, context: ItemContext): TeacherStudentItem {
  return {
    ...coreOf(row, context),
    student: studentOf(context.names, row.studentUserId),
  };
}

/** The teacher's student: the name, and the user id the report sheet names (005:T021, Q-T4 (a)). */
function studentOf(
  names: ReadonlyMap<string, string>,
  studentUserId: string,
): TeacherStudentItem['student'] {
  return { studentId: studentUserId, ...partyNameOf(names, studentUserId) };
}

/** By next session, those with none after them, newest first (this file's head). */
function byNextSession(a: ItemCore, b: ItemCore): number {
  if (a.next !== undefined && b.next !== undefined) {
    return (
      a.next.startsAt.localeCompare(b.next.startsAt) || a.enrollmentId.localeCompare(b.enrollmentId)
    );
  }
  if (a.next !== undefined) return -1;
  if (b.next !== undefined) return 1;
  return b.enrollmentId.localeCompare(a.enrollmentId);
}

/** A page of the ended tab read one row longer than `pageSize`, cut, and its cursor. */
function cutPage<T extends { readonly enrollmentId: string }>(
  items: readonly T[],
  pageSize: number,
): { items: T[]; nextCursor?: string } {
  const page = items.slice(0, pageSize);
  const last = page.at(-1);
  return items.length > pageSize && last !== undefined
    ? { items: page, nextCursor: last.enrollmentId }
    : { items: page };
}

const ofTeacher = (row: ListedEnrollmentRow) => row.teacherUserId;
const ofStudent = (row: ListedEnrollmentRow) => row.studentUserId;

/** `enrollments.list`: the student's own enrollments in the tab (FR-390). */
export async function studentEnrollmentsOf(
  tx: Transaction,
  store: EnrollmentListsStore,
  studentUserId: string,
  input: EnrollmentsListInput,
  clock: ListClock,
  windowDays: WindowDays,
): Promise<EnrollmentsListOutput> {
  const party = { studentUserId };
  if (input.tab === 'active') {
    const rows = await store.activeOfStudent(tx, studentUserId);
    const context = await contextOf(tx, store, rows, ofTeacher, clock.now, windowDays);
    return { items: rows.map((row) => studentItemOf(row, context)).sort(byNextSession) };
  }
  const rows = await store.endedPage(tx, party, endedPageOf(input.cursor, clock));
  const context = await contextOf(tx, store, rows, ofTeacher, clock.now, windowDays);
  return cutPage(
    rows.map((row) => studentItemOf(row, context)),
    clock.pageSize,
  );
}

function endedPageOf(cursor: string | undefined, clock: ListClock) {
  return { ...(cursor === undefined ? {} : { after: cursor }), limit: clock.pageSize + 1 };
}

/** `enrollments.get`: the student's own enrollment with every session; NOT_FOUND otherwise. */
export async function studentEnrollmentOf(
  tx: Transaction,
  store: EnrollmentListsStore,
  studentUserId: string,
  { enrollmentId }: EnrollmentsGetInput,
  now: Date,
  windowDays: WindowDays,
): Promise<EnrollmentsGetOutput> {
  const row = await store.listedOf(tx, enrollmentId, { studentUserId });
  if (row === null) throw new DomainError('NOT_FOUND');
  const [context, complaintOpen, requests] = await Promise.all([
    contextOf(tx, store, [row], ofTeacher, now, windowDays),
    store.complaintOpenOf(tx, row.id),
    store.ijazahRequestsOf(tx, [row.id]),
  ]);
  return {
    ...studentItemOf(row, context),
    sessions: detailSessionsOf(row, context),
    complaintOpen,
    ijazahRequest: withoutReason(requests.get(row.id)),
  };
}

/** The tab's students whose name begins with `query`, folded; every one when there is none. */
async function matchingStudents(
  tx: Transaction,
  store: EnrollmentListsStore,
  candidates: readonly string[],
  query: string | undefined,
): Promise<ReadonlySet<string> | null> {
  if (query === undefined) return null;
  return new Set(await store.namePrefixMatches(tx, candidates, query));
}

/** `teacher.students.list`: the teacher's own students' enrollments in the tab (FR-391). */
export async function teacherStudentsOf(
  tx: Transaction,
  store: EnrollmentListsStore,
  teacherUserId: string,
  input: TeacherStudentsListInput,
  clock: ListClock,
  windowDays: WindowDays,
): Promise<TeacherStudentsListOutput> {
  return input.tab === 'active'
    ? teacherActiveTab(tx, store, teacherUserId, input.query, clock, windowDays)
    : teacherEndedTab(tx, store, teacherUserId, input, clock, windowDays);
}

async function teacherActiveTab(
  tx: Transaction,
  store: EnrollmentListsStore,
  teacherUserId: string,
  query: string | undefined,
  clock: ListClock,
  windowDays: WindowDays,
): Promise<TeacherStudentsListOutput> {
  const active = await store.activeOfTeacher(tx, teacherUserId);
  const matched = await matchingStudents(tx, store, [...new Set(active.map(ofStudent))], query);
  const rows = matched === null ? active : active.filter((row) => matched.has(row.studentUserId));
  const context = await contextOf(tx, store, rows, ofStudent, clock.now, windowDays);
  return { items: rows.map((row) => teacherItemOf(row, context)).sort(byNextSession) };
}

async function teacherEndedTab(
  tx: Transaction,
  store: EnrollmentListsStore,
  teacherUserId: string,
  input: TeacherStudentsListInput,
  clock: ListClock,
  windowDays: WindowDays,
): Promise<TeacherStudentsListOutput> {
  const matched =
    input.query === undefined
      ? null
      : await matchingStudents(
          tx,
          store,
          await store.endedStudentIdsOf(tx, teacherUserId),
          input.query,
        );
  if (matched !== null && matched.size === 0) return { items: [] };
  const rows = await store.endedPage(
    tx,
    { teacherUserId },
    {
      ...endedPageOf(input.cursor, clock),
      ...(matched === null ? {} : { studentUserIds: [...matched] }),
    },
  );
  const context = await contextOf(tx, store, rows, ofStudent, clock.now, windowDays);
  return cutPage(
    rows.map((row) => teacherItemOf(row, context)),
    clock.pageSize,
  );
}

/** `teacher.students.get`: the teacher's own enrollment with every session; NOT_FOUND otherwise. */
export async function teacherStudentOf(
  tx: Transaction,
  store: EnrollmentListsStore,
  teacherUserId: string,
  { enrollmentId }: TeacherStudentsGetInput,
  now: Date,
  windowDays: WindowDays,
): Promise<TeacherStudentsGetOutput> {
  const row = await store.listedOf(tx, enrollmentId, { teacherUserId });
  if (row === null) throw new DomainError('NOT_FOUND');
  const [context, requests] = await Promise.all([
    contextOf(tx, store, [row], ofStudent, now, windowDays),
    store.ijazahRequestsOf(tx, [row.id]),
  ]);
  return {
    ...teacherItemOf(row, context),
    sessions: detailSessionsOf(row, context),
    ijazahRequest: requests.get(row.id) ?? null,
  };
}

/**
 * 005:T006 (FR-608): the student's read of the request, the rejection's reason being the teacher's.
 * A revoked ijazah keeps its `revoked: true` (005:T010, Q-E2 (a), R-HONEST-6; #146 Saif r1, Major 1):
 * the fields are named one by one, so the reason is never copied and the flag never dropped.
 */
function withoutReason(
  request: EnrollmentIjazahRequest | undefined,
): Omit<EnrollmentIjazahRequest, 'reason'> | null {
  if (request === undefined) return null;
  const { status, ijazahId, revoked } = request;
  return {
    status,
    ...(ijazahId === undefined ? {} : { ijazahId }),
    ...(revoked === undefined ? {} : { revoked }),
  };
}

/** `teacher.today`: the sessions of the teacher's local day, by start (FR-391, FR-393). */
export async function teacherTodayOf(
  tx: Transaction,
  store: EnrollmentListsStore,
  teacherUserId: string,
  now: Date,
  windowDays: WindowDays,
): Promise<TeacherTodayOutput> {
  const timezone = await store.timezoneOf(tx, teacherUserId);
  // A signed-in teacher's account is live (the caller kind read it on this request).
  if (timezone === null) throw new Error('teacher.today: a signed-in teacher without an account');
  const localDate = localDateIn(now, timezone);
  const window = {
    from: new Date(startOfLocalDay(localDate, timezone)),
    to: new Date(endOfLocalDay(localDate, timezone)),
  };
  const day = await store.teacherDay(tx, teacherUserId, window);
  const rows = await store.teacherEnrollmentsAmong(tx, teacherUserId, [
    ...new Set(day.map(({ enrollmentId }) => enrollmentId)),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const [names, subjects, pending, remedies, paused] = await Promise.all([
    store.namesOf(tx, [...new Set(rows.map(ofStudent))]),
    store.subjectsOf(tx, [...new Set(rows.map(({ snapshotSubjectId }) => snapshotSubjectId))]),
    store.pendingCancellationsOf(
      tx,
      day.map(({ id }) => id),
      now,
    ),
    store.remedyStatusesOf(
      tx,
      day.map(({ id }) => id),
    ),
    pausedAmong(tx, store, rows, now, windowDays),
  ]);
  return {
    localDate,
    timezone,
    sessions: day.flatMap((session) => {
      const row = byId.get(session.enrollmentId);
      // 004:T074: a paused enrollment's sessions are left out of the day (this file's head).
      if (row === undefined || paused.has(row.id)) return [];
      return [
        {
          ...listedSessionOf(session, pending, remedies),
          enrollmentId: row.id,
          student: studentOf(names, row.studentUserId),
          summary: termsOf(row, subjects),
        },
      ];
    }),
  };
}

/** The lists' services over the process's client: each call one read transaction (this file's head). */
export interface EnrollmentListServices {
  enrollments(studentUserId: string, input: EnrollmentsListInput): Promise<EnrollmentsListOutput>;
  enrollment(studentUserId: string, input: EnrollmentsGetInput): Promise<EnrollmentsGetOutput>;
  students(
    teacherUserId: string,
    input: TeacherStudentsListInput,
  ): Promise<TeacherStudentsListOutput>;
  student(teacherUserId: string, input: TeacherStudentsGetInput): Promise<TeacherStudentsGetOutput>;
  today(teacherUserId: string): Promise<TeacherTodayOutput>;
}

/**
 * The lists' services; the page size is read before the transaction, the read's instant on it: the
 * database's clock (`clockTimestamp`), as `sessions.get` and every decision path read it, so around
 * a session's start no list shows a request pending that every path refuses `CANCELLATION_EXPIRED`
 * (the follow-up under 004:T021, PR #131's review, round 2). The same instant feeds
 * `sessionProgress`.
 */
export function createEnrollmentListServices({
  database,
  settings,
  ijazahRequests,
  clock = clockTimestamp,
  store: entries = enrollmentListsStore,
}: {
  readonly database: Database;
  readonly settings: SettingsReader;
  /** 005:T006: certification's latest requests, bound by `main.ts` (the note under T006, Q4 (a)). */
  readonly ijazahRequests: EnrollmentIjazahRequests;
  /** The read's instant on its transaction; the database's clock unless a spec sets one. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: Omit<EnrollmentListsStore, 'ijazahRequestsOf'>;
}): EnrollmentListServices {
  const transactions = transactionsOver(database);
  const store: EnrollmentListsStore = {
    ...entries,
    ijazahRequestsOf: (tx, enrollmentIds) => ijazahRequests.of(tx, enrollmentIds),
  };
  const pageSize = () => settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
  // 004:T074: the two restore windows, each read when a held closing needs it (R-MONEY-12).
  const windowDays = windowDaysOf(settings);
  return {
    enrollments: async (studentUserId, input) => {
      const size = await pageSize();
      return transactions.run(async (tx) =>
        studentEnrollmentsOf(
          tx,
          store,
          studentUserId,
          input,
          { now: await clock(tx), pageSize: size },
          windowDays,
        ),
      );
    },
    enrollment: (studentUserId, input) =>
      transactions.run(async (tx) =>
        studentEnrollmentOf(tx, store, studentUserId, input, await clock(tx), windowDays),
      ),
    students: async (teacherUserId, input) => {
      const size = await pageSize();
      return transactions.run(async (tx) =>
        teacherStudentsOf(
          tx,
          store,
          teacherUserId,
          input,
          { now: await clock(tx), pageSize: size },
          windowDays,
        ),
      );
    },
    student: (teacherUserId, input) =>
      transactions.run(async (tx) =>
        teacherStudentOf(tx, store, teacherUserId, input, await clock(tx), windowDays),
      ),
    today: (teacherUserId) =>
      transactions.run(async (tx) =>
        teacherTodayOf(tx, store, teacherUserId, await clock(tx), windowDays),
      ),
  };
}
