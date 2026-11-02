// T022 (FR-313, FR-317, FR-318): the week the availability draws, the starts its editor offers, the
// change an edit sends, and the one seam that decides which slot opens the editor.
import type { TeacherSlot } from '@ijazah/contracts';
import { describe, expect, it, jest } from '@jest/globals';

import { changeOf, startTimes, WEEK, weekOf } from './week';

const ZONE = 'Africa/Cairo';

function slot(
  id: string,
  dayOfWeek: number,
  startTimeLocal: string,
  state: TeacherSlot['state'] = 'free',
): TeacherSlot {
  return {
    id: `0193a6f0-0000-7000-8000-0000000000${id}`,
    dayOfWeek,
    startTimeLocal,
    durationMinutes: 45,
    timezone: ZONE,
    isActive: state !== 'disabled',
    state,
  };
}

describe('the week (T022)', () => {
  it('runs from Saturday to Friday, as the boards draw it', () => {
    expect(WEEK).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it('groups the slots by day in the week’s order, each day by its start, and names the empty days', () => {
    const week = weekOf([
      slot('01', 2, '21:00', 'disabled'),
      slot('02', 6, '11:00'),
      slot('03', 0, '19:30'),
      slot('04', 6, '10:00', 'booked'),
    ]);
    expect(week.days.map(({ dayOfWeek }) => dayOfWeek)).toEqual([6, 0, 2]);
    expect(week.days[0]?.slots.map(({ startTimeLocal }) => startTimeLocal)).toEqual([
      '10:00',
      '11:00',
    ]);
    expect(week.withoutSlots).toEqual([1, 3, 4, 5]);
  });

  it('has no day and every day empty when there is no slot', () => {
    expect(weekOf([])).toEqual({ days: [], withoutSlots: [6, 0, 1, 2, 3, 4, 5] });
  });
});

describe('the starts the editor offers (T022)', () => {
  it('is every quarter hour of the day, on the 24-hour clock', () => {
    const starts = startTimes();
    expect(starts).toHaveLength(96);
    expect(starts[0]).toBe('00:00');
    expect(starts[1]).toBe('00:15');
    expect(starts[95]).toBe('23:45');
  });

  it('keeps a slot’s own start that falls between two quarters, in its place', () => {
    const starts = startTimes('10:05');
    expect(starts).toHaveLength(97);
    expect(starts.slice(40, 43)).toEqual(['10:00', '10:05', '10:15']);
    expect(startTimes('10:00')).toHaveLength(96);
  });
});

describe('an edit sends only what changed (FR-318)', () => {
  const saturday = slot('02', 6, '11:00');

  it('sends the length alone when only the length changed', () => {
    expect(
      changeOf(saturday, { dayOfWeek: 6, startTimeLocal: '11:00', durationMinutes: 60 }),
    ).toEqual({ durationMinutes: 60 });
  });

  it('sends nothing when nothing changed', () => {
    expect(
      changeOf(saturday, { dayOfWeek: 6, startTimeLocal: '11:00', durationMinutes: 45 }),
    ).toEqual({});
  });

  it('sends the day and the start when both changed', () => {
    expect(
      changeOf(saturday, { dayOfWeek: 0, startTimeLocal: '09:30', durationMinutes: 45 }),
    ).toEqual({ dayOfWeek: 0, startTimeLocal: '09:30' });
  });
});
