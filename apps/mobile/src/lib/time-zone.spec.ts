// T051, T052 (FR-AUTH-10, FR-131): the device's zone as the app uses it. A zone the account accepts
// is used as it is or by its current name; UTC, a fixed offset or an unknown zone is no zone a
// person lives by, so the app neither preselects it nor reports it (review of B10, finding 5).
import { describe, expect, it, jest } from '@jest/globals';

import { deviceTimeZone } from './time-zone';

let mockReported: string | null = 'Africa/Cairo';
jest.mock('expo-localization', () => ({
  getCalendars: () => [{ timeZone: mockReported }],
}));

describe('deviceTimeZone', () => {
  it('answers the zone the device reports when the account accepts it', () => {
    mockReported = 'Africa/Cairo';
    expect(deviceTimeZone()).toBe('Africa/Cairo');
  });

  it('answers the current name of a zone the device reports by an older one', () => {
    mockReported = 'Asia/Calcutta';
    expect(deviceTimeZone()).toBe('Asia/Kolkata');
  });

  it('answers null for UTC, a fixed offset, an unknown zone or none', () => {
    for (const zone of ['UTC', 'Etc/UTC', 'Etc/GMT-2', 'Mars/Olympus', null]) {
      mockReported = zone;
      expect(deviceTimeZone()).toBeNull();
    }
  });
});
