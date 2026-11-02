// T031: the `booking` namespace of the user surface (specs/003-booking/contracts/app-surface.md
// "`booking` — the booking sheet"; FR-350, FR-386, R-205).
//
// `booking.slots` answers the slots of a package's teacher the student may book: active, of exactly
// the package's length, neither held nor occupied, and not overlapping the student's own sessions
// (FR-350, R-205). The input names the package and never who asks (R-GENDER-4). A slot is
// wall-clock time in the teacher's zone (R-TIME-3); each carries the first and last session the
// student would get if confirmed now, by FR-368's rule (FR-386), as a local date with the UTC
// instant it starts at, so the phone shows both zones (R-TIME-6). The checkout reuses the preview.
import { z } from 'zod';

import { calendarDate, timeZone } from './onboarding.js';
import { sessionLengthMinutes } from './packages.js';
import { slotDayOfWeek, slotStartTimeLocal } from './slots.js';

/** A session the student would get: its local date in the slot's zone, and the instant it starts. */
export const sessionPreview = z.object({
  localDate: calendarDate,
  startsAt: z.iso.datetime(),
});

export const bookingSlotsInput = z.object({ packageId: z.uuid() });

/** One offerable slot of the booking sheet, with its two previews (FR-386). */
export const bookingSlot = z.object({
  slotId: z.uuid(),
  dayOfWeek: slotDayOfWeek,
  startTimeLocal: slotStartTimeLocal,
  durationMinutes: sessionLengthMinutes,
  firstSession: sessionPreview,
  lastSession: sessionPreview,
});

/** `booking.slots`' answer: the teacher's zone, and the offerable slots, empty when none is. */
export const bookingSlotsOutput = z.object({
  teacherTimezone: timeZone,
  slots: z.array(bookingSlot),
});

export type SessionPreview = z.infer<typeof sessionPreview>;
export type BookingSlotsInput = z.infer<typeof bookingSlotsInput>;
export type BookingSlot = z.infer<typeof bookingSlot>;
export type BookingSlotsOutput = z.infer<typeof bookingSlotsOutput>;
