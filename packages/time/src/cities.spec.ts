// T051 (FR-AUTH-10, FR-126): the city list the time-zone picker shows is the zones the account
// accepts, each named in both languages, and the older name a device may report finds its city.
import { describe, expect, it } from 'vitest';

import { cityOf, listedZone, timeZoneCities } from './cities.js';
import { assertTimeZone } from './index.js';

describe('timeZoneCities', () => {
  it('holds only zones assertTimeZone accepts, none of them Etc/* or UTC', () => {
    expect(timeZoneCities.length).toBeGreaterThan(300);
    for (const { zone } of timeZoneCities) {
      expect(assertTimeZone('timezone', zone)).toBe(zone);
      expect(zone.startsWith('Etc/')).toBe(false);
    }
  });

  it('is sorted by zone, each zone once, and no older name is also a listed zone', () => {
    const zones = timeZoneCities.map(({ zone }) => zone);
    expect(zones).toEqual([...zones].sort());
    expect(new Set(zones).size).toBe(zones.length);
    const listed = new Set(zones);
    for (const { aliases } of timeZoneCities) {
      for (const alias of aliases) expect(listed.has(alias)).toBe(false);
    }
  });

  it('names every zone in Arabic and in English', () => {
    for (const { ar, en } of timeZoneCities) {
      expect(ar.trim()).not.toBe('');
      expect(en.trim()).not.toBe('');
    }
  });
});

describe('cityOf', () => {
  it('answers the exemplar city of each language', () => {
    expect(cityOf('Africa/Cairo', 'ar')).toBe('القاهرة');
    expect(cityOf('Africa/Cairo', 'en')).toBe('Cairo');
    expect(cityOf('Asia/Riyadh', 'ar')).toBe('الرياض');
  });

  it('derives the English name from the zone where CLDR keeps none, underscores as spaces', () => {
    expect(cityOf('America/New_York', 'en')).toBe('New York');
  });

  it('finds the city of a zone by its older name', () => {
    expect(cityOf('Asia/Calcutta', 'en')).toBe(cityOf('Asia/Kolkata', 'en'));
    expect(cityOf('Europe/Kiev', 'ar')).toBe(cityOf('Europe/Kyiv', 'ar'));
  });

  it('answers null for a zone the list does not hold', () => {
    expect(cityOf('UTC', 'ar')).toBeNull();
    expect(cityOf('Mars/Olympus', 'en')).toBeNull();
  });
});

describe('listedZone', () => {
  it('answers the current name of a listed zone or of its older name', () => {
    expect(listedZone('Africa/Cairo')).toBe('Africa/Cairo');
    expect(listedZone('Asia/Calcutta')).toBe('Asia/Kolkata');
  });

  it('answers null for UTC, a fixed offset and an unknown zone, which a device may report', () => {
    expect(listedZone('UTC')).toBeNull();
    expect(listedZone('Etc/UTC')).toBeNull();
    expect(listedZone('Etc/GMT-2')).toBeNull();
    expect(listedZone('Mars/Olympus')).toBeNull();
  });
});
