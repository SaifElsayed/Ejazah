// T027 of specs/004-sessions/tasks.md (FR-466; research R-311, "Reservation"; R-320, H3; plan.md
// decision 2; the notes under T027, Q1 (a), Q7 (a), Q12 (a)): `reservedTimesOf`, the times open
// remedies reserve for some people, which every path placing a session or a hold reads as occupied:
// booking's one overlap check (`booking.slots` and `checkout.hold`), the confirmation's new hold for
// a released one, the make-up's proposal and counter options, and a make-up's booking.
//
// THE TIMES. The system's proposal, from the offer until the remedy settles: its `proposed_date` at
// the enrollment's slot's local start, in the enrollment's zone (the monitor's reading,
// `sessions-monitor.service.ts`; Q1 (a) keeps that slot from moving while the remedy is open), for
// the enrollment's session length. A pending counter-proposal, during its answer window only
// (`answerClosesAt`, D1, compared with the database's clock, Q8): its own date, start and zone. Each
// is resolved on its own date by `packages/time` (R-TIME-2), never by adding weeks, and carries its
// remedy and session (Q7 (a)), so a caller booking a remedy's own proposal or counter drops that
// remedy's times and still refuses another's. A `frozen` remedy reserves nothing (the query).
//
// NO LOCK, NO WRITE. The enrollment's terms come from the caller's `EnrollmentSide` (sessions reads
// no booking table, R-API-6), the slot from catalog's entry. A caller that decides on the answer
// holds both accounts' locks first (`003:T005`'s rule 2): `checkout.hold` and the confirmation do;
// `booking.slots` takes none, being a preview the hold decides again (Q12 (a)).
import { addMinutes, calendarDateOf, localTimeOf, resolveLocalDateTime } from '@ijazah/time';

import { clockTimestamp } from '../../platform/db/db-clock.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { readSlot, type SlotRow } from '../catalog/index.js';
import type { EnrollmentSide, EnrollmentTerms } from './enrollment-side.port.js';
import { answerClosesAt } from './remedy-deadlines.js';
import { type ReservingRemedyRow, reservingRemediesOf } from './reservations.repository.js';

/** One reserved time: its remedy, its session, and `[startsAt, endsAt)` (Q7 (a)). */
export interface ReservedTime {
  readonly remedyId: string;
  readonly sessionId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** What `reservedTimesOf` asks of booking: the enrollment's terms (`EnrollmentSide.enrollmentFor`). */
export type ReservationReads = Pick<EnrollmentSide, 'enrollmentFor'>;

/** Sessions' rows, catalog's slot and the database's clock; faked in a spec. */
export interface ReservationStore {
  reservingRemediesOf(
    tx: Transaction,
    userIds: readonly string[],
  ): Promise<readonly ReservingRemedyRow[]>;
  slotOf(tx: Transaction, slotId: string): Promise<SlotRow | null>;
  clock(tx: Transaction): Promise<Date>;
}

export const reservationStore: ReservationStore = {
  reservingRemediesOf,
  slotOf: readSlot,
  clock: clockTimestamp,
};

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** The time a local date and start in a zone resolve to, for `minutes` (R-TIME-2). */
function timeOn(
  localDate: Date,
  localTime: string,
  timezone: string,
  minutes: number,
): { readonly startsAt: Date; readonly endsAt: Date } {
  const { startsAt } = resolveLocalDateTime({
    localDate: calendarDateOf(localDate),
    localTime,
    timezone,
  });
  const start = new Date(startsAt);
  return { startsAt: start, endsAt: new Date(addMinutes(start, minutes)) };
}

/** Whether `[startsAt, endsAt)` overlaps `window`; a range holds its start and not its end. */
function overlaps(
  time: { readonly startsAt: Date; readonly endsAt: Date },
  window: { readonly from: Date; readonly to: Date },
): boolean {
  return time.startsAt < window.to && window.from < time.endsAt;
}

/** Each of `ids` read once, concurrently, into a map; an absent one throws (`what` names it). */
async function readEach<T>(
  ids: readonly string[],
  read: (id: string) => Promise<T | null>,
  what: string,
): Promise<ReadonlyMap<string, T>> {
  const pairs = await Promise.all(ids.map(async (id) => [id, await read(id)] as const));
  const found = new Map<string, T>();
  for (const [id, value] of pairs) {
    if (value === null) throw new Error(`reservedTimesOf: ${what} ${id} is not there to read`);
    found.set(id, value);
  }
  return found;
}

/**
 * The times reserved for `userIds` that overlap `window`, by start (this file's head). Takes no
 * lock; a caller deciding on the answer holds both accounts' locks first.
 */
export async function reservedTimesOf(
  tx: Transaction,
  userIds: readonly string[],
  window: { readonly from: Date; readonly to: Date },
  reads: ReservationReads,
  store: ReservationStore = reservationStore,
): Promise<readonly ReservedTime[]> {
  const users = sortedUnique(userIds);
  if (users.length === 0) return [];
  const rows = await store.reservingRemediesOf(tx, users);
  if (rows.length === 0) return [];
  const terms = await readEach<EnrollmentTerms>(
    sortedUnique(rows.map(({ enrollmentId }) => enrollmentId)),
    (id) => reads.enrollmentFor(tx, id),
    'enrollment',
  );
  const proposing = rows.filter(({ proposedDate }) => proposedDate !== null);
  const [slots, now] = await Promise.all([
    readEach<SlotRow>(
      sortedUnique(proposing.map(({ enrollmentId }) => terms.get(enrollmentId)?.slotId ?? '')),
      (id) => store.slotOf(tx, id),
      'slot',
    ),
    rows.some(({ counter }) => counter !== null) ? store.clock(tx) : Promise.resolve(undefined),
  ]);
  const times: ReservedTime[] = [];
  for (const row of rows) {
    const enrollment = terms.get(row.enrollmentId);
    if (enrollment === undefined) continue;
    const named = { remedyId: row.remedyId, sessionId: row.sessionId };
    const slot = slots.get(enrollment.slotId);
    if (row.proposedDate !== null && slot !== undefined) {
      times.push({
        ...named,
        ...timeOn(
          row.proposedDate,
          slot.startTimeLocal,
          enrollment.timezone,
          enrollment.durationMinutes,
        ),
      });
    }
    const { counter } = row;
    if (
      counter !== null &&
      now !== undefined &&
      now.getTime() <
        answerClosesAt({
          counterProposedAt: counter.proposedAt,
          snapshotAnswerWindowHours: row.snapshotAnswerWindowHours,
        }).getTime()
    ) {
      times.push({
        ...named,
        ...timeOn(
          counter.date,
          localTimeOf(counter.startTimeLocal),
          counter.timezone,
          enrollment.durationMinutes,
        ),
      });
    }
  }
  return times
    .filter((time) => overlaps(time, window))
    .sort((one, other) => one.startsAt.getTime() - other.startsAt.getTime());
}
