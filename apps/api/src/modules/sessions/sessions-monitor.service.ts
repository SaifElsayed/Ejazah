// T024 of specs/004-sessions/tasks.md (FR-479, FR-480, FR-451, FR-439, FR-454, FR-497; R-MONEY-6,
// R-DB-4, R-API-6; research R-322, R-323 GAP-1 and GAP-4; contracts/admin-surface.md,
// `sessions.monitor.list/get`, `TimelineEvent`, `RemedyMonitor`): the enrollment and session monitor,
// two reads on the administrator call's transaction. Nothing here writes or locks; the audit entries
// are the router's. No amount, payment record or payment id is read (FR-497): payment status is
// `/payments`' page.
//
// THE LIST. The enrollments are booking's, read through `EnrollmentSide.enrollmentPage` (R-API-6; the
// third analysis, U3): newest first by id, by status, and by the enrollment ids whose sessions fall
// between `from` and `to`, which sessions finds in its own table. A name search (the student's, the
// teacher's or both, each by its folded prefix through the kernel's `idsWithFoldedNamePrefix`, R-203)
// is matched over each batch's own parties, so no name is matched outside the enrollments read; the
// batches are each twice the one before, from `admin_list_page_size` and one more, until the page
// holds one more match than it shows or the rows end, as the payments monitor reads
// (`modules/payments/payments-monitor.service.ts`; the owner's decision of 2026-11-10 on lane B's
// Q3), so no short page is answered while a cursor exists, and a scan of n enrollments takes a
// number of reads logarithmic in n. Each item's `completed`, `remaining` and next session derive
// from its sessions (`progress.ts`), its `teacherNoShows` from T015's count and its mark at
// `repeated_absence_flag_count` (FR-451: nothing follows from it).
//
// THE DETAIL. The enrollment (its page of one), its sessions by sequence number with `cancellable`
// (`scheduled`, T023's rule), `correctable` (`outcome-correction.ts`, FR-439) and the remedy
// (`remedy-deadlines.ts`: the proposal at the enrollment's slot's current local start on its date in
// the enrollment's zone, the owner's decision of 2026-11-10 on lane B's Q6; the pending
// counter-proposal with `answerClosesAt`, D1; `bookingRetriedUntil`), its compensation cases and the
// requests of its sessions, newest first, its timeline (`enrollment_events` through
// `EnrollmentSide.eventsOf` and its `session_events`, newest first; at one instant the session rows
// before the enrollment's, each source keeping its own order), and `restorableUntil`
// (`restore-window.ts`) for an enrollment `sessions.restore` could admit by its closing and its case
// (R-322, step 1). Every instant compared is the database's clock.
//
// T070 (FR-503; SRS FR-CANCEL-9; the note under T070, Q4 (a)): `slotHeldUntil`, the hold's end
// through `restorableUntil` with the closing's kind, for a closing the one closing rule
// (`restore-window.ts`'s `closingOf`) admits with its case open and its slot not released, whether
// or not it has passed; and `slotReleasedAt`, the instant of the `slot_released` row after the
// closing.
//
// T073 (the note under T073, Q4 (a); PR #138's review, round 3, Major 1): `closingCaseReason` reads
// the closing as step 1 does (`closingOf`: a complaint's, a fault's, a ban's, a teacher's ban's or
// revocation's `teacher_ended`; never a deletion's or a gender correction's), so `restorableUntil`
// and `slotHeldUntil` are answered for every closing step 1 admits with its case open. Step 2
// retired (DEC-69): `restorableUntil` stays, `@deprecated`, answered with the hold's end; it may
// have passed while the restore is still admitted, and a release leaves it.
//
// THE LOG (the owner's rule). An enrollment no read returns is refused NOT_FOUND through this file's
// one `refusal`, one info line of ids and a reason code; a read writes no line.
import type {
  MonitorParty,
  MonitorSession,
  RemedyMonitor,
  SessionsMonitorGetOutput,
  SessionsMonitorListInput,
  SessionsMonitorListItem,
  SessionsMonitorListOutput,
  TimelineEvent,
} from '@ijazah/contracts/admin';
import { resolveLocalDateTime } from '@ijazah/time';
import { z } from 'zod';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import { idsWithFoldedNamePrefix } from '../../platform/db/folded-name.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError, type ErrorCode } from '../../platform/errors/domain-error.js';
import { markRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { readSlot } from '../catalog/index.js';
import { displayNamesOf } from '../identity/index.js';
import {
  compensationCasesOf,
  type EnrollmentCase,
  sessionsEverDisputedAmong,
} from '../moderation/index.js';
import { DISPUTE_WINDOW_SETTING, disputeWindowHours } from './completion.service.js';
import type {
  EnrollmentEventEntry,
  EnrollmentPageFilter,
  EnrollmentPageItem,
  EnrollmentSide,
} from './enrollment-side.port.js';
import { isCorrectable } from './outcome-correction.js';
import { type SessionProgress, sessionProgress } from './progress.js';
import { answerClosesAt, bookingRetriedUntil } from './remedy-deadlines.js';
import { teacherNoShowCountsOf } from './repeated-absence.repository.js';
import { REPEATED_ABSENCE_FLAG_SETTING, repeatedAbsenceFlagCount } from './repeated-absence.service.js';
import {
  type Closing,
  closingOf,
  latestEndCaseOf,
  restorableUntil,
  windowDaysOf,
} from './restore-window.js';
import {
  type CancellationRequestRow,
  cancellationRequestsOf,
  enrollmentIdsWithSessionsBetween,
  type MonitoredRemedyRow,
  type MonitoredSessionRow,
  monitoredSessionsOf,
  type SessionEventRow,
  sessionEventsOf,
} from './sessions-monitor.repository.js';
import { type EnrollmentSessionRow, sessionsOfEnrollments } from './sessions.repository.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** The seconds a `time` column's local time carries, which the contract's `HH:MM` leaves out. */
const SECONDS = ':00';

/** What the monitor reads, each through its owner on the caller's transaction; faked in a spec. */
export interface SessionsMonitorStore {
  enrollmentIdsWithSessionsBetween(
    tx: Transaction,
    range: { readonly from?: string; readonly to?: string },
  ): Promise<readonly string[]>;
  sessionsOfEnrollments(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly EnrollmentSessionRow[]>>;
  teacherNoShowCountsOf(
    tx: Transaction,
    enrollmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
  /** Identity's: display names by account, a deleted account absent. */
  namesOf(tx: Transaction, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** The kernel's: of `candidateIds`, those whose name, folded, begins with `typed`, folded. */
  namePrefixMatches(
    tx: Transaction,
    candidateIds: readonly string[],
    typed: string,
  ): Promise<readonly string[]>;
  monitoredSessionsOf(tx: Transaction, enrollmentId: string): Promise<readonly MonitoredSessionRow[]>;
  sessionEventsOf(tx: Transaction, enrollmentId: string): Promise<readonly SessionEventRow[]>;
  cancellationRequestsOf(
    tx: Transaction,
    enrollmentId: string,
  ): Promise<readonly CancellationRequestRow[]>;
  /** Moderation's: the enrollment's compensation cases, newest first. */
  casesOf(tx: Transaction, enrollmentId: string): Promise<readonly EnrollmentCase[]>;
  /** Moderation's: of `sessionIds`, those ever disputed. */
  sessionsEverDisputedAmong(
    tx: Transaction,
    sessionIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
  /** Catalog's: the slot's local start, `HH:MM:SS`. */
  slotOf(tx: Transaction, slotId: string): Promise<{ readonly startTimeLocal: string } | null>;
}

/** The store over sessions' queries and the owners' entries (R-API-6). */
export const sessionsMonitorStore: SessionsMonitorStore = {
  enrollmentIdsWithSessionsBetween,
  sessionsOfEnrollments,
  teacherNoShowCountsOf,
  namesOf: displayNamesOf,
  namePrefixMatches: idsWithFoldedNamePrefix,
  monitoredSessionsOf,
  sessionEventsOf,
  cancellationRequestsOf,
  casesOf: compensationCasesOf,
  sessionsEverDisputedAmong,
  slotOf: readSlot,
};

export interface SessionsMonitor {
  /** `sessions.monitor.list` (this file's head). */
  list(
    tx: Transaction,
    adminId: string,
    input: SessionsMonitorListInput,
  ): Promise<SessionsMonitorListOutput>;
  /** `sessions.monitor.get` (this file's head). */
  get(
    tx: Transaction,
    adminId: string,
    input: { readonly enrollmentId: string },
  ): Promise<SessionsMonitorGetOutput>;
}

/** Why a monitor read was refused, as its one log line names it. */
type RefusalReason = 'not_found';

/**
 * Logs the refusal with ids and its reason only, and answers the error to throw, marked «logged»
 * so `onError` writes no second line (PR #130's review, round 1, Minor 4).
 */
function refusal(
  log: Pick<Logger, 'info'>,
  ids: { readonly adminId: string; readonly enrollmentId: string },
  errorCode: ErrorCode,
  reason: RefusalReason,
): DomainError {
  log.info({ ...ids, errorCode, reason }, 'An enrollment monitor read was refused');
  return markRefusalLogged(new DomainError(errorCode));
}

/** A local time column's `HH:MM:SS` as the contract's `HH:MM`. */
const hoursAndMinutes = (localTime: string): string => localTime.slice(0, -SECONDS.length);

/** A party as this phase names one: a deleted account (no name answered) unnamed (FR-426). */
function partyOf(userId: string, names: ReadonlyMap<string, string>): MonitorParty {
  const displayName = names.get(userId);
  return displayName === undefined
    ? { userId, displayName: null, deleted: true }
    : { userId, displayName, deleted: false };
}

/** A wall clock on a date in a zone, with its instant from `packages/time` (R-TIME-1). */
function timeOn(localDate: string, localTime: string, timezone: string) {
  return {
    localDate,
    startTimeLocal: hoursAndMinutes(localTime),
    timezone,
    startsAt: new Date(resolveLocalDateTime({ localDate, localTime, timezone }).startsAt).toISOString(),
  };
}

/**
 * The closing `sessions.restore` reverses and its case, read as R-322's step 1 reads it (T073; the
 * note under T073, Q4 (a); PR #138's review, round 3, Major 1): T070's one closing rule
 * (`closingOf`) over the status, the last cancellation's reason read from the timeline (oldest
 * first) and the latest end case from the cases (newest first); none for a closing step 1 never
 * admits (a deletion's, a gender correction's, a completion, an enrollment not closed).
 */
function closingCaseReason(
  status: EnrollmentPageItem['status'],
  enrollmentEvents: readonly EnrollmentEventEntry[],
  cases: readonly EnrollmentCase[],
): Closing | undefined {
  const lastCancellation = enrollmentEvents.filter(({ kind }) => kind === 'cancelled').at(-1);
  return closingOf({
    status,
    lastCancellationReason: lastCancellation?.cancellationReason ?? null,
    endCase: latestEndCaseOf(cases),
  });
}

/**
 * T070 (FR-503; the note under T070, Q4 (a)): the enrollment's closing (`closingCaseReason`, the one
 * closing rule); and an administrator's release of its slot, the `slot_released` row after its last
 * closing (`enrollments.releaseSlot` writes it with `slot_released_at`, at one instant).
 */
function slotHoldOf(
  status: EnrollmentPageItem['status'],
  enrollmentEvents: readonly EnrollmentEventEntry[],
  cases: readonly EnrollmentCase[],
): { readonly closing?: Closing; readonly releasedAt?: Date } {
  const closing = closingCaseReason(status, enrollmentEvents, cases);
  if (closing === undefined) return {};
  const closedAt = enrollmentEvents.findLastIndex(
    ({ kind }) => kind === 'cancelled' || kind === 'terminated_no_show',
  );
  const released = enrollmentEvents
    .slice(closedAt + 1)
    .filter(({ kind }) => kind === 'slot_released')
    .at(-1);
  return released === undefined ? { closing } : { closing, releasedAt: released.occurredAt };
}

/** The timeline: newest first, at one instant the session rows first (this file's head). */
function timelineOf(
  sessionEvents: readonly SessionEventRow[],
  enrollmentEvents: readonly EnrollmentEventEntry[],
): TimelineEvent[] {
  const rows: { readonly at: Date; readonly event: TimelineEvent }[] = [
    ...sessionEvents.map((row) => ({
      at: row.occurredAt,
      event: {
        source: 'session' as const,
        kind: row.kind,
        ...(row.sessionId === null ? {} : { sessionId: row.sessionId }),
        ...(row.caseId === null ? {} : { caseId: row.caseId }),
        ...(row.outcomeBefore === null ? {} : { outcomeBefore: row.outcomeBefore }),
        ...(row.outcomeAfter === null ? {} : { outcomeAfter: row.outcomeAfter }),
        ...(row.previousStartAt === null
          ? {}
          : { previousStartAt: row.previousStartAt.toISOString() }),
        occurredAt: row.occurredAt.toISOString(),
      },
    })),
    ...enrollmentEvents.toReversed().map((row) => ({
      at: row.occurredAt,
      event: {
        source: 'enrollment' as const,
        kind: row.kind,
        ...(row.cancellationReason === undefined
          ? {}
          : { cancellationReason: row.cancellationReason }),
        occurredAt: row.occurredAt.toISOString(),
      },
    })),
  ];
  // A stable sort: rows of one instant keep the order above.
  return rows.toSorted((one, other) => other.at.getTime() - one.at.getTime()).map(({ event }) => event);
}

export function createSessionsMonitor({
  enrollments,
  settings,
  log,
  clock = clockTimestamp,
  store = sessionsMonitorStore,
}: {
  readonly enrollments: Pick<EnrollmentSide, 'enrollmentPage' | 'eventsOf' | 'enrollmentFor'>;
  readonly settings: SettingsReader;
  readonly log: Pick<Logger, 'info'>;
  /** The database's clock on the call's transaction. */
  readonly clock?: (tx: Transaction) => Promise<Date>;
  readonly store?: SessionsMonitorStore;
}): SessionsMonitor {
  /** Of a batch, the enrollments whose parties match every name searched. */
  const matching = async (
    tx: Transaction,
    items: readonly EnrollmentPageItem[],
    { student, teacher }: SessionsMonitorListInput,
  ): Promise<EnrollmentPageItem[]> => {
    const named = async (typed: string | undefined, ids: readonly string[]) =>
      typed === undefined ? null : new Set(await store.namePrefixMatches(tx, [...new Set(ids)], typed));
    const students = await named(
      student,
      items.map(({ studentUserId }) => studentUserId),
    );
    const teachers = await named(
      teacher,
      items.map(({ teacherUserId }) => teacherUserId),
    );
    return items.filter(
      (one) =>
        (students === null || students.has(one.studentUserId)) &&
        (teachers === null || teachers.has(one.teacherUserId)),
    );
  };

  /** The enrollments of a page, read whole or searched in doubling batches. */
  const pageOf = async (
    tx: Transaction,
    filter: EnrollmentPageFilter,
    input: SessionsMonitorListInput,
    pageSize: number,
  ): Promise<{ readonly items: readonly EnrollmentPageItem[]; readonly nextCursor?: string }> => {
    if (input.student === undefined && input.teacher === undefined) {
      return enrollments.enrollmentPage(tx, filter, input.cursor, pageSize);
    }
    const wanted = pageSize + 1;
    const kept: EnrollmentPageItem[] = [];
    let after = input.cursor;
    let window = wanted;
    for (;;) {
      const batch = await enrollments.enrollmentPage(tx, filter, after, window);
      kept.push(...(await matching(tx, batch.items, input)));
      if (kept.length >= wanted || batch.nextCursor === undefined) break;
      after = batch.nextCursor;
      window += window;
    }
    const items = kept.slice(0, pageSize);
    const lastShown = items.at(-1);
    return kept.length > pageSize && lastShown !== undefined
      ? { items, nextCursor: lastShown.enrollmentId }
      : { items };
  };

  /** Each enrollment's progress, count and mark, and every party's name, at `now`. */
  const summariesOf = async (
    tx: Transaction,
    items: readonly EnrollmentPageItem[],
    sessionsOf: (enrollmentId: string) => readonly EnrollmentSessionRow[],
    now: Date,
  ) => {
    const ids = items.map(({ enrollmentId }) => enrollmentId);
    const [counts, flagCount, names] = await Promise.all([
      store.teacherNoShowCountsOf(tx, ids),
      settings.read(REPEATED_ABSENCE_FLAG_SETTING, repeatedAbsenceFlagCount),
      store.namesOf(tx, [
        ...new Set(items.flatMap(({ studentUserId, teacherUserId }) => [studentUserId, teacherUserId])),
      ]),
    ]);
    return (item: EnrollmentPageItem): { summary: SessionsMonitorListItem; progress: SessionProgress } => {
      const progress = sessionProgress(sessionsOf(item.enrollmentId), {
        sessionCount: item.sessionCount,
        now,
      });
      const teacherNoShows = counts.get(item.enrollmentId) ?? 0;
      return {
        progress,
        summary: {
          enrollmentId: item.enrollmentId,
          student: partyOf(item.studentUserId, names),
          teacher: partyOf(item.teacherUserId, names),
          status: item.status,
          track: item.track,
          sessionCount: item.sessionCount,
          completed: progress.completed,
          remaining: progress.remaining,
          teacherNoShows,
          repeatedAbsence: teacherNoShows >= flagCount,
        },
      };
    };
  };

  /** A remedy as the administrator sees it, its deadlines derived at `now`. */
  const remedyOf = (
    remedy: MonitoredRemedyRow,
    proposalTime: { readonly startTimeLocal: string; readonly timezone: string },
    now: Date,
  ): RemedyMonitor => {
    const proposal =
      remedy.proposedDate === null
        ? undefined
        : timeOn(remedy.proposedDate, proposalTime.startTimeLocal, proposalTime.timezone);
    const retriedUntil = bookingRetriedUntil(
      {
        status: remedy.status,
        choiceClosesAt: remedy.choiceClosesAt,
        proposalStartsAt: proposal === undefined ? undefined : new Date(proposal.startsAt),
        snapshotFirstSessionLeadHours: remedy.snapshotFirstSessionLeadHours,
      },
      now,
    );
    const { counter } = remedy;
    return {
      remedyId: remedy.id,
      kind: remedy.kind,
      status: remedy.status,
      offeredAt: remedy.offeredAt.toISOString(),
      choiceClosesAt: remedy.choiceClosesAt.toISOString(),
      ...(proposal === undefined ? {} : { proposal }),
      ...(counter === null
        ? {}
        : {
            counter: {
              ...timeOn(counter.date, counter.startTimeLocal, counter.timezone),
              proposedAt: counter.proposedAt.toISOString(),
              answerClosesAt: answerClosesAt({
                counterProposedAt: counter.proposedAt,
                snapshotAnswerWindowHours: remedy.snapshotAnswerWindowHours,
              }).toISOString(),
            },
          }),
      ...(remedy.caseId === null ? {} : { caseId: remedy.caseId }),
      ...(remedy.decidedAt === null ? {} : { decidedAt: remedy.decidedAt.toISOString() }),
      ...(retriedUntil === undefined ? {} : { bookingRetriedUntil: retriedUntil.toISOString() }),
    };
  };

  return {
    list: async (tx, _adminId, input) => {
      const pageSize = await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
      const filter: EnrollmentPageFilter = {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.from === undefined && input.to === undefined
          ? {}
          : {
              enrollmentIds: await store.enrollmentIdsWithSessionsBetween(tx, {
                ...(input.from === undefined ? {} : { from: input.from }),
                ...(input.to === undefined ? {} : { to: input.to }),
              }),
            }),
      };
      const page = await pageOf(tx, filter, input, pageSize);
      const now = await clock(tx);
      const sessions = await store.sessionsOfEnrollments(
        tx,
        page.items.map(({ enrollmentId }) => enrollmentId),
      );
      const summaryOf = await summariesOf(tx, page.items, (id) => sessions.get(id) ?? [], now);
      const items = page.items.map((item) => {
        const { summary, progress } = summaryOf(item);
        const { next } = progress;
        return next === undefined
          ? summary
          : {
              ...summary,
              nextSession: {
                sessionId: next.id,
                localDate: next.localDate,
                startTimeLocal: hoursAndMinutes(next.startTimeLocal),
                timezone: next.timezone,
                startsAt: next.startsAt.toISOString(),
              },
            };
      });
      return page.nextCursor === undefined ? { items } : { items, nextCursor: page.nextCursor };
    },

    get: async (tx, adminId, { enrollmentId }) => {
      const {
        items: [item],
      } = await enrollments.enrollmentPage(tx, { enrollmentIds: [enrollmentId] }, undefined, 1);
      const terms = item === undefined ? null : await enrollments.enrollmentFor(tx, enrollmentId);
      if (item === undefined || terms === null) {
        throw refusal(log, { adminId, enrollmentId }, 'NOT_FOUND', 'not_found');
      }
      const [sessions, enrollmentEvents, sessionEvents, requests, cases, slot] = await Promise.all([
        store.monitoredSessionsOf(tx, enrollmentId),
        enrollments.eventsOf(tx, enrollmentId),
        store.sessionEventsOf(tx, enrollmentId),
        store.cancellationRequestsOf(tx, enrollmentId),
        store.casesOf(tx, enrollmentId),
        store.slotOf(tx, terms.slotId),
      ]);
      // `enrollments.slot_id` is a foreign key to the slot (ERD `enrollments`).
      if (slot === null) throw new Error('sessions monitor: an enrollment without its slot');
      const [disputed, now, windowHours] = await Promise.all([
        store.sessionsEverDisputedAmong(
          tx,
          sessions.map(({ id }) => id),
        ),
        clock(tx),
        settings.read(DISPUTE_WINDOW_SETTING, disputeWindowHours),
      ]);
      const { summary } = (await summariesOf(tx, [item], () => sessions, now))(item);
      // T073 (Q4 (a)): one closing, read as step 1 reads it, for both fields. The window is read only
      // when a closing needs it, through the one function with the closing's kind: the hold's end,
      // `restorableUntil` (`@deprecated`, step 2 retired) for every closing step 1 admits with its
      // case open, a release leaving it; `slotHeldUntil` while the slot was not released (T070).
      const hold = slotHoldOf(item.status, enrollmentEvents, cases);
      const until =
        hold.closing === undefined || !hold.closing.restorable
          ? undefined
          : await restorableUntil(
              hold.closing.closingCase.createdAt,
              hold.closing.kind,
              windowDaysOf(settings),
            );
      const heldUntil = hold.releasedAt === undefined ? until : undefined;
      const proposalTime = { startTimeLocal: slot.startTimeLocal, timezone: terms.timezone };
      return {
        enrollment: {
          ...summary,
          ...(until === undefined ? {} : { restorableUntil: until.toISOString() }),
          // T070: the slot's hold and its release (FR-503).
          ...(heldUntil === undefined ? {} : { slotHeldUntil: heldUntil.toISOString() }),
          ...(hold.releasedAt === undefined
            ? {}
            : { slotReleasedAt: hold.releasedAt.toISOString() }),
        },
        sessions: sessions.map(
          (session): MonitorSession => ({
            sessionId: session.id,
            sequenceNumber: session.sequenceNumber,
            ...(session.makeupFor === null ? {} : { makeupFor: session.makeupFor }),
            localDate: session.localDate,
            startTimeLocal: hoursAndMinutes(session.startTimeLocal),
            timezone: session.timezone,
            startsAt: session.startsAt.toISOString(),
            endsAt: session.endsAt.toISOString(),
            status: session.status,
            ...(session.outcomeUnderDispute === undefined
              ? {}
              : { outcomeUnderDispute: session.outcomeUnderDispute }),
            cancellable: session.status === 'scheduled',
            correctable: isCorrectable(
              {
                status: session.status,
                scheduledEndAt: session.endsAt,
                hasRemedy: session.remedy !== null,
                everDisputed: disputed.has(session.id),
              },
              { now, disputeWindowHours: windowHours },
            ),
            ...(session.remedy === null
              ? {}
              : { remedy: remedyOf(session.remedy, proposalTime, now) }),
          }),
        ),
        cases: cases.map(({ caseId, reason, status }) => ({
          caseId,
          // A closed list in code (`COMPENSATION_REASONS`); the output's schema checks it.
          reason: reason as SessionsMonitorGetOutput['cases'][number]['reason'],
          status,
        })),
        cancellationRequests: requests.map((request) => ({
          requestId: request.id,
          sessionId: request.sessionId,
          requestedBy: request.requestedBy,
          reason: request.reason,
          status: request.status,
          createdAt: request.createdAt.toISOString(),
          ...(request.respondedAt === null ? {} : { respondedAt: request.respondedAt.toISOString() }),
        })),
        events: timelineOf(sessionEvents, enrollmentEvents),
      };
    },
  };
}
