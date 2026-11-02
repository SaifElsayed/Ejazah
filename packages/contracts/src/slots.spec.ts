// T016 — the `teacher.slots` schemas of specs/003-booking/contracts/app-surface.md (FR-313,
// FR-317, FR-318). Written before the schemas, and run red first.
//
// A slot is a day of the week (0–6, 0 = Sunday, as Postgres `EXTRACT(DOW)`; ERD §15 rule 37), a
// local start `HH:MM` (contracts/README.md "Time") and a length of 30, 45 or 60 minutes (rule 38).
// The zone is the teacher's at creation, set by the service: it is on every output and on no input,
// and no field is an instant (R-TIME-3, R-TIME-6).
import { describe, expect, it } from 'vitest';

import {
  slotsCreateInput,
  slotsListOutput,
  slotState,
  slotsUpdateInput,
  teacherSlot,
} from './slots.js';

const ids = { slot: '0199d0a0-0000-7000-8000-0000000000b1' };

const create = {
  dayOfWeek: 6,
  startTimeLocal: '10:00',
  durationMinutes: 45,
  idempotencyKey: 'slot-0199d0a0-0000-7000-8000',
} as const;

const slot = {
  id: ids.slot,
  dayOfWeek: 6,
  startTimeLocal: '10:00',
  durationMinutes: 45,
  timezone: 'Africa/Cairo',
  isActive: true,
  state: 'free',
} as const;

describe('the day of the week (0–6, 0 = Sunday)', () => {
  it('takes Sunday through Saturday', () => {
    for (const dayOfWeek of [0, 1, 2, 3, 4, 5, 6]) {
      expect(slotsCreateInput.safeParse({ ...create, dayOfWeek }).success).toBe(true);
    }
  });

  it('refuses 7, -1, a fraction and a name', () => {
    for (const dayOfWeek of [7, -1, 2.5, 'saturday']) {
      expect(slotsCreateInput.safeParse({ ...create, dayOfWeek }).success).toBe(false);
      expect(slotsUpdateInput.safeParse({ slotId: ids.slot, dayOfWeek }).success).toBe(false);
    }
  });
});

describe('the local start (`HH:MM`, a wall-clock time, never an instant)', () => {
  it('takes midnight, 23:59 and a time in between', () => {
    for (const startTimeLocal of ['00:00', '23:59', '09:30']) {
      expect(slotsCreateInput.safeParse({ ...create, startTimeLocal }).success).toBe(true);
    }
  });

  it('refuses 24:00, 9:30, seconds, an hour past 23, a minute past 59 and an instant', () => {
    for (const startTimeLocal of [
      '24:00',
      '9:30',
      '09:30:00',
      '25:00',
      '10:60',
      '2026-11-07T08:00:00Z',
      '10:00Z',
      '',
    ]) {
      expect(slotsCreateInput.safeParse({ ...create, startTimeLocal }).success).toBe(false);
      expect(slotsUpdateInput.safeParse({ slotId: ids.slot, startTimeLocal }).success).toBe(false);
    }
  });
});

describe('the length (30, 45 or 60 minutes, FR-PROFILE-4 as amended)', () => {
  it('takes the three lengths', () => {
    for (const durationMinutes of [30, 45, 60]) {
      expect(slotsCreateInput.safeParse({ ...create, durationMinutes }).success).toBe(true);
    }
  });

  it('refuses 29 and 31 minutes, 90 and zero', () => {
    for (const durationMinutes of [29, 31, 90, 0]) {
      expect(slotsCreateInput.safeParse({ ...create, durationMinutes }).success).toBe(false);
      expect(slotsUpdateInput.safeParse({ slotId: ids.slot, durationMinutes }).success).toBe(false);
    }
  });
});

describe('create and update', () => {
  it('create needs the day, the start, the length and the idempotency key', () => {
    expect(slotsCreateInput.safeParse(create).success).toBe(true);
    for (const field of Object.keys(create)) {
      const { [field as keyof typeof create]: _dropped, ...partial } = create;
      expect(slotsCreateInput.safeParse(partial).success).toBe(false);
    }
  });

  it("no input carries a zone: it is the teacher's at creation, set by the service", () => {
    expect(slotsCreateInput.shape).not.toHaveProperty('timezone');
    expect(slotsUpdateInput.shape).not.toHaveProperty('timezone');
    const parsed = slotsCreateInput.parse({ ...create, timezone: 'Europe/London' });
    expect(parsed).not.toHaveProperty('timezone');
  });

  it('update names the slot and changes only what it carries', () => {
    expect(slotsUpdateInput.safeParse({ slotId: ids.slot, isActive: false }).success).toBe(true);
    expect(slotsUpdateInput.safeParse({ isActive: false }).success).toBe(false);
    expect(slotsUpdateInput.shape).not.toHaveProperty('idempotencyKey');
  });
});

describe('the outputs', () => {
  it('a slot carries its zone and its state', () => {
    expect(teacherSlot.parse(slot)).toEqual(slot);
    expect(teacherSlot.safeParse({ ...slot, timezone: undefined }).success).toBe(false);
    expect(slotState.options).toEqual(['free', 'booked', 'disabled']);
    expect(teacherSlot.safeParse({ ...slot, state: 'held' }).success).toBe(false);
  });

  it("the list carries the teacher's zone beside the slots", () => {
    const list = { timezone: 'Africa/Cairo', slots: [slot] };
    expect(slotsListOutput.parse(list)).toEqual(list);
    expect(slotsListOutput.safeParse({ slots: [slot] }).success).toBe(false);
  });

  it('strip a field the schema does not name (R-HONEST-4)', () => {
    const parsed = teacherSlot.parse({ ...slot, teacherUserId: ids.slot });
    expect(parsed).not.toHaveProperty('teacherUserId');
  });
});
