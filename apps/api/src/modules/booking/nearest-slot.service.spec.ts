// T026 — the discovery card's nearest free slot (R-205, FR-335): over a teacher's offered slots (the
// active slots of their active packages' lengths, catalog's read), the first session a student would
// get on each by FR-368's rule, `firstOccurrenceAfter` with `first_session_lead_hours` in the slot's
// own zone, kept only when the slot is free on that session's date; the earliest instant per
// teacher, with the slot's zone. Cairo's April gap shows the lead is elapsed time and the slot's
// week is not: a Thursday 10:00 plus 24 hours is Friday 11:00 once the clocks move. Over the real
// tables, `tests/db-integrity/discovery-slots.spec.ts`.
import type { OfferedSlot } from '../catalog/index.js';
import { describe, expect, it } from 'vitest';

import { piasters } from '@ijazah/money';

import { nearestFreeOf, offerableOccurrences, programmeFloorOf } from './nearest-slot.service.js';
import type { SlotOccupancy } from './slot-occupancy.service.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000000c1';
const OTHER = '0199d0a0-0000-7000-8000-0000000000c2';
const CAIRO = 'Africa/Cairo';
const RIYADH = 'Asia/Riyadh';
const LEAD = 24;

let sequence = 0;
function slot(values: Partial<OfferedSlot> & Pick<OfferedSlot, 'dayOfWeek' | 'startTimeLocal'>) {
  sequence += 1;
  return {
    id: `0199d0a0-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    teacherUserId: TEACHER,
    durationMinutes: 60,
    timezone: CAIRO,
    ...values,
  } satisfies OfferedSlot;
}

/** Tuesday 2026-11-03, 10:00 in Cairo (+02:00 since the October change). */
const TUESDAY = new Date('2026-11-03T08:00:00Z');

describe('nearestFreeOf (R-205, FR-335)', () => {
  it('takes the first session at least the lead after now on each slot, and the earliest per teacher', () => {
    const tooSoon = slot({ dayOfWeek: 3, startTimeLocal: '09:00:00' });
    const later = slot({ dayOfWeek: 3, startTimeLocal: '11:00:00' });
    const friday = slot({ dayOfWeek: 5, startTimeLocal: '08:00:00' });
    const nearest = nearestFreeOf([tooSoon, later, friday], new Map(), {
      now: TUESDAY,
      leadHours: LEAD,
    });
    // Wednesday 09:00 is 23 hours away, so its first session is the week after; 11:00 is 25 away.
    expect(nearest).toEqual(
      new Map([[TEACHER, { startsAt: '2026-11-04T09:00:00Z', timezone: CAIRO }]]),
    );
  });

  it('leaves out a slot an active hold or an enrollment awaiting payment takes', () => {
    const taken = slot({ dayOfWeek: 3, startTimeLocal: '11:00:00' });
    const free = slot({ dayOfWeek: 6, startTimeLocal: '10:00:00' });
    const occupancy = new Map<string, SlotOccupancy>([[taken.id, { kind: 'taken' }]]);
    expect(
      nearestFreeOf([taken, free], occupancy, { now: TUESDAY, leadHours: LEAD }).get(TEACHER),
    ).toEqual({ startsAt: '2026-11-07T08:00:00Z', timezone: CAIRO });
  });

  it('offers a confirmed enrollment’s slot from the week after its final session, not before (FR-394)', () => {
    const thursday = slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' });
    // The final session is Thursday 2026-11-05; with no buffer the slot is released on 11-12.
    const occupancy = new Map<string, SlotOccupancy>([
      [thursday.id, { kind: 'until', releasedOn: '2026-11-12', timezone: CAIRO }],
    ]);
    expect(nearestFreeOf([thursday], occupancy, { now: TUESDAY, leadHours: LEAD })).toEqual(
      new Map(),
    );
    const wednesday = new Date('2026-11-04T10:00:00Z');
    expect(nearestFreeOf([thursday], occupancy, { now: wednesday, leadHours: LEAD })).toEqual(
      new Map([[TEACHER, { startsAt: '2026-11-12T07:00:00Z', timezone: CAIRO }]]),
    );
  });

  it('keeps the slot through the buffer: released on 11-19, the session of 11-12 is not offered', () => {
    const thursday = slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' });
    const occupancy = new Map<string, SlotOccupancy>([
      [thursday.id, { kind: 'until', releasedOn: '2026-11-19', timezone: CAIRO }],
    ]);
    const wednesday = new Date('2026-11-04T10:00:00Z');
    expect(nearestFreeOf([thursday], occupancy, { now: wednesday, leadHours: LEAD })).toEqual(
      new Map(),
    );
  });

  it("counts the lead as elapsed time across Cairo's April gap", () => {
    // Thursday 2026-04-23 10:00 (+02:00); 24 hours later is Friday 11:00 (+03:00), so Friday
    // 10:00 that week is too soon and the first session is Friday 2026-05-01 10:00 (+03:00).
    const fridayTen = slot({ dayOfWeek: 5, startTimeLocal: '10:00:00' });
    expect(
      nearestFreeOf([fridayTen], new Map(), {
        now: new Date('2026-04-23T08:00:00Z'),
        leadHours: LEAD,
      }),
    ).toEqual(new Map([[TEACHER, { startsAt: '2026-05-01T07:00:00Z', timezone: CAIRO }]]));
  });

  it('answers each teacher apart, in the slot’s own zone, and leaves out a teacher with no free slot', () => {
    const riyadh = slot({
      teacherUserId: OTHER,
      dayOfWeek: 3,
      startTimeLocal: '12:00:00',
      timezone: RIYADH,
    });
    const taken = slot({ dayOfWeek: 3, startTimeLocal: '11:00:00' });
    const occupancy = new Map<string, SlotOccupancy>([[taken.id, { kind: 'taken' }]]);
    expect(nearestFreeOf([riyadh, taken], occupancy, { now: TUESDAY, leadHours: LEAD })).toEqual(
      new Map([[OTHER, { startsAt: '2026-11-04T09:00:00Z', timezone: RIYADH }]]),
    );
  });
});

describe('offerableOccurrences (R-205)', () => {
  it('pairs each free slot with its first session and drops the occupied ones', () => {
    const free = slot({ dayOfWeek: 3, startTimeLocal: '11:00:00' });
    const taken = slot({ dayOfWeek: 3, startTimeLocal: '13:00:00' });
    const occupancy = new Map<string, SlotOccupancy>([[taken.id, { kind: 'taken' }]]);
    const offerable = offerableOccurrences([free, taken], occupancy, {
      now: TUESDAY,
      leadHours: LEAD,
    });
    expect(offerable.map(({ slot: { id }, first }) => [id, first.requestedLocalDate])).toEqual([
      [free.id, '2026-11-04'],
    ]);
  });
});

// 006:T004 (FR-701, R-504; Q-5 (a); the owner's approval of 2026-11-22): a programme package's
// teacher offers each active slot at least as long as the assessment, and only while the programme
// is open; closed, it offers none, so no card shows a nearest slot for it.
describe('programmeFloorOf (006:T004)', () => {
  it('is the assessment’s length while the programme is open', () => {
    expect(
      programmeFloorOf({
        open: true,
        assessmentPrice_piasters: piasters(50_000),
        assessmentDurationMinutes: 45,
      }),
    ).toBe(45);
  });

  it('is none while the programme is closed, by the switch or the price', () => {
    expect(programmeFloorOf({ open: false, refusal: 'programme_disabled' })).toBeUndefined();
    expect(programmeFloorOf({ open: false, refusal: 'assessment_fee_unset' })).toBeUndefined();
  });
});
