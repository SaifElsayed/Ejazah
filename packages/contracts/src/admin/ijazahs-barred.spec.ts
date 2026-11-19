// T022 of specs/005-certification — the `ijazahs.barred` schemas of contracts/admin-surface.md (FR-610;
// the note under T022, Q-P2 (b)). Written before the schemas, and run red first.
//
// A barred student gets no new request, so a student barred with no ijazah has no page to lift the bar
// from but this list: a page of the open bars, newest first, after an optional bar id as the cursor.
// Each row names the student (the name null once the account is deleted), the reason, when, and the
// administrator who barred, by id and display name; the next cursor as `ijazahs.list`'s.
import { describe, expect, it } from 'vitest';

import { adminIjazahsBarredInput, adminIjazahsBarredOutput } from './ijazahs.js';

const BAR = '0199d0a0-0000-7000-8000-0000000000d1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000000a1';
const ADMIN = '0199d0a0-0000-7000-8000-0000000000ad';

const ROW = {
  barId: BAR,
  student: { userId: STUDENT, displayName: 'مريم' },
  reason: 'تزوير',
  barredAt: '2026-11-19T09:00:00.000Z',
  barredBy: { adminId: ADMIN, displayName: 'أحمد' },
};

describe('ijazahs.barred (admin-surface.md, Q-P2 (b))', () => {
  it('takes an optional bar id as its cursor, nothing else', () => {
    expect(adminIjazahsBarredInput.parse({})).toEqual({});
    expect(adminIjazahsBarredInput.parse({ cursor: BAR, status: 'lifted' })).toEqual({
      cursor: BAR,
    });
  });

  it('refuses a cursor that is not a bar id', () => {
    expect(adminIjazahsBarredInput.safeParse({ cursor: 'not-an-id' }).success).toBe(false);
  });

  it('answers a page of rows: the student, the reason, when and by whom, and the next cursor', () => {
    expect(adminIjazahsBarredOutput.parse({ items: [ROW], nextCursor: BAR })).toEqual({
      items: [ROW],
      nextCursor: BAR,
    });
    expect(adminIjazahsBarredOutput.parse({ items: [] })).toEqual({ items: [] });
  });

  it("answers a deleted student's name as null", () => {
    const deleted = { ...ROW, student: { userId: STUDENT, displayName: null } };
    expect(adminIjazahsBarredOutput.parse({ items: [deleted] }).items[0]?.student).toEqual({
      userId: STUDENT,
      displayName: null,
    });
  });

  it('keeps nothing beyond the row: no lift columns, no admin key', () => {
    const parsed = adminIjazahsBarredOutput.parse({
      items: [{ ...ROW, liftedAt: null, barredByAdminId: ADMIN, userId: STUDENT }],
    });
    expect(parsed.items[0]).toEqual(ROW);
  });

  it('refuses a row without its administrator or with a time that is not an instant', () => {
    const { barredBy: _barredBy, ...withoutAdmin } = ROW;
    expect(adminIjazahsBarredOutput.safeParse({ items: [withoutAdmin] }).success).toBe(false);
    expect(
      adminIjazahsBarredOutput.safeParse({ items: [{ ...ROW, barredAt: '2026-11-19' }] }).success,
    ).toBe(false);
  });
});
