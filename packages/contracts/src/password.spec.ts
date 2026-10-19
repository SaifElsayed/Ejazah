// T040 (FR-128, research R-105): the password bounds have one home, and the schema both phone and
// API validate against reads them. Length only: no composition rule (NIST SP 800-63B; owner's
// decision 2026-10-19 to keep it so).
import { describe, expect, it } from 'vitest';

import { emailSignInInput, resetPasswordInput } from './auth.js';
import { password, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.js';

describe('the password bounds (T040)', () => {
  it('are eight and 128', () => {
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH]).toEqual([8, 128]);
  });

  it('accept the bounds themselves and refuse one short and one over', () => {
    expect(password.safeParse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
    expect(password.safeParse('a'.repeat(PASSWORD_MAX_LENGTH)).success).toBe(true);
    expect(password.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
    expect(password.safeParse('a'.repeat(PASSWORD_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('ask nothing of the composition: letters only, spaces and Arabic pass', () => {
    for (const chosen of ['abcdefgh', 'انا بحب القهوة الصبح', 'correct horse']) {
      expect(password.safeParse(chosen).success).toBe(true);
    }
  });

  it('is the one schema the sign-in inputs use', () => {
    expect(emailSignInInput.shape.password).toBe(password);
    expect(resetPasswordInput.shape.newPassword).toBe(password);
  });
});
