// T025 — discovery's cursor (R-204; contracts `discoveryCursor`): the last card's rating, review
// count, name and id, written by the server and read back only by it. A cursor it did not write is
// the caller's invalid input, never the internal error. Without a database.
import { DISCOVERY_CURSOR_MAX_LENGTH } from '@ijazah/contracts';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { readCursor, writeCursor } from './discovery-cursor.js';

const ID = '0199d0a0-0000-7000-8000-0000000000d1';

describe('the discovery cursor (T025, R-204)', () => {
  it('reads back the four keys it wrote, a NULL rating and a repeated name included', () => {
    for (const last of [
      { averageRating: '4.5', reviewCount: 12, displayName: 'فاطمة', id: ID },
      { averageRating: '5', reviewCount: 0, displayName: 'Yusuf ALI', id: ID },
      { averageRating: null, reviewCount: 3, displayName: 'مُحَمَّد', id: ID },
    ]) {
      expect(readCursor(writeCursor(last))).toEqual(last);
    }
  });

  it('fits the contract with the longest name', () => {
    const cursor = writeCursor({
      averageRating: '4.99',
      reviewCount: Number.MAX_SAFE_INTEGER,
      displayName: 'مُ'.repeat(80),
      id: ID,
    });
    expect(cursor.length).toBeLessThanOrEqual(DISCOVERY_CURSOR_MAX_LENGTH);
  });

  it('refuses what it did not write as VALIDATION_FAILED on the cursor', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of [
      'not-a-cursor',
      '!!!',
      encode([1, 2]),
      encode(['4.5', 1, 'name']),
      encode(['4.5', -1, 'name', ID]),
      encode(['4.5', 1.5, 'name', ID]),
      encode(['high', 1, 'name', ID]),
      encode(['4.5', 1, 'name', 'not-an-id']),
      encode({ averageRating: '4.5', reviewCount: 1, displayName: 'name', id: ID }),
    ]) {
      let thrown: unknown;
      try {
        readCursor(cursor);
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown, cursor).toBeInstanceOf(DomainError);
      expect((thrown as DomainError).code).toBe('VALIDATION_FAILED');
      expect((thrown as DomainError).details).toEqual([{ path: 'cursor', code: 'invalid' }]);
    }
  });
});
