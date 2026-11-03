// T033 (FR-351, FR-BOOK-5, R-205; PR #118's review, round 1, Minor 2; B29's conflict check,
// 2026-11-03): the one overlap check the hold and the booking sheet share, so the sheet never offers
// a slot the hold would refuse.
//
// A slot is checked by every one of the package's sessions on it, not its first alone: the first by
// FR-368's rule (`firstOccurrenceAfter`, the caller's), the rest the package's count of consecutive
// weeks from it by `resolveOccurrences`, the dates generation writes (R-209). Each is checked against
// the student's and the teacher's own sessions (FR-BOOK-5's two axes), read through the sessions
// module's entry once over the window every candidate's sessions span (R-API-6). A range holds its
// start and not its end, as the database's exclusions read it (ERD §15 rule 19), so sessions that
// only touch do not overlap. No date is computed here (R-TIME-1); instants are only compared.
//
// No lock and no write: the sheet only reads, and the hold calls this under its locks (T005).
import { type DayOfWeek, type LocalTime, type Occurrence, resolveOccurrences } from '@ijazah/time';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { SessionTime } from '../sessions/index.js';

/** The two people whose sessions a booking must not overlap (FR-BOOK-5). */
export interface SessionParties {
  readonly studentUserId: string;
  readonly teacherUserId: string;
}

/** A slot as `packages/time` resolves it: weekday, local start, length and zone. */
export interface PackageSlot {
  readonly dayOfWeek: number;
  readonly startTimeLocal: LocalTime;
  readonly durationMinutes: number;
  readonly timezone: string;
}

/** The sessions module's read of both parties' sessions holding time in a window. */
export type SessionsBetween = (
  tx: Transaction,
  parties: SessionParties,
  window: { readonly from: Date; readonly to: Date },
) => Promise<readonly SessionTime[]>;

/** The package's sessions on the slot: `sessionCount` consecutive weeks from `first` (R-209). */
export function packageSessionsOn(
  slot: PackageSlot,
  first: Occurrence,
  sessionCount: number,
): readonly Occurrence[] {
  return resolveOccurrences(
    // `availability_slots.day_of_week` is 0 to 6 by its check (ERD §15 rule 37); the package asserts it.
    { ...slot, dayOfWeek: slot.dayOfWeek as DayOfWeek },
    { fromLocalDate: first.requestedLocalDate, count: sessionCount },
  );
}

/** Whether one of `occurrences` overlaps one of `sessions`; each range holds its start, not its end. */
export function overlapsAny(
  occurrences: readonly Occurrence[],
  sessions: readonly SessionTime[],
): boolean {
  return occurrences.some((occurrence) => {
    const start = Date.parse(occurrence.startsAt);
    const end = Date.parse(occurrence.endsAt);
    return sessions.some(
      ({ startsAt, endsAt }) => start < endsAt.getTime() && startsAt.getTime() < end,
    );
  });
}

/** The window `runs` span: the earliest start to the latest end (canonical instants order as text). */
export function windowOfRuns(runs: readonly (readonly Occurrence[])[]): { from: Date; to: Date } {
  const occurrences = runs.flat();
  const from = occurrences
    .map(({ startsAt }) => startsAt)
    .sort()
    .at(0);
  const to = occurrences
    .map(({ endsAt }) => endsAt)
    .sort()
    .at(-1);
  if (from === undefined || to === undefined) throw new Error('windowOfRuns: no occurrence');
  return { from: new Date(from), to: new Date(to) };
}

/**
 * Of `candidates`, those none of whose sessions overlaps one of the parties' own sessions; the
 * parties' sessions are read once, over the window all the candidates' sessions span, and not at all
 * when there is no candidate.
 */
export async function freeOfPartiesSessions<T extends { readonly sessions: readonly Occurrence[] }>(
  tx: Transaction,
  read: SessionsBetween,
  parties: SessionParties,
  candidates: readonly T[],
): Promise<readonly T[]> {
  if (candidates.length === 0) return [];
  const own = await read(tx, parties, windowOfRuns(candidates.map(({ sessions }) => sessions)));
  return candidates.filter(({ sessions }) => !overlapsAny(sessions, own));
}
