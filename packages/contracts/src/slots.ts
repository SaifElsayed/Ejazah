// T016: the `teacher.slots` namespace of the user surface (specs/003-booking/contracts/
// app-surface.md "`teacher.slots` — catalog"; FR-313, FR-314, FR-317, FR-318).
//
// A weekly slot is a day of the week (0–6, 0 = Sunday, as Postgres `EXTRACT(DOW)`), a local start
// `HH:MM` and a length of 30, 45 or 60 minutes (FR-PROFILE-4 as amended 2026-10-31; ERD §15 rules 37
// and 38). It is wall-clock time read in the slot's zone, never an instant (R-TIME-3): the zone is
// the teacher's at creation, written by the service, so it is on every output and on no input
// (contracts/README.md "Time", R-TIME-6). `create` is keyed, so it carries the idempotency key.
import { z } from 'zod';

import { idempotencyKey } from './idempotency-key.js';
import { timeZone } from './onboarding.js';
import { sessionLengthMinutes } from './packages.js';

/** `availability_slots.day_of_week`: 0–6, 0 = Sunday. */
export const slotDayOfWeek = z.int().min(0).max(6);

/** A slot's local start on the 24-hour clock, `HH:MM`, with no zone and no seconds. */
export const slotStartTimeLocal = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** `booked` is in use (R-207) and `disabled` inactive; derived, never stored. */
export const slotState = z.enum(['free', 'booked', 'disabled']);

/** One of the teacher's slots, with its own zone: `list`'s item, and `create`'s and `update`'s answer. */
export const teacherSlot = z.object({
  id: z.uuid(),
  dayOfWeek: slotDayOfWeek,
  startTimeLocal: slotStartTimeLocal,
  durationMinutes: sessionLengthMinutes,
  timezone: timeZone,
  isActive: z.boolean(),
  state: slotState,
});

/**
 * `teacher.slots.list`'s answer: whether students see the teacher's slots (the visibility
 * predicate's answer, as `teacher.packages.list`'s `published`; T069, FR-315), the teacher's zone and
 * the slots.
 */
export const slotsListOutput = z.object({
  published: z.boolean(),
  timezone: timeZone,
  slots: z.array(teacherSlot),
});

export const slotsCreateInput = z.object({
  dayOfWeek: slotDayOfWeek,
  startTimeLocal: slotStartTimeLocal,
  durationMinutes: sessionLengthMinutes,
  idempotencyKey,
});

/** The service refuses the day, the start and the length while the slot is in use (FR-318). */
export const slotsUpdateInput = z.object({
  slotId: z.uuid(),
  dayOfWeek: slotDayOfWeek.optional(),
  startTimeLocal: slotStartTimeLocal.optional(),
  durationMinutes: sessionLengthMinutes.optional(),
  isActive: z.boolean().optional(),
});

export type SlotState = z.infer<typeof slotState>;
export type TeacherSlot = z.infer<typeof teacherSlot>;
export type SlotsListOutput = z.infer<typeof slotsListOutput>;
export type SlotsCreateInput = z.infer<typeof slotsCreateInput>;
export type SlotsUpdateInput = z.infer<typeof slotsUpdateInput>;
