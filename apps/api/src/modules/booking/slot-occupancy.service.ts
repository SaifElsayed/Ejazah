// T026 (R-205, FR-394, FR-BOOK-10; the note under T026): a slot's occupancy, the one rule both
// catalog's question (`slotInUse`, through the `CatalogUse` port) and discovery's offer read.
//
// A slot is taken while an active hold or an enrollment `pending_payment` uses it. A `confirmed`
// enrollment holds it on every local date before its release, the week after its final session plus
// `slot_release_buffer_weeks`: the release date is the final session's local date plus that many
// weeks and one more, on the wall calendar (`calendarWeeksAfter`, R-TIME-2), read in the zone the
// enrollment snapshot its slot in. The final session's date is the sessions module's
// (`lastSessionDateOf`), so booking never reads that table (R-API-6). A confirmed enrollment whose
// last session cannot be read keeps its slot taken: the side that refuses a teacher's edit, and
// offers nothing, rather than the side that double-books.
//
// No lock: discovery only reads, and `slotInUse`'s callers lock before they ask (T005's rule 1).
import { calendarWeeksAfter, type LocalDate, localDateIn, type TimeZoneId } from '@ijazah/time';
import { z } from 'zod';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { lastSessionDateOf } from '../sessions/index.js';
import { slotUses } from './slot-occupancy.repository.js';

/** The weeks a slot stays held after the week following its final session (FR-BOOK-10). */
export const SLOT_RELEASE_BUFFER_SETTING = 'slot_release_buffer_weeks';

/** The buffer's schema: whole weeks, zero included (the default, SRS §3.14). */
export const slotReleaseBufferWeeks = z.int().nonnegative();

/** What booking's rows say uses a slot (`slot-occupancy.repository.ts`). */
export interface SlotUse {
  readonly slotId: string;
  /** An active hold or an enrollment awaiting payment uses it. */
  readonly taken: boolean;
  /** Its confirmed enrollments, each with the zone it snapshot the slot in. */
  readonly confirmed: readonly { readonly enrollmentId: string; readonly timezone: TimeZoneId }[];
}

/**
 * A used slot: taken on every date, or held by confirmed enrollments until `releasedOn`, a local
 * date in `timezone`. A slot nothing uses has no occupancy.
 */
export type SlotOccupancy =
  | { readonly kind: 'taken' }
  | { readonly kind: 'until'; readonly releasedOn: LocalDate; readonly timezone: TimeZoneId };

/** The first local date a confirmed enrollment no longer holds its slot (FR-394). */
export function releaseDateOf(lastSessionDate: LocalDate, bufferWeeks: number): LocalDate {
  return calendarWeeksAfter(lastSessionDate, bufferWeeks + 1);
}

/** A slot's occupancy from its use and its confirmed enrollments' final session dates. */
export function occupancyFrom(
  use: SlotUse,
  lastSessionDates: ReadonlyMap<string, LocalDate>,
  bufferWeeks: number,
): SlotOccupancy | undefined {
  if (use.taken) return { kind: 'taken' };
  let latest: SlotOccupancy | undefined;
  for (const { enrollmentId, timezone } of use.confirmed) {
    const last = lastSessionDates.get(enrollmentId);
    if (last === undefined) return { kind: 'taken' };
    const releasedOn = releaseDateOf(last, bufferWeeks);
    if (latest === undefined || (latest.kind === 'until' && releasedOn > latest.releasedOn)) {
      latest = { kind: 'until', releasedOn, timezone };
    }
  }
  return latest;
}

/** Whether a slot of `occupancy` is free on `localDate` (canonical dates order as text). */
export function isFreeOn(occupancy: SlotOccupancy | undefined, localDate: LocalDate): boolean {
  if (occupancy === undefined) return true;
  return occupancy.kind === 'until' && localDate >= occupancy.releasedOn;
}

type Client = Pick<Transaction, 'slotHold' | 'enrollment' | 'session'>;

/**
 * Of `slotIds`, each used slot's occupancy; a free slot is absent. The buffer is read only when a
 * confirmed enrollment needs its release, so a free or a taken slot costs no settings read.
 */
export async function occupancyOf(
  tx: Client,
  slotIds: readonly string[],
  bufferWeeks: () => Promise<number>,
): Promise<ReadonlyMap<string, SlotOccupancy>> {
  const uses = [...(await slotUses(tx, slotIds)).values()];
  const confirmedIds = uses.flatMap(({ taken, confirmed }) =>
    taken ? [] : confirmed.map(({ enrollmentId }) => enrollmentId),
  );
  const [lastDates, buffer] =
    confirmedIds.length === 0
      ? [new Map<string, LocalDate>(), 0]
      : await Promise.all([lastSessionDateOf(tx, confirmedIds), bufferWeeks()]);
  const occupancy = new Map<string, SlotOccupancy>();
  for (const use of uses) {
    const occupied = occupancyFrom(use, lastDates, buffer);
    if (occupied !== undefined) occupancy.set(use.slotId, occupied);
  }
  return occupancy;
}

/** The clock and the buffer R-205's release reads; the buffer only when it is needed. */
export interface SlotRelease {
  readonly now: () => Date;
  readonly bufferWeeks: () => Promise<number>;
}

/**
 * Whether a hold or an enrollment uses the slot now (T020, R-207, FR-318), with R-205's release: a
 * confirmed enrollment uses it until its release date begins in the zone it snapshot the slot in.
 */
export async function slotInUse(
  tx: Client,
  slotId: string,
  release: SlotRelease,
): Promise<boolean> {
  const occupancy = (await occupancyOf(tx, [slotId], release.bufferWeeks)).get(slotId);
  if (occupancy === undefined) return false;
  if (occupancy.kind === 'taken') return true;
  return !isFreeOn(occupancy, localDateIn(release.now(), occupancy.timezone));
}
