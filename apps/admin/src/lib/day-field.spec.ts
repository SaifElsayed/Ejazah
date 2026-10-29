// T111: the call's day typed day / month / year, as the board draws it (`AdminApplications`, «يوم /
// شهر / سنة»), never the browser's month / day / year; the API still takes `YYYY-MM-DD`.
import { describe, expect, it } from 'vitest';

import { calendarDateOfDayField, dayFieldOf, dayFieldText } from './day-field';

describe('dayFieldText', () => {
  it('keeps the digits and puts the slashes after the day and the month', () => {
    expect(dayFieldText('')).toBe('');
    expect(dayFieldText('2')).toBe('2');
    expect(dayFieldText('20')).toBe('20');
    expect(dayFieldText('201')).toBe('20/1');
    expect(dayFieldText('2010')).toBe('20/10');
    expect(dayFieldText('20102026')).toBe('20/10/2026');
    expect(dayFieldText('20/10/2026')).toBe('20/10/2026');
  });

  it('drops a ninth digit and anything that is not a digit', () => {
    expect(dayFieldText('20/10/20261')).toBe('20/10/2026');
    expect(dayFieldText('2a0-1 0.')).toBe('20/10');
  });

  it('reads Arabic-Indic and Eastern Arabic-Indic digits as their Latin digits', () => {
    expect(dayFieldText('٢٠١٠٢٠٢٦')).toBe('20/10/2026');
    expect(dayFieldText('۲۰/۱۰/۲۰۲۶')).toBe('20/10/2026');
  });

  it('lets a deleted slash go with the digit before it', () => {
    expect(dayFieldText('20/')).toBe('20');
    expect(dayFieldText('20/10/')).toBe('20/10');
  });
});

describe('calendarDateOfDayField', () => {
  it('reads the day first, then the month, then the year', () => {
    expect(calendarDateOfDayField('20/10/2026')).toBe('2026-10-20');
    expect(calendarDateOfDayField('05/03/2026')).toBe('2026-03-05');
  });

  it('is nothing for a month / day / year order, which names no month', () => {
    expect(calendarDateOfDayField('10/20/2026')).toBeUndefined();
  });

  it('is nothing for a day the calendar does not have', () => {
    expect(calendarDateOfDayField('31/02/2026')).toBeUndefined();
    expect(calendarDateOfDayField('29/02/2026')).toBeUndefined();
    expect(calendarDateOfDayField('29/02/2028')).toBe('2028-02-29');
    expect(calendarDateOfDayField('00/10/2026')).toBeUndefined();
  });

  it('is nothing until the field is whole', () => {
    expect(calendarDateOfDayField('')).toBeUndefined();
    expect(calendarDateOfDayField('20/10')).toBeUndefined();
    expect(calendarDateOfDayField('20/10/202')).toBeUndefined();
  });
});

describe('dayFieldOf', () => {
  it('shows a recorded day as the field does, day first', () => {
    expect(dayFieldOf('2026-10-20')).toBe('20/10/2026');
    expect(calendarDateOfDayField(dayFieldOf('2026-03-05'))).toBe('2026-03-05');
  });
});
