// T071: the zone the panel works in. The browser's own when it names a place, Cairo when it does
// not (`UTC`, `Etc/*`, nothing): the time package refuses a zone that is no place (B12b), and the
// call's day and the audit's days are read there (owner's decision at B14b's conflict check).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { daysBefore, FALLBACK_TIME_ZONE, panelTimeZone, todayIn } from './zone';

afterEach(() => vi.restoreAllMocks());

function browserZone(zone: string | undefined) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: zone,
  } as Intl.ResolvedDateTimeFormatOptions);
}

describe('panelTimeZone', () => {
  it('is the browser’s zone when it names a place, by its current name', () => {
    browserZone('Asia/Riyadh');
    expect(panelTimeZone()).toBe('Asia/Riyadh');
  });

  it.each(['UTC', 'Etc/GMT-3', undefined])('is Cairo when the browser answers %s', (zone) => {
    browserZone(zone);
    expect(panelTimeZone()).toBe('Africa/Cairo');
    expect(FALLBACK_TIME_ZONE).toBe('Africa/Cairo');
  });
});

describe('todayIn', () => {
  it('is the calendar day in the zone, YYYY-MM-DD', () => {
    const late = new Date('2026-10-22T22:30:00Z');
    expect(todayIn('Africa/Cairo', late)).toBe('2026-10-23');
    expect(todayIn('America/New_York', late)).toBe('2026-10-22');
  });
});

describe('daysBefore (B14d)', () => {
  it('is the calendar day so many days earlier, across a month', () => {
    expect(daysBefore('2026-10-25', 29)).toBe('2026-09-26');
    expect(daysBefore('2026-10-25', 0)).toBe('2026-10-25');
  });
});
