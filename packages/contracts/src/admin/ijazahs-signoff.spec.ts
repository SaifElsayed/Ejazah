// T032 of specs/005-certification — the `ijazahs.signOff` and `ijazahs.rerender` schemas of
// contracts/admin-surface.md (FR-629; R-402; the note under T032, Q7 (a)). Written before the
// schemas, and run red first. Both are keyed; the re-render needs a reason; the refusals are the
// rendering not done, the revocation, a sign-off already made and the student barred.
import { describe, expect, it } from 'vitest';

import {
  adminIjazahsRerenderInput,
  adminIjazahsSignOffInput,
  ijazahSignOffRefusal,
} from './ijazahs.js';

const IJAZAH = '0199d0a0-0000-7000-8000-0000000000b1';
const KEY = 'decision-key-for-the-spec-0001';

describe('ijazahs.signOff (FR-629)', () => {
  it('takes the ijazah and a key, nothing else', () => {
    expect(
      adminIjazahsSignOffInput.parse({ ijazahId: IJAZAH, idempotencyKey: KEY, extra: 1 }),
    ).toEqual({ ijazahId: IJAZAH, idempotencyKey: KEY });
    expect(adminIjazahsSignOffInput.safeParse({ ijazahId: IJAZAH }).success).toBe(false);
    expect(adminIjazahsSignOffInput.safeParse({ ijazahId: 'x', idempotencyKey: KEY }).success).toBe(
      false,
    );
  });

  it('names its four refusals, the barred student among them (Q7 (a))', () => {
    expect(ijazahSignOffRefusal.options).toEqual([
      'not_rendered',
      'revoked',
      'already_signed_off',
      'student_barred',
    ]);
  });
});

describe('ijazahs.rerender (FR-629)', () => {
  it('takes the ijazah, a reason and a key', () => {
    expect(
      adminIjazahsRerenderInput.parse({ ijazahId: IJAZAH, reason: ' الخط ', idempotencyKey: KEY }),
    ).toEqual({ ijazahId: IJAZAH, reason: 'الخط', idempotencyKey: KEY });
    expect(
      adminIjazahsRerenderInput.safeParse({ ijazahId: IJAZAH, idempotencyKey: KEY }).success,
    ).toBe(false);
    expect(
      adminIjazahsRerenderInput.safeParse({ ijazahId: IJAZAH, reason: '  ', idempotencyKey: KEY })
        .success,
    ).toBe(false);
    expect(adminIjazahsRerenderInput.safeParse({ ijazahId: IJAZAH, reason: 'الخط' }).success).toBe(
      false,
    );
  });
});
