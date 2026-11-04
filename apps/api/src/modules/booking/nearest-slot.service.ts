// T026 (R-205, FR-335, FR-368): the discovery card's nearest free slot, computed by booking for the
// teachers of one page (at most `discovery_page_size`).
//
// Of the page's teachers, only those the predicate admits for booking with the requester's gender
// (`visibleTeachers`, `purpose: 'book'`, R-201, T143) have a nearest slot: a teacher whose account
// must verify stays on the page and offers no slot. Their offered slots are catalog's (the active
// slots of their active packages' lengths, through its entry, R-API-6). On each, the first session a
// student would get now is `firstOccurrenceAfter` with `first_session_lead_hours`, resolved in the
// slot's own zone (R-TIME-1, R-209); the slot is offerable when its occupancy leaves it free on that
// session's local date (`slot-occupancy.service.ts`), which offers a confirmed enrollment's slot
// again from the week after its final session plus the buffer (FR-394). The teacher's nearest is the
// earliest such instant, with the zone of its slot. Read-only: no lock (T005's rule 1).
import {
  type DayOfWeek,
  firstOccurrenceAfter,
  type Occurrence,
  type TimeZoneId,
  type UtcInstant,
} from '@ijazah/time';
import { z } from 'zod';

import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { type OfferedSlot, offeredSlotsOf } from '../catalog/index.js';
import { visibleTeachers } from '../identity/index.js';
import {
  occupancyOf,
  isFreeOn,
  SLOT_RELEASE_BUFFER_SETTING,
  type SlotOccupancy,
  slotReleaseBufferWeeks,
} from './slot-occupancy.service.js';

/** The hours between now and the first session a booking may get (FR-368, FR-386). */
export const FIRST_SESSION_LEAD_SETTING = 'first_session_lead_hours';

/** The lead's schema: whole hours, zero included. */
export const firstSessionLeadHours = z.int().nonnegative();

/** A card's nearest free slot: its first session's instant and the slot's zone (R-TIME-6). */
export interface NearestSlot {
  readonly startsAt: UtcInstant;
  readonly timezone: TimeZoneId;
}

/** When the first session is counted from, and the lead before it. */
export interface FirstSessionRule {
  readonly now: Date;
  readonly leadHours: number;
}

/**
 * A slot's first session by FR-368's rule, in the slot's own zone: the sheet's, the card's and, for
 * the held slot, `checkout.current`'s (T085).
 */
export function firstSessionOf(
  slot: Pick<OfferedSlot, 'dayOfWeek' | 'startTimeLocal' | 'durationMinutes' | 'timezone'>,
  rule: FirstSessionRule,
): Occurrence {
  return firstOccurrenceAfter(
    // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37); the package asserts it.
    { ...slot, dayOfWeek: slot.dayOfWeek as DayOfWeek },
    rule.now,
    rule.leadHours,
  );
}

/** The offered slots free on their first session's date, each with that session (R-205). */
export function offerableOccurrences(
  slots: readonly OfferedSlot[],
  occupancy: ReadonlyMap<string, SlotOccupancy>,
  rule: FirstSessionRule,
): readonly { readonly slot: OfferedSlot; readonly first: Occurrence }[] {
  return slots
    .map((slot) => ({ slot, first: firstSessionOf(slot, rule) }))
    .filter(({ slot, first }) => isFreeOn(occupancy.get(slot.id), first.requestedLocalDate));
}

/** Each teacher's earliest offerable first session (canonical UTC instants order as text). */
export function nearestFreeOf(
  slots: readonly OfferedSlot[],
  occupancy: ReadonlyMap<string, SlotOccupancy>,
  rule: FirstSessionRule,
): ReadonlyMap<string, NearestSlot> {
  const nearest = new Map<string, NearestSlot>();
  for (const { slot, first } of offerableOccurrences(slots, occupancy, rule)) {
    const known = nearest.get(slot.teacherUserId);
    if (known === undefined || first.startsAt < known.startsAt) {
      nearest.set(slot.teacherUserId, { startsAt: first.startsAt, timezone: slot.timezone });
    }
  }
  return nearest;
}

/** The first-session rule with the buffer read only when a confirmed enrollment needs it. */
export interface DiscoveryClock extends FirstSessionRule {
  readonly bufferWeeks: () => Promise<number>;
}

/**
 * Of `teacherIds` (one page), the nearest free slot of each teacher the requester may book, on the
 * caller's transaction; a teacher with none is absent.
 */
export async function nearestFreeSlots(
  tx: Transaction,
  requester: RequesterGender,
  teacherIds: readonly string[],
  clock: DiscoveryClock,
): Promise<ReadonlyMap<string, NearestSlot>> {
  const bookable = await visibleTeachers(tx, requester, { purpose: 'book', teacherIds });
  const slots = await offeredSlotsOf(
    tx,
    bookable.map(({ id }) => id),
  );
  const occupancy = await occupancyOf(
    tx,
    slots.map(({ id }) => id),
    clock.bufferWeeks,
  );
  return nearestFreeOf(slots, occupancy, clock);
}

/** Booking's nearest slots for a page, as the discovery service asks them. */
export interface NearestSlots {
  of(
    requester: RequesterGender,
    teacherIds: readonly string[],
  ): Promise<ReadonlyMap<string, NearestSlot>>;
}

/**
 * The nearest slots over the process's client: the lead read first, the reads in one transaction,
 * the buffer only when a confirmed enrollment needs its release.
 */
export function createNearestSlots({
  database,
  settings,
  now = () => new Date(),
}: {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly now?: () => Date;
}): NearestSlots {
  const transactions = transactionsOver(database);
  return {
    of: async (requester, teacherIds) => {
      if (teacherIds.length === 0) return new Map();
      const leadHours = await settings.read(FIRST_SESSION_LEAD_SETTING, firstSessionLeadHours);
      const clock: DiscoveryClock = {
        now: now(),
        leadHours,
        bufferWeeks: () => settings.read(SLOT_RELEASE_BUFFER_SETTING, slotReleaseBufferWeeks),
      };
      return transactions.run((tx) => nearestFreeSlots(tx, requester, teacherIds, clock));
    },
  };
}
