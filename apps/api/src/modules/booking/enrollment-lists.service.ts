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
import type {
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
import { openComplaintOf } from '../moderation/index.js';
import {
  type DaySession,
  type EnrollmentSessionRow,
  isDisputed,
  pendingCancellationsAmong,
  remedyStatusesAmong,
  sessionProgress,
  sessionsOfEnrollments,
  teacherSessionsBetween,
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
}

/** The store over booking's own queries and the owners' entries (R-API-6). */
export const enrollmentListsStore: EnrollmentListsStore = {
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
};

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
  'enrollmentId' | 'summary' | 'status' | 'next' | 'last' | 'upcoming' | 'completed' | 'remaining'
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
}

async function contextOf(
  tx: Transaction,
  store: EnrollmentListsStore,
  rows: readonly ListedEnrollmentRow[],
  otherParty: (row: ListedEnrollmentRow) => string,
  now: Date,
): Promise<ItemContext> {
  const [sessions, names, subjects] = await Promise.all([
    store.sessionsOf(
      tx,
      rows.map(({ id }) => id),
    ),
    store.namesOf(tx, [...new Set(rows.map(otherParty))]),
    store.subjectsOf(tx, [...new Set(rows.map(({ snapshotSubjectId }) => snapshotSubjectId))]),
  ]);
  const sessionIds = [...sessions.values()].flatMap((rows) => rows.map(({ id }) => id));
  const [pending, remedies] = await Promise.all([
    store.pendingCancellationsOf(tx, sessionIds, now),
    store.remedyStatusesOf(tx, sessionIds),
  ]);
  return { sessions, names, subjects, pending, remedies, now };
}

function coreOf(row: ListedEnrollmentRow, context: ItemContext): ItemCore {
  const progress = sessionProgress(context.sessions.get(row.id) ?? [], {
    sessionCount: row.snapshotSessionCount,
    now: context.now,
  });
  return {
    enrollmentId: row.id,
    summary: termsOf(row, context.subjects),
    status: row.status,
    ...(progress.next === undefined
      ? {}
      : { next: listedSessionOf(progress.next, context.pending, context.remedies) }),
    ...(progress.last === undefined
      ? {}
      : { last: listedSessionOf(progress.last, context.pending, context.remedies) }),
    upcoming: progress.upcoming,
    completed: progress.completed,
    remaining: progress.remaining,
  };
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
    student: partyNameOf(context.names, row.studentUserId),
  };
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
): Promise<EnrollmentsListOutput> {
  const party = { studentUserId };
  if (input.tab === 'active') {
    const rows = await store.activeOfStudent(tx, studentUserId);
    const context = await contextOf(tx, store, rows, ofTeacher, clock.now);
    return { items: rows.map((row) => studentItemOf(row, context)).sort(byNextSession) };
  }
  const rows = await store.endedPage(tx, party, endedPageOf(input.cursor, clock));
  const context = await contextOf(tx, store, rows, ofTeacher, clock.now);
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
): Promise<EnrollmentsGetOutput> {
  const row = await store.listedOf(tx, enrollmentId, { studentUserId });
  if (row === null) throw new DomainError('NOT_FOUND');
  const [context, complaintOpen] = await Promise.all([
    contextOf(tx, store, [row], ofTeacher, now),
    store.complaintOpenOf(tx, row.id),
  ]);
  return {
    ...studentItemOf(row, context),
    sessions: (context.sessions.get(row.id) ?? []).map((one) =>
      listedSessionOf(one, context.pending, context.remedies),
    ),
    complaintOpen,
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
): Promise<TeacherStudentsListOutput> {
  return input.tab === 'active'
    ? teacherActiveTab(tx, store, teacherUserId, input.query, clock)
    : teacherEndedTab(tx, store, teacherUserId, input, clock);
}

async function teacherActiveTab(
  tx: Transaction,
  store: EnrollmentListsStore,
  teacherUserId: string,
  query: string | undefined,
  clock: ListClock,
): Promise<TeacherStudentsListOutput> {
  const active = await store.activeOfTeacher(tx, teacherUserId);
  const matched = await matchingStudents(tx, store, [...new Set(active.map(ofStudent))], query);
  const rows = matched === null ? active : active.filter((row) => matched.has(row.studentUserId));
  const context = await contextOf(tx, store, rows, ofStudent, clock.now);
  return { items: rows.map((row) => teacherItemOf(row, context)).sort(byNextSession) };
}

async function teacherEndedTab(
  tx: Transaction,
  store: EnrollmentListsStore,
  teacherUserId: string,
  input: TeacherStudentsListInput,
  clock: ListClock,
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
  const context = await contextOf(tx, store, rows, ofStudent, clock.now);
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
): Promise<TeacherStudentsGetOutput> {
  const row = await store.listedOf(tx, enrollmentId, { teacherUserId });
  if (row === null) throw new DomainError('NOT_FOUND');
  const context = await contextOf(tx, store, [row], ofStudent, now);
  return {
    ...teacherItemOf(row, context),
    sessions: (context.sessions.get(row.id) ?? []).map((one) =>
      listedSessionOf(one, context.pending, context.remedies),
    ),
  };
}

/** `teacher.today`: the sessions of the teacher's local day, by start (FR-391, FR-393). */
export async function teacherTodayOf(
  tx: Transaction,
  store: EnrollmentListsStore,
  teacherUserId: string,
  now: Date,
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
  const [names, subjects, pending, remedies] = await Promise.all([
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
  ]);
  return {
    localDate,
    timezone,
    sessions: day.flatMap((session) => {
      const row = byId.get(session.enrollmentId);
      if (row === undefined) return [];
      return [
        {
          ...listedSessionOf(session, pending, remedies),
          enrollmentId: row.id,
          student: partyNameOf(names, row.studentUserId),
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
  clock = clockTimestamp,
  store = enrollmentListsStore,
}: {
  readonly database: Database;
  readonly settings: SettingsReader;
  /** The read's instant on its transaction; the database's clock unless a spec sets one. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: EnrollmentListsStore;
}): EnrollmentListServices {
  const transactions = transactionsOver(database);
  const pageSize = () => settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
  return {
    enrollments: async (studentUserId, input) => {
      const size = await pageSize();
      return transactions.run(async (tx) =>
        studentEnrollmentsOf(tx, store, studentUserId, input, {
          now: await clock(tx),
          pageSize: size,
        }),
      );
    },
    enrollment: (studentUserId, input) =>
      transactions.run(async (tx) =>
        studentEnrollmentOf(tx, store, studentUserId, input, await clock(tx)),
      ),
    students: async (teacherUserId, input) => {
      const size = await pageSize();
      return transactions.run(async (tx) =>
        teacherStudentsOf(tx, store, teacherUserId, input, {
          now: await clock(tx),
          pageSize: size,
        }),
      );
    },
    student: (teacherUserId, input) =>
      transactions.run(async (tx) =>
        teacherStudentOf(tx, store, teacherUserId, input, await clock(tx)),
      ),
    today: (teacherUserId) =>
      transactions.run(async (tx) => teacherTodayOf(tx, store, teacherUserId, await clock(tx))),
  };
}
