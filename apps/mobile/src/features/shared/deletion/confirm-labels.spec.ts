// T160 (found by T092's run, §7's English look, 2026-10-29): DeletionSheet puts its confirm label in
// the design system's Button, which draws one line, so «Confirm with your password and delete the
// account» read «Confirm with your password and del…» on the owner's Android phone. The owner chose
// the shorter English text and left Button unchanged (2026-11-01), so these cases hold each English
// label, for the three sign-in methods and both roles, to a length that fits that one line.
//
// The bound: the narrowest phone taken here is 320dp wide. The sheet's gutter (layout.gutter, 20 on
// each side) leaves 280, and a large Button's padding (space['5'], 20 on each side) leaves about 240
// for the label. The label is Inter bold at 16 (text.headline), whose Latin glyphs average about
// 0.6 em, so roughly 9.6dp each: 240 / 9.6 is 25 characters. 24 keeps a character of margin.
// Arabic is not bounded here; its look is checked on the device.
import { describe, expect, it } from '@jest/globals';

import { type MessageKey, translate } from '../../../i18n';

const ONE_LINE = 24;

const roles = [
  { role: 'student', block: 'account.delete.sheet' },
  { role: 'teacher', block: 'teacher.deleteAccount.sheet' },
] as const;

const labels = [
  { method: 'email', key: 'confirmEmail', text: 'Delete with password' },
  { method: 'google', key: 'confirmGoogle', text: 'Delete with Google' },
  { method: 'apple', key: 'confirmApple', text: 'Delete with Apple' },
] as const;

const cases = roles.flatMap(({ role, block }) =>
  labels.map(({ method, key, text }) => ({
    role,
    method,
    key: `${block}.${key}` as MessageKey,
    text,
  })),
);

describe("the deletion sheet's English confirm label", () => {
  it.each(cases)('reads «$text» for a $role signed in by $method', ({ key, text }) => {
    expect(translate('en', key)).toBe(text);
  });

  it.each(cases)('fits one line for a $role signed in by $method', ({ key }) => {
    expect(translate('en', key).length).toBeLessThanOrEqual(ONE_LINE);
  });
});
