// T032 — `booking.slots`, the booking sheet's slots of one package (R-205, R-209, FR-350, FR-386).
//
// Over a store of fakes standing for catalog's, identity's and sessions' entries and T026's
// occupancy: the predicate asked first and NOT_FOUND with nothing else read; the slots of exactly the
// package's length; occupancy; the student's own sessions overlapping a slot's first session; the
// lead at its boundary; the last session the package's count of weeks on; Cairo's 2026 April gap
// and October change; the zone the teacher's line is labelled with. Over the real tables,
// `tests/db-integrity/booking-slots.spec.ts`, which also holds the previews against T034's
// generation for the same instant.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { BookablePackage, OfferedSlot } from '../catalog/index.js';
import type { SessionTime } from '../sessions/index.js';
import {
  type BookingSlotsStore,
  type BookingStudent,
  bookingSlotsOf,
} from './booking-slots.service.js';
import type { DiscoveryClock } from './nearest-slot.service.js';
import type { SlotOccupancy } from './slot-occupancy.service.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000000d1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000d2';
const PACKAGE = '0199d0a0-0000-7000-8000-0000000000d3';
const CAIRO = 'Africa/Cairo';
const RIYADH = 'Asia/Riyadh';
const LEAD = 24;

const tx = {} as Transaction;
const female = 'female' as RequesterGender;
const male = 'male' as RequesterGender;
const student: BookingStudent = { userId: STUDENT, gender: female };

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

const sixtyMinutes: BookablePackage = {
  id: PACKAGE,
  teacherUserId: TEACHER,
  sessionCount: 4,
  sessionDurationMinutes: 60,
};

interface World {
  readonly pkg?: BookablePackage | null;
  readonly bookable?: boolean;
  readonly slots?: readonly OfferedSlot[];
  readonly occupancy?: ReadonlyMap<string, SlotOccupancy>;
  readonly sessions?: readonly SessionTime[];
  readonly accountZone?: string | null;
}

/** A store answering `world`, recording each read with what it was asked. */
function storeOf(world: World) {
  const reads: unknown[][] = [];
  const store: BookingSlotsStore = {
    packageOf: async (_tx, packageId) => {
      reads.push(['packageOf', packageId]);
      return world.pkg === undefined ? sixtyMinutes : world.pkg;
    },
    bookable: async (_tx, requester, teacherUserId) => {
      reads.push(['bookable', requester, teacherUserId]);
      return world.bookable ?? true;
    },
    offeredSlotsOf: async (_tx, teacherIds) => {
      reads.push(['offeredSlotsOf', teacherIds]);
      return [...(world.slots ?? [])];
    },
    occupancyOf: async (_tx, slotIds) => {
      reads.push(['occupancyOf', slotIds]);
      return world.occupancy ?? new Map();
    },
    studentSessionsBetween: async (_tx, studentUserId, window) => {
      reads.push([
        'studentSessionsBetween',
        studentUserId,
        window.from.toISOString(),
        window.to.toISOString(),
      ]);
      return world.sessions ?? [];
    },
    teacherTimezone: async (_tx, teacherUserId) => {
      reads.push(['teacherTimezone', teacherUserId]);
      return world.accountZone === undefined ? CAIRO : world.accountZone;
    },
  };
  return { store, reads };
}

const clockAt = (now: string, bufferWeeks = 0): DiscoveryClock => ({
  now: new Date(now),
  leadHours: LEAD,
  bufferWeeks: async () => bufferWeeks,
});

/** Tuesday 2026-11-03, 10:00 in Cairo (+02:00 since the October change). */
const TUESDAY = '2026-11-03T08:00:00Z';

const ask = (world: World, now = TUESDAY, who: BookingStudent = student) => {
  const { store, reads } = storeOf(world);
  return {
    reads,
    answer: bookingSlotsOf(tx, store, who, { packageId: PACKAGE }, clockAt(now)),
  };
};

const session = (startsAt: string, endsAt: string): SessionTime => ({
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
});

describe('the predicate first (R-GENDER-2, R-201)', () => {
  it('answers NOT_FOUND for an unknown or inactive package, reading nothing after it', async () => {
    const { answer, reads } = ask({
      pkg: null,
      slots: [slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' })],
    });
    await expect(answer).rejects.toEqual(new DomainError('NOT_FOUND'));
    expect(reads).toEqual([['packageOf', PACKAGE]]);
  });

  it('answers NOT_FOUND for a teacher the predicate does not admit, reading nothing after it, in both directions', async () => {
    for (const gender of [female, male]) {
      const { answer, reads } = ask(
        { bookable: false, slots: [slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' })] },
        TUESDAY,
        { userId: STUDENT, gender },
      );
      await expect(answer).rejects.toEqual(new DomainError('NOT_FOUND'));
      expect(reads).toEqual([
        ['packageOf', PACKAGE],
        ['bookable', gender, TEACHER],
      ]);
    }
  });

  it("asks the predicate of the package's teacher with the session's gender before the slots", async () => {
    const { answer, reads } = ask({ slots: [] }, TUESDAY, { userId: STUDENT, gender: male });
    await answer;
    expect(reads.slice(0, 3)).toEqual([
      ['packageOf', PACKAGE],
      ['bookable', male, TEACHER],
      ['offeredSlotsOf', [TEACHER]],
    ]);
  });
});

describe('the offerable slots (FR-350, R-205)', () => {
  it("offers only the slots of exactly the package's length", async () => {
    const sixty = slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' });
    const fortyFive = slot({ dayOfWeek: 4, startTimeLocal: '11:00:00', durationMinutes: 45 });
    const { answer, reads } = ask({ slots: [sixty, fortyFive] });
    expect((await answer).slots.map(({ slotId }) => slotId)).toEqual([sixty.id]);
    expect(reads).toContainEqual(['occupancyOf', [sixty.id]]);
  });

  it('leaves out a slot an active hold or an enrollment awaiting payment takes', async () => {
    const taken = slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' });
    const free = slot({ dayOfWeek: 6, startTimeLocal: '10:00:00' });
    const { answer } = ask({
      slots: [taken, free],
      occupancy: new Map([[taken.id, { kind: 'taken' }]]),
    });
    expect((await answer).slots.map(({ slotId }) => slotId)).toEqual([free.id]);
  });

  it('offers a confirmed enrollment’s slot only from its release, the week after the final session (FR-394)', async () => {
    const thursday = slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' });
    const until = new Map<string, SlotOccupancy>([
      [thursday.id, { kind: 'until', releasedOn: '2026-11-12', timezone: CAIRO }],
    ]);
    // On Tuesday the first session would be Thursday 11-05, before the release.
    expect((await ask({ slots: [thursday], occupancy: until }).answer).slots).toEqual([]);
    // On Wednesday 11-04 at noon, 24 hours on is past Thursday 09:00, so 11-12: released.
    const { answer } = ask({ slots: [thursday], occupancy: until }, '2026-11-04T10:00:00Z');
    expect((await answer).slots.map(({ firstSession }) => firstSession.localDate)).toEqual([
      '2026-11-12',
    ]);
  });

  it('answers the soonest first session first, each with its start as HH:MM and the package length', async () => {
    const saturday = slot({ dayOfWeek: 6, startTimeLocal: '10:00:00' });
    const thursday = slot({ dayOfWeek: 4, startTimeLocal: '09:30:00' });
    const { answer } = ask({ slots: [saturday, thursday] });
    expect((await answer).slots).toEqual([
      {
        slotId: thursday.id,
        dayOfWeek: 4,
        startTimeLocal: '09:30',
        durationMinutes: 60,
        firstSession: { localDate: '2026-11-05', startsAt: '2026-11-05T07:30:00Z' },
        lastSession: { localDate: '2026-11-26', startsAt: '2026-11-26T07:30:00Z' },
      },
      {
        slotId: saturday.id,
        dayOfWeek: 6,
        startTimeLocal: '10:00',
        durationMinutes: 60,
        firstSession: { localDate: '2026-11-07', startsAt: '2026-11-07T08:00:00Z' },
        lastSession: { localDate: '2026-11-28', startsAt: '2026-11-28T08:00:00Z' },
      },
    ]);
  });

  it('answers an empty list, with the teacher’s zone, when nothing is offerable', async () => {
    const { answer, reads } = ask({ slots: [] });
    expect(await answer).toEqual({ teacherTimezone: CAIRO, slots: [] });
    expect(reads.map(([name]) => name)).not.toContain('studentSessionsBetween');
  });
});

describe("the student's own sessions (R-205, FR-BOOK-5)", () => {
  const thursday = () => slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' });
  const saturday = () => slot({ dayOfWeek: 6, startTimeLocal: '10:00:00' });

  it('reads them over the window the first sessions span, by the session’s student', async () => {
    const { answer, reads } = ask({ slots: [thursday(), saturday()] });
    await answer;
    expect(reads).toContainEqual([
      'studentSessionsBetween',
      STUDENT,
      '2026-11-05T07:00:00.000Z',
      '2026-11-07T09:00:00.000Z',
    ]);
  });

  it('leaves out a slot whose first session overlaps one of them, by a minute', async () => {
    const overlapped = thursday();
    const free = saturday();
    const { answer } = ask({
      slots: [overlapped, free],
      sessions: [session('2026-11-05T07:59:00Z', '2026-11-05T08:59:00Z')],
    });
    expect((await answer).slots.map(({ slotId }) => slotId)).toEqual([free.id]);
  });

  it('keeps a slot whose first session only touches one, end to start', async () => {
    const before = thursday();
    const { answer } = ask({
      slots: [before],
      sessions: [
        session('2026-11-05T06:00:00Z', '2026-11-05T07:00:00Z'),
        session('2026-11-05T08:00:00Z', '2026-11-05T09:00:00Z'),
      ],
    });
    expect((await answer).slots.map(({ slotId }) => slotId)).toEqual([before.id]);
  });
});

describe('the previews by FR-368’s rule from now (R-209, FR-386)', () => {
  const thursday = () => slot({ dayOfWeek: 4, startTimeLocal: '09:00:00' });

  it('takes an occurrence exactly the lead away, and the week after once the lead passes it', async () => {
    const one = thursday();
    // Wednesday 11-04 09:00 in Cairo: Thursday 09:00 is exactly 24 hours away.
    const exact = ask({ slots: [one] }, '2026-11-04T07:00:00Z');
    expect((await exact.answer).slots[0]?.firstSession).toEqual({
      localDate: '2026-11-05',
      startsAt: '2026-11-05T07:00:00Z',
    });
    const late = ask({ slots: [one] }, '2026-11-04T07:00:01Z');
    expect((await late.answer).slots[0]?.firstSession).toEqual({
      localDate: '2026-11-12',
      startsAt: '2026-11-12T07:00:00Z',
    });
  });

  it("dates the last session the package's count of weeks on, across Cairo's October change", async () => {
    const one = thursday();
    // Monday 2026-10-12 10:00 in Cairo (+03:00): the first Thursday is 10-15, the fourth 11-05.
    const { answer } = ask({ slots: [one] }, '2026-10-12T07:00:00Z');
    expect((await answer).slots[0]).toMatchObject({
      firstSession: { localDate: '2026-10-15', startsAt: '2026-10-15T06:00:00Z' },
      lastSession: { localDate: '2026-11-05', startsAt: '2026-11-05T07:00:00Z' },
    });
  });

  it("keeps the requested Friday 00:30 across Cairo's 2026 April gap, at the instant it lands on", async () => {
    const friday = slot({ dayOfWeek: 5, startTimeLocal: '00:30:00' });
    const twoWeeks = { ...sixtyMinutes, sessionCount: 2 };
    // Thursday 2026-04-23 00:30 in Cairo (+02:00); 24 hours on is Friday 01:30 (+03:00), where
    // the gap lands the requested 00:30, so that occurrence is exactly the lead away.
    const exact = ask({ pkg: twoWeeks, slots: [friday] }, '2026-04-22T22:30:00Z');
    expect((await exact.answer).slots[0]).toMatchObject({
      startTimeLocal: '00:30',
      firstSession: { localDate: '2026-04-24', startsAt: '2026-04-23T22:30:00Z' },
      lastSession: { localDate: '2026-05-01', startsAt: '2026-04-30T21:30:00Z' },
    });
    const late = ask({ pkg: twoWeeks, slots: [friday] }, '2026-04-22T22:30:01Z');
    expect((await late.answer).slots[0]?.firstSession).toEqual({
      localDate: '2026-05-01',
      startsAt: '2026-04-30T21:30:00Z',
    });
  });
});

describe('the zones (R-TIME-6, ADR 0009 D5)', () => {
  it('dates each slot in its own zone and labels the teacher’s line with the zone the slots share', async () => {
    const riyadh = slot({ dayOfWeek: 4, startTimeLocal: '09:00:00', timezone: RIYADH });
    const { answer, reads } = ask({ slots: [riyadh], accountZone: CAIRO });
    expect(await answer).toEqual({
      teacherTimezone: RIYADH,
      slots: [
        expect.objectContaining({
          startTimeLocal: '09:00',
          firstSession: { localDate: '2026-11-05', startsAt: '2026-11-05T06:00:00Z' },
        }),
      ],
    });
    expect(reads.map(([name]) => name)).not.toContain('teacherTimezone');
  });

  it("labels it with the teacher's current zone when the slots answered do not share one", async () => {
    const riyadh = slot({ dayOfWeek: 4, startTimeLocal: '09:00:00', timezone: RIYADH });
    const cairo = slot({ dayOfWeek: 6, startTimeLocal: '10:00:00' });
    const { answer, reads } = ask({ slots: [riyadh, cairo], accountZone: CAIRO });
    expect((await answer).teacherTimezone).toBe(CAIRO);
    expect(reads).toContainEqual(['teacherTimezone', TEACHER]);
  });
});
