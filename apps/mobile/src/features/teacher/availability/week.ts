// T022 (FR-313, FR-317, FR-318): the week the availability draws and the editor's choices. A slot is
// a day of the week (0 = Sunday), a wall-clock start `HH:MM` read in its own zone and a length;
// nothing here makes it an instant (R-TIME-3). The week runs Saturday to Friday, as the boards draw
// it in both languages.
import type { SlotState, SlotsUpdateInput, TeacherSlot } from '@ijazah/contracts';

/** The days of the week in the boards' order, Saturday first. */
export const WEEK = [6, 0, 1, 2, 3, 4, 5] as const;

/** The three lengths a slot may have (FR-313). */
export const SLOT_LENGTHS = [30, 45, 60] as const;
export type SlotLength = (typeof SLOT_LENGTHS)[number];

/** One day of the week with its slots, each by its start. */
export interface DaySlots {
  readonly dayOfWeek: number;
  readonly slots: readonly TeacherSlot[];
}

/** The days that have slots, in the week's order, and the days that have none. */
export function weekOf(slots: readonly TeacherSlot[]): {
  readonly days: readonly DaySlots[];
  readonly withoutSlots: readonly number[];
} {
  const days: DaySlots[] = [];
  const withoutSlots: number[] = [];
  for (const dayOfWeek of WEEK) {
    const ofDay = slots
      .filter((slot) => slot.dayOfWeek === dayOfWeek)
      // `HH:MM` on the 24-hour clock sorts as text.
      .sort((a, b) => (a.startTimeLocal < b.startTimeLocal ? -1 : 1));
    if (ofDay.length === 0) withoutSlots.push(dayOfWeek);
    else days.push({ dayOfWeek, slots: ofDay });
  }
  return { days, withoutSlots };
}

const QUARTERS = ['00', '15', '30', '45'] as const;
const HOURS_PER_DAY = 24;

/**
 * The starts the editor offers, every quarter hour of the day (the boards draw «8:15 م»), with
 * `kept` in its place when a slot's own start falls between two quarters.
 */
export function startTimes(kept?: string): readonly string[] {
  const starts = Array.from({ length: HOURS_PER_DAY }, (_, hour) =>
    QUARTERS.map((minute) => `${String(hour).padStart('HH'.length, '0')}:${minute}`),
  ).flat();
  if (kept === undefined || starts.includes(kept)) return starts;
  return [...starts, kept].sort();
}

/** The editor's three choices. */
export interface SlotDraft {
  readonly dayOfWeek: number;
  readonly startTimeLocal: string;
  readonly durationMinutes: SlotLength;
}

/** What an edit sends: only the day, the start and the length that differ from the slot's. */
export function changeOf(
  slot: TeacherSlot,
  draft: SlotDraft,
): Pick<SlotsUpdateInput, 'dayOfWeek' | 'startTimeLocal' | 'durationMinutes'> {
  return {
    ...(draft.dayOfWeek === slot.dayOfWeek ? {} : { dayOfWeek: draft.dayOfWeek }),
    ...(draft.startTimeLocal === slot.startTimeLocal
      ? {}
      : { startTimeLocal: draft.startTimeLocal }),
    ...(draft.durationMinutes === slot.durationMinutes
      ? {}
      : { durationMinutes: draft.durationMinutes }),
  };
}

/**
 * Which slot opens the editor: the one seam of an open question (T022). The Availability board
 * lets a booked slot open the editor, to disable it; the Slot contract (components.md) says a
 * booked slot is not pressable. Until the owner decides, a booked slot stays inert, as the
 * contract says; opening it is this line and the contract's.
 */
export function pressOf<Press>(state: SlotState, open: Press): Press | undefined {
  return state === 'booked' ? undefined : open;
}
