// T013 of specs/005-certification — the user's `genderFlags.raise` schema of contracts/app-surface.md
// (FR-614; SRS FR-GENDER-3; research R-409). Written before the schema, and run red first.
//
// The caller names the person flagged, a reason and a key; nothing says who the caller is or what
// gender anyone is (R-GENDER-4): a `gender`, `role` or `userId` the client adds is stripped. The
// answer is `{ received: true }` and nothing else; `open_exists` is the one refusal code.
import { describe, expect, it } from 'vitest';

import {
  genderFlagRaiseRefusal,
  genderFlagsRaiseInput,
  genderFlagsRaiseOutput,
} from './gender-flags.js';
import { isIdempotentProcedure } from './idempotent-procedures.js';

const FLAGGED = '0199d0a0-0000-7000-8000-0000000000a2';
const KEY = 'flag-key-for-the-spec-0001';
const REASON = 'الصوت والصورة لا يطابقان الجنس المعلن';

describe('genderFlags.raise', () => {
  it('takes the person flagged, a reason and a key, and is keyed by the kernel', () => {
    expect(
      genderFlagsRaiseInput.parse({ flaggedUserId: FLAGGED, reason: REASON, idempotencyKey: KEY }),
    ).toEqual({ flaggedUserId: FLAGGED, reason: REASON, idempotencyKey: KEY });
    expect(isIdempotentProcedure('genderFlags.raise')).toBe(true);
  });

  it('strips what would say who the caller is or what gender anyone is (R-GENDER-4)', () => {
    expect(
      genderFlagsRaiseInput.parse({
        flaggedUserId: FLAGGED,
        reason: REASON,
        idempotencyKey: KEY,
        gender: 'female',
        role: 'teacher',
        userId: FLAGGED,
      }),
    ).toEqual({ flaggedUserId: FLAGGED, reason: REASON, idempotencyKey: KEY });
  });

  it('refuses no person, a person that is not an id, an empty or over-long reason, and no key', () => {
    for (const input of [
      { reason: REASON, idempotencyKey: KEY },
      { flaggedUserId: 'not-an-id', reason: REASON, idempotencyKey: KEY },
      { flaggedUserId: FLAGGED, reason: '   ', idempotencyKey: KEY },
      { flaggedUserId: FLAGGED, reason: 'x'.repeat(501), idempotencyKey: KEY },
      { flaggedUserId: FLAGGED, reason: REASON },
    ]) {
      expect(genderFlagsRaiseInput.safeParse(input).success).toBe(false);
    }
  });

  it('answers that the flag was received, and nothing of it', () => {
    expect(genderFlagsRaiseOutput.parse({ received: true, flagId: FLAGGED })).toEqual({
      received: true,
    });
    expect(genderFlagsRaiseOutput.safeParse({ received: false }).success).toBe(false);
  });

  it('names open_exists as its one refusal', () => {
    expect(genderFlagRaiseRefusal.options).toEqual(['open_exists']);
  });
});
