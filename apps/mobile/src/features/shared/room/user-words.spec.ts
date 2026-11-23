// 004:T084, round 2 (SRS DEC-107, NFR-SEC-13 as amended; the owner, 2026-11-23: «التشفير والحاجات
// دي متتكتبش لليوزر احنا بس اللي عارفينها»): no text the phone shows names the session's
// encryption. The room's words for it (a session that could not connect, the other side's audio and
// video unavailable) are neutral; this guards every value of both catalogues.
import { describe, expect, it } from '@jest/globals';

import ar from '../../../i18n/ar.json';
import en from '../../../i18n/en.json';

const NAMES_ENCRYPTION = /تشفير|مشف[ّ]?ر|encrypt/i;

/** Every string of a catalogue with its key's path. */
function valuesOf(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) => valuesOf(value, [...path, key]));
}

describe('the phone’s words never name the encryption (DEC-107)', () => {
  it.each([
    ['ar', ar],
    ['en', en],
  ])('the %s catalogue holds no «تشفير», «مشفّر» or «encrypt»', (_locale, catalogue) => {
    const naming = valuesOf(catalogue).filter(([, text]) => NAMES_ENCRYPTION.test(text));
    expect(naming).toEqual([]);
  });

  it('would catch each form the rule names', () => {
    for (const text of ['فك تشفير الصوت', 'مشفّرة', 'مشفرة', 'Encrypted', 'ENCRYPTION']) {
      expect(NAMES_ENCRYPTION.test(text)).toBe(true);
    }
    expect(NAMES_ENCRYPTION.test('تعذّر الاتصال بالجلسة من هذا الجهاز.')).toBe(false);
  });
});
