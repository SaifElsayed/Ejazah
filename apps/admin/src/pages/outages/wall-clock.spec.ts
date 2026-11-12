// T048 (FR-445; R-TIME-6): the outage form's wall-clock time, typed on the 24-hour clock, read as
// the API's `HH:MM`; Arabic-Indic digits read as Latin; a time that does not exist is nothing.
import { describe, expect, it } from 'vitest';

import { wallClockOf } from './wall-clock';

describe('wallClockOf', () => {
  it.each([
    ['14:30', '14:30'],
    ['9:05', '09:05'],
    [' 00:00 ', '00:00'],
    ['23:59', '23:59'],
    ['١٤:٣٠', '14:30'],
    ['۰۹:۱۵', '09:15'],
  ])('reads %s as %s', (typed, expected) => {
    expect(wallClockOf(typed)).toBe(expected);
  });

  it.each(['', '24:00', '12:60', '1430', '14:3', '14:300', '2:5', 'ab:cd', '-1:00'])(
    'reads %j as no time',
    (typed) => {
      expect(wallClockOf(typed)).toBeUndefined();
    },
  );
});
