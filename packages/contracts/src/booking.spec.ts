// T031 — the `booking` schemas of specs/003-booking/contracts/app-surface.md (FR-350, FR-386,
// R-205). Written before the schemas, and run red first.
//
// The student names the package and never who asks: a gender, a user id or a role sent is
// stripped, never read (R-GENDER-4). A slot is wall-clock time, a day, an `HH:MM` and a length,
// in the teacher's zone; its two previews are a local date with the instant it starts at, never a
// local time alone (R-TIME-6), computed by FR-368's rule from now (FR-386).
import { describe, expect, it } from 'vitest';

import { bookingSlot, bookingSlotsInput, bookingSlotsOutput, sessionPreview } from './booking.js';

const ids = {
  package: '0199d0a0-0000-7000-8000-0000000000a1',
  slot: '0199d0a0-0000-7000-8000-0000000000b1',
  teacher: '0199d0a0-0000-7000-8000-0000000000c1',
};

const slot = {
  slotId: ids.slot,
  dayOfWeek: 0,
  startTimeLocal: '17:00',
  durationMinutes: 45,
  firstSession: { localDate: '2026-11-08', startsAt: '2026-11-08T15:00:00.000Z' },
  lastSession: { localDate: '2026-12-27', startsAt: '2026-12-27T15:00:00.000Z' },
} as const;

describe('booking.slots input (FR-350)', () => {
  it('names the package, by id', () => {
    expect(bookingSlotsInput.parse({ packageId: ids.package })).toEqual({ packageId: ids.package });
    expect(bookingSlotsInput.safeParse({}).success).toBe(false);
    expect(bookingSlotsInput.safeParse({ packageId: 'hifz-8' }).success).toBe(false);
  });

  it('strips a gender, a user id or a role it was sent: the requester is the session (R-GENDER-4)', () => {
    const parsed = bookingSlotsInput.parse({
      packageId: ids.package,
      gender: 'female',
      userId: ids.teacher,
      role: 'teacher',
    });
    expect(parsed).toEqual({ packageId: ids.package });
    for (const key of Object.keys(bookingSlotsInput.shape)) {
      expect(key).not.toMatch(/^(user)(Id)?$|gender|role/i);
    }
  });
});

describe('a session preview (FR-386, R-TIME-6)', () => {
  it('is a local date and the UTC instant it starts at', () => {
    expect(sessionPreview.parse(slot.firstSession)).toEqual(slot.firstSession);
  });

  it('refuses a local time alone, an offset instead of UTC, and a date that is not a date', () => {
    for (const preview of [
      { localDate: '2026-11-08' },
      { startsAt: '2026-11-08T15:00:00.000Z' },
      { localDate: '2026-11-08', startsAt: '2026-11-08 17:00' },
      { localDate: '2026-11-08', startsAt: '2026-11-08T17:00:00+02:00' },
      { localDate: '08/11/2026', startsAt: '2026-11-08T15:00:00.000Z' },
      { localDate: '2026-11-08T00:00:00.000Z', startsAt: '2026-11-08T15:00:00.000Z' },
    ]) {
      expect(sessionPreview.safeParse(preview).success).toBe(false);
    }
  });
});

describe('booking.slots output (FR-350, FR-386)', () => {
  it('answers the teacher’s zone and each offerable slot with its first and last session', () => {
    const output = { teacherTimezone: 'Africa/Cairo', slots: [slot] };
    expect(bookingSlotsOutput.parse(output)).toEqual(output);
  });

  it('answers no slot as an empty list, never as nothing', () => {
    const empty = { teacherTimezone: 'Africa/Cairo', slots: [] };
    expect(bookingSlotsOutput.parse(empty)).toEqual(empty);
    expect(bookingSlotsOutput.safeParse({ teacherTimezone: 'Africa/Cairo' }).success).toBe(false);
    expect(bookingSlotsOutput.safeParse({ slots: [] }).success).toBe(false);
    expect(bookingSlotsOutput.safeParse({ teacherTimezone: '', slots: [] }).success).toBe(false);
  });

  it('refuses a slot the database would refuse (ERD §15 rules 37 and 38)', () => {
    for (const change of [
      { dayOfWeek: 7 },
      { dayOfWeek: -1 },
      { dayOfWeek: 1.5 },
      { startTimeLocal: '24:00' },
      { startTimeLocal: '5:00' },
      { startTimeLocal: '17:00:00' },
      { durationMinutes: 40 },
      { slotId: 'slot-1' },
    ]) {
      expect(bookingSlot.safeParse({ ...slot, ...change }).success).toBe(false);
    }
  });

  it('refuses a slot without either preview', () => {
    const { firstSession: _f, ...noFirst } = slot;
    const { lastSession: _l, ...noLast } = slot;
    expect(bookingSlot.safeParse(noFirst).success).toBe(false);
    expect(bookingSlot.safeParse(noLast).success).toBe(false);
  });

  it('strips a stored field it does not name: no holder, enrollment or teacher id (R-HONEST-4)', () => {
    const parsed = bookingSlotsOutput.parse({
      teacherTimezone: 'Africa/Cairo',
      teacherUserId: ids.teacher,
      slots: [{ ...slot, isActive: true, heldBy: ids.teacher, enrollmentId: ids.package }],
    });
    expect(parsed).not.toHaveProperty('teacherUserId');
    for (const key of ['isActive', 'heldBy', 'enrollmentId']) {
      expect(parsed.slots[0]).not.toHaveProperty(key);
    }
  });
});
