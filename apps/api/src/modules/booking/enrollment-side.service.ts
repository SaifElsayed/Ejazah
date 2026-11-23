// T008 of specs/004-sessions/tasks.md (research R-301, R-322, R-323 GAP-1; the third analysis, U3;
// contracts/kernel.md, "The composition root"): booking's implementation of sessions' `EnrollmentSide`
// port (`modules/sessions/enrollment-side.port.ts`), bound once by `main.ts` and `worker.ts` (T015
// writes that binding: the owner's decision of 2026-11-07 on lane C's questions). Booking
// owns `enrollments` and `enrollment_events` and is the only writer of both (R-API-6), so every
// status move sessions asks for is written here, with its one `enrollment_events` row through
// booking's one writer, on the caller's transaction.
//
// THE MOVES (data-model.md §3, "Enrollment, this phase's moves"):
//   terminateNoShow  confirmed → terminated_no_show                     `terminated_no_show`
//   complete         confirmed → completed                              `completed`
//   restore          terminated_no_show, or cancelled `admin` or `teacher_suspended` (T073)
//                    → confirmed `restored` (`cancellation_reason` and `slot_released_at`
//                    cleared, `confirmed_at` untouched and required, R-322)
//   cancel 'admin'   confirmed → cancelled `admin`                      `cancelled` with `admin`
//                    (T082: with a direct end's reason, `admin_end_reason` written too)
// Each is one conditional update from its source states: the row the caller read under its lock is
// still in one of them, or the move changes nothing, writes no row and answers `false` for the
// caller to refuse and log. A row's `occurred_at` is this side's clock at the move.
//
// RESTORE'S WRITE (T008's follow-up, the owner's decision of 2026-11-07). The three moves from
// `confirmed` go through the store's `moveEnrollment`, whose target can never be `confirmed`;
// restore calls `restoreEnrollment` itself, not through the store, since the confirmation gate
// (`tests/pipeline/confirmation-path.spec.ts`, R-HONEST-1) allows that writer's one reach inside
// `restore` only, so the injectable store holds no writer of a confirmed enrollment.
//
// THE LOCKS. `lockEnrollments` takes the enrollments' rows through the kernel's `lockRows`, the one
// lock any function here names. The moves take none of their own: their update touches the row the
// caller holds, and their event row references only that enrollment. The reads take none: the
// callers of `slotWeekTaken` and `heldTimesOf` hold both accounts first (T005's rule 2).
//
// THE SLOT AND THE HOLDS (the owner's decision of 2026-11-07 on lane C's questions). A hold is
// active while `released_at` is NULL, even past `expires_at` (`holds.repository.ts`), since a late
// paid event can still convert it; spec.md's edge case says «an unexpired hold», and the owner chose
// active. `slotWeekTaken` is R-205's occupancy (`slot-occupancy.service.ts`) without the asking
// enrollment's own use: any active hold, or another enrollment awaiting payment or confirmed, takes
// the slot on every date, and a completed one until its release (the owner's rule of 2026-11-10: a
// package's slot returns only once it is completed). `slotsFreeFrom` reads the same for many slots
// at once (T031's counter options). `heldTimesOf` reads a student's own holds and, for a
// teacher, the holds on every slot of the teacher (catalog's entry, active or not); each hold's
// occurrences are its `session_count` weeks of its slot from the first at least
// `first_session_lead_hours` after the read's instant, together with those from the first at least
// that lead after its `expires_at` (the dates generation writes at a confirmation, FR-368), so a
// confirmation anywhere inside its payment window is covered. Only those overlapping the window are
// answered, once each, by start.
//
// 006:T005 of specs/006-programme (U-1, N-12): `programmeTimesOf` answers the weekly times of the
// students' active programmes (`programmes.service.ts`), the asking enrollment's own left out, so
// sessions' make-up proposal, counter options and a postponement's placement never land on them.
//
// 006:T008 of specs/006-programme (R-510; B-P2's conflict check, Q-2 (a), the owner, 2026-11-23):
// THE PROGRAMME BEFORE THE ENROLLMENT. `lockEnrollments` takes the enrollments' programmes' rows
// (`lockRows(tx, 'programmes', …)`, keyed by `enrollment_id`; none for an enrollment that is no
// programme), then the enrollments', kernel.md's one order (006:T008's row), so every sessions path
// that ends an enrollment through this port holds the programme before the enrollment. Each of
// `terminateNoShow`, `complete` and `cancel` that moved its enrollment then runs booking's close
// hook (`programme-close.service.ts`) with the move as its reason: the programme `closed`, its open
// items `withdrawn`, payments' `deleteProgrammeCard` called (a stub until T013), one line. The
// composition root binds payments' entry and the log (`programmes`); where it binds none yet, no card
// is deleted (none exists before T013) and no line is written (the follow-up under T013).
import { type DayOfWeek, firstOccurrenceAfter, type LocalDate } from '@ijazah/time';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { LockedTable } from '../../platform/db/row-lock.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { readSlot, type SlotRow, teacherSlotsOf } from '../catalog/index.js';
import {
  type EnrollmentEventEntry,
  type EnrollmentPageFilter,
  type EnrollmentPageItem,
  type EnrollmentSide,
  type EnrollmentTerms,
  type HeldTime,
  type WindowDays,
  windowDaysOf,
} from '../sessions/index.js';
import { type EnrollmentOutcome, recordEnrollmentEvents } from './enrollment-events.repository.js';
import {
  type ActiveHold,
  activeHoldsAmong,
  enrollmentEventsOf,
  enrollmentsPage,
  enrollmentTermsById,
  lockRows,
  moveEnrollment,
  type MoveTarget,
  restoreEnrollment,
} from './enrollment-side.repository.js';
import { FIRST_SESSION_LEAD_SETTING, firstSessionLeadHours } from './nearest-slot.service.js';
import {
  closeProgrammes,
  noProgrammeCardYet,
  type ProgrammeCloseDependencies,
} from './programme-close.service.js';
import { programmeTimesOf } from './programmes.service.js';
import { packageSessionsOn } from './session-overlap.service.js';
import {
  isFreeOn,
  type OccupancyReads,
  occupancyOf,
  SLOT_RELEASE_BUFFER_SETTING,
  type SlotOccupancy,
  slotReleaseBufferWeeks,
} from './slot-occupancy.service.js';
import { type HeldRelease, releaseHeldSlot } from './slot-release.service.js';

/** The page size of every admin list (SRS §3.14, FR-412). */
export const LIST_PAGE_SIZE_SETTING = 'admin_list_page_size';

const positiveWhole = z.int().positive();

/** What the port's functions read and write, each on the caller's transaction. */
export interface EnrollmentSideStore {
  enrollmentTermsById(tx: Transaction, id: string): Promise<EnrollmentTerms | null>;
  lockRows(tx: Transaction, table: LockedTable, ids: readonly string[]): Promise<void>;
  /** A move from `confirmed`; never to it (`restoreEnrollment`, outside the store, alone is). */
  moveEnrollment(tx: Transaction, id: string, target: MoveTarget): Promise<boolean>;
  recordEnrollmentEvents(tx: Transaction, outcomes: readonly EnrollmentOutcome[]): Promise<void>;
  enrollmentEventsOf(tx: Transaction, enrollmentId: string): Promise<EnrollmentEventEntry[]>;
  enrollmentsPage(
    tx: Transaction,
    filter: EnrollmentPageFilter,
    cursor: string | undefined,
    take: number,
  ): Promise<EnrollmentPageItem[]>;
  occupancyOf(
    tx: Transaction,
    slotIds: readonly string[],
    reads: OccupancyReads,
    exceptEnrollmentId: string,
  ): Promise<ReadonlyMap<string, SlotOccupancy>>;
  activeHoldsAmong(
    tx: Transaction,
    scope: { readonly studentUserIds: readonly string[]; readonly slotIds: readonly string[] },
  ): Promise<ActiveHold[]>;
  /**
   * T082 (Q-R15 (a)): the release's core (`slot-release.service.ts`), its window read through the
   * reads handed in.
   */
  releaseHeld(tx: Transaction, enrollmentId: string, windowDays: WindowDays): Promise<HeldRelease>;
  /** Every slot of the teacher, active or not (catalog's entry); none for a student. */
  teacherSlotsOf(tx: Transaction, teacherUserId: string): Promise<SlotRow[]>;
  /** A slot by its id, active or not (catalog's entry). */
  readSlot(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  /** 006:T005: the students' active programmes' weekly times (`programmes.service.ts`). */
  programmeTimesOf(
    tx: Transaction,
    studentUserIds: readonly string[],
    window: { readonly from: Date; readonly to: Date },
    exceptEnrollmentId: string,
  ): Promise<readonly HeldTime[]>;
}

/** Booking's repositories and catalog's entry, as `createEnrollmentSide` uses them by default. */
export const enrollmentSideStore: EnrollmentSideStore = {
  enrollmentTermsById,
  lockRows,
  moveEnrollment,
  recordEnrollmentEvents,
  enrollmentEventsOf,
  enrollmentsPage,
  occupancyOf,
  activeHoldsAmong,
  teacherSlotsOf,
  readSlot,
  releaseHeld: (tx, enrollmentId, windowDays) => releaseHeldSlot(tx, enrollmentId, { windowDays }),
  programmeTimesOf: (tx, studentUserIds, window, exceptEnrollmentId) =>
    programmeTimesOf(tx, studentUserIds, window, { exceptEnrollmentId }),
};

/** `userIds` once each, in id order. */
function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** Whether `[startsAt, endsAt)` overlaps `window`; a range holds its start and not its end. */
function overlaps(time: HeldTime, window: { readonly from: Date; readonly to: Date }): boolean {
  return time.startsAt < window.to && window.from < time.endsAt;
}

/** The hold's occurrences from the first at least `leadHours` after each of `from`. */
function occurrencesOf(
  slot: SlotRow,
  hold: ActiveHold,
  from: readonly Date[],
  leadHours: number,
): HeldTime[] {
  // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37); the package asserts it.
  const recurring = { ...slot, dayOfWeek: slot.dayOfWeek as DayOfWeek };
  return from.flatMap((instant) =>
    packageSessionsOn(
      slot,
      firstOccurrenceAfter(recurring, instant, leadHours),
      hold.sessionCount,
    ).map(({ startsAt, endsAt }) => ({ startsAt: new Date(startsAt), endsAt: new Date(endsAt) })),
  );
}

/** 006:T008: a close hook that writes no line, where the composition root binds no log yet. */
const SILENT: Pick<Logger, 'info'> = { info: () => undefined };

/** Sessions' `EnrollmentSide` over booking's rows (T008), bound once by the composition root. */
export function createEnrollmentSide({
  settings,
  now = () => new Date(),
  store = enrollmentSideStore,
  programmes = { deleteProgrammeCard: noProgrammeCardYet, log: SILENT },
}: {
  readonly settings: SettingsReader;
  readonly now?: () => Date;
  readonly store?: EnrollmentSideStore;
  /** 006:T008 (Q-2 (a)): the close hook's payments' entry and log, bound by the composition root. */
  readonly programmes?: ProgrammeCloseDependencies;
}): EnrollmentSide {
  // R-205's buffer, and (T070) the window of a closing's hold, each read only when it is needed.
  const reads: OccupancyReads = {
    bufferWeeks: () => settings.read(SLOT_RELEASE_BUFFER_SETTING, slotReleaseBufferWeeks),
    windowDays: windowDaysOf(settings),
  };
  /** Only when the update moved the row, writes its one `enrollment_events` row. */
  const recorded = async (
    tx: Transaction,
    moved: Promise<boolean>,
    outcome: (occurredAt: Date) => EnrollmentOutcome,
  ): Promise<boolean> => {
    if (!(await moved)) return false;
    await store.recordEnrollmentEvents(tx, [outcome(now())]);
    return true;
  };
  /**
   * A move from `confirmed`, through the store; 006:T008: once moved, the close hook with the move's
   * reason (this file's head).
   */
  const move = async (
    tx: Transaction,
    id: string,
    target: MoveTarget,
    outcome: (occurredAt: Date) => EnrollmentOutcome,
  ): Promise<boolean> => {
    if (!(await recorded(tx, store.moveEnrollment(tx, id, target), outcome))) return false;
    await closeProgrammes(tx, [id], target.cancellationReason ?? target.status, programmes);
    return true;
  };
  /** The restore, through `restoreEnrollment` itself: the gate's one reach of it (this file's head). */
  const restore: EnrollmentSide['restore'] = (tx, id) =>
    recorded(tx, restoreEnrollment(tx, id), (occurredAt) => ({
      kind: 'restored',
      enrollmentId: id,
      occurredAt,
    }));
  return {
    enrollmentFor: (tx, id) => store.enrollmentTermsById(tx, id),
    // 006:T008 (Q-2 (a)): the programmes before the enrollments (this file's head).
    lockEnrollments: async (tx, ids) => {
      await store.lockRows(tx, 'programmes', ids);
      await store.lockRows(tx, 'enrollments', ids);
    },
    terminateNoShow: (tx, id) =>
      move(tx, id, { status: 'terminated_no_show', cancellationReason: null }, (occurredAt) => ({
        kind: 'terminated_no_show',
        enrollmentId: id,
        occurredAt,
      })),
    complete: (tx, id) =>
      move(tx, id, { status: 'completed', cancellationReason: null }, (occurredAt) => ({
        kind: 'completed',
        enrollmentId: id,
        occurredAt,
      })),
    restore,
    cancel: (tx, id, reason, partyReason) =>
      move(
        tx,
        id,
        {
          status: 'cancelled',
          cancellationReason: reason,
          ...(partyReason === undefined ? {} : { adminEndReason: partyReason }),
        },
        (occurredAt) => ({
          kind: 'cancelled',
          enrollmentId: id,
          cancellationReason: reason,
          occurredAt,
        }),
      ),
    slotWeekTaken: async (tx, slotId, localDate: LocalDate, enrollmentId) => {
      const occupancy = await store.occupancyOf(tx, [slotId], reads, enrollmentId);
      return !isFreeOn(occupancy.get(slotId), localDate);
    },
    slotsFreeFrom: async (tx, slotIds, enrollmentId) => {
      const occupancy = await store.occupancyOf(tx, slotIds, reads, enrollmentId);
      return new Map(
        [...occupancy].map(([slotId, used]) => [
          slotId,
          used.kind === 'taken' ? null : used.releasedOn,
        ]),
      );
    },
    heldTimesOf: async (tx, userIds, window) => {
      const users = sortedUnique(userIds);
      if (users.length === 0) return [];
      const slots = new Map<string, SlotRow>();
      for (const userId of users) {
        for (const slot of await store.teacherSlotsOf(tx, userId)) slots.set(slot.id, slot);
      }
      const holds = await store.activeHoldsAmong(tx, {
        studentUserIds: users,
        slotIds: [...slots.keys()].sort(),
      });
      if (holds.length === 0) return [];
      const leadHours = await settings.read(FIRST_SESSION_LEAD_SETTING, firstSessionLeadHours);
      const readAt = now();
      const times = new Map<string, HeldTime>();
      for (const hold of holds) {
        const slot = slots.get(hold.slotId) ?? (await store.readSlot(tx, hold.slotId));
        if (slot === null) throw new Error('heldTimesOf: an active hold without its slot');
        slots.set(slot.id, slot);
        for (const time of occurrencesOf(slot, hold, [readAt, hold.expiresAt], leadHours)) {
          if (overlaps(time, window)) {
            times.set(`${String(time.startsAt.getTime())}/${String(time.endsAt.getTime())}`, time);
          }
        }
      }
      return [...times.values()].sort(
        (one, other) => one.startsAt.getTime() - other.startsAt.getTime(),
      );
    },
    // T082 (Q-R15 (a)): the release's core for a direct end, its instant or null when not held.
    releaseHeldSlot: async (tx, id) => {
      const outcome = await store.releaseHeld(tx, id, reads.windowDays);
      return outcome.released ? outcome.at : null;
    },
    // 006:T005 (U-1, N-12): the students' active programmes' weekly times, the asker's left out.
    programmeTimesOf: (tx, studentUserIds, window, exceptEnrollmentId) =>
      store.programmeTimesOf(tx, studentUserIds, window, exceptEnrollmentId),
    eventsOf: (tx, enrollmentId) => store.enrollmentEventsOf(tx, enrollmentId),
    enrollmentPage: async (tx, filter, cursor, batchSize) => {
      // A batch the caller sizes (T024's name search, Q3) reads no setting.
      const pageSize =
        batchSize === undefined
          ? await settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole)
          : positiveWhole.parse(batchSize);
      const rows = await store.enrollmentsPage(tx, filter, cursor, pageSize + 1);
      const items = rows.slice(0, pageSize);
      const last = items.at(-1);
      return rows.length > pageSize && last !== undefined
        ? { items, nextCursor: last.enrollmentId }
        : { items };
    },
  };
}
