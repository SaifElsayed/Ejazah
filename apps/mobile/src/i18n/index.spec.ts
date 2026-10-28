// T030: the i18n runtime (ADR 0020 D6, FR-203, R-MOBILE-7/8). The catalogue is the design's copy;
// these cases hold the runtime to it: ICU plurals with Arabic's five forms and zero where the
// design draws it, the digits the boards draw, a missing key that fails loudly, and a hook that
// follows the active locale.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import {
  type MessageKey,
  MissingMessageError,
  formattingTag,
  getLocale,
  initialLocale,
  setLocale,
  t,
  translate,
  useLocale,
  useT,
} from './index';
import { unmarked } from '../design/primitives/__tests__/harness';
import ar from './ar.json';

beforeEach(() => setLocale('ar'));
afterEach(() => {
  jest.restoreAllMocks();
});

describe('t: plurals', () => {
  it('renders the five Arabic forms and the zero the design draws', () => {
    const forms = [0, 1, 2, 3, 11, 100].map((count) =>
      unmarked(t('common.format.sessions', { count })),
    );
    expect(forms).toEqual(['لا جلسات', 'جلسة واحدة', 'جلستان', '3 جلسات', '11 جلسة', '100 جلسة']);
  });

  it('renders the English forms, the drawn zero included', () => {
    setLocale('en');
    const forms = [0, 1, 2].map((count) => unmarked(t('common.format.sessions', { count })));
    expect(forms).toEqual(['No sessions', '1 session', '2 sessions']);
  });

  it('falls back to other for zero where the design draws no zero', () => {
    expect(unmarked(t('common.format.packageShort', { subject: 'تجويد', count: 0 }))).toBe(
      'تجويد · 0 جلسة',
    );
  });

  it('interpolates a value inside one sentence', () => {
    expect(unmarked(t('common.format.timeZone', { city: 'القاهرة' }))).toBe('بتوقيت القاهرة');
  });

  it('writes the Western digits the boards draw, in both languages', () => {
    expect(unmarked(t('common.format.progress', { done: 3, total: 12 }))).toBe('3 من 12');
    expect(unmarked(t('common.format.sessions', { count: 1234 }))).toMatch(/^1,234 /);
  });
});

// T109: Android takes a paragraph's direction from its first strong character, so a Latin value at
// the head of an Arabic sentence turned the sentence left-to-right. Every value is isolated
// (U+2068 … U+2069), and an Arabic string that opens with a Latin run starts with a right-to-left
// mark (U+200F). This is the one spec that asserts the marks; the others compare through
// `unmarked` (design/primitives/__tests__/harness.tsx).
describe('t: a Latin value or opening inside Arabic (T109)', () => {
  it('isolates a value, so the sentence keeps its order and its address whole', () => {
    expect(t('auth.signInConflict.bodyGoogle', { email: 'amal@example.com' })).toBe(
      '⁨amal@example.com⁩ مسجّل بحساب Google. ادخل به.',
    );
    expect(t('teacher.payout.rejected.supportNote', { email: 'support@ijazah.app' })).toBe(
      'إن تكرر الرفض، راسل فريق الدعم: ⁨support@ijazah.app⁩',
    );
  });

  it('isolates a number and a plural count, and chooses a branch on the bare value', () => {
    expect(t('common.format.progress', { done: 3, total: 12 })).toBe('⁨3⁩ من ⁨12⁩');
    expect(t('common.format.sessions', { count: 3 })).toBe('⁨3⁩ جلسات');
    expect(t('common.format.sessions', { count: 1 })).toBe('جلسة واحدة');
    setLocale('en');
    expect(t('common.format.sessions', { count: 2 })).toBe('⁨2⁩ sessions');
  });

  it('starts every Arabic string whose first strong letter is Latin with a right-to-left mark', () => {
    expect(t('teacher.credentials.add.pdfOnly')).toBe('‏PDF فقط.');
    const latinFirst = allKeys().filter((key) =>
      renderings('ar', key).some((text) => {
        // A value is isolated, so the paragraph's direction comes from the text around it.
        const strong = /[\p{L}‏]/u.exec(text.replace(/⁨[^⁩]*⁩/g, ''))?.[0];
        return strong !== undefined && /\p{Script=Latin}/u.test(strong);
      }),
    );
    expect(latinFirst).toEqual([]);
    // English is left-to-right throughout and carries no mark.
    const marked = allKeys().filter((key) =>
      renderings('en', key).some((text) => text.includes('‏')),
    );
    expect(marked).toEqual([]);
  });
});

describe('t: the catalogue is the only source', () => {
  it('throws for a key that is not in the catalogue, never a fallback string', () => {
    expect(() => t('common.action.nope' as MessageKey)).toThrow(MissingMessageError);
    expect(() => t('common' as MessageKey)).toThrow(MissingMessageError);
  });

  it('every key of the Arabic catalogue renders in both languages', () => {
    // Values for every placeholder the catalogue uses, so a template never fails for want of one.
    const values = new Proxy({} as Record<string, string | number>, {
      get: (_target, name) => (name === 'gender' ? 'female' : 1),
      has: () => true,
    });
    for (const locale of ['ar', 'en'] as const) {
      setLocale(locale);
      for (const key of allKeys()) expect(typeof t(key, values)).toBe('string');
    }
  });
});

describe('the active locale', () => {
  it('starts in the language the native layout direction holds', () => {
    // First launch: the operating system lays out right-to-left for a right-to-left device
    // language; afterwards it holds what `syncNativeDirection` last forced, so a choice survives.
    expect(initialLocale(true)).toBe('ar');
    expect(initialLocale(false)).toBe('en');
  });

  it('names the Gregorian calendar and the Latin digits for formatting', () => {
    expect(formattingTag('ar')).toBe('ar-u-ca-gregory-nu-latn');
    expect(formattingTag('en')).toBe('en-u-ca-gregory-nu-latn');
  });

  it('re-renders a component using useT when the locale changes', async () => {
    const { result } = await renderHook(() => ({ t: useT(), locale: useLocale() }));
    expect(result.current.t('common.action.save')).toBe('حفظ');
    await act(async () => setLocale('en'));
    expect(result.current.locale).toBe('en');
    expect(result.current.t('common.action.save')).toBe('Save');
    expect(getLocale()).toBe('en');
  });
});

/** Every leaf key of the Arabic catalogue. */
function allKeys(): MessageKey[] {
  const walk = (node: unknown, prefix: string): string[] =>
    typeof node === 'string'
      ? [prefix]
      : Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
          walk(value, prefix === '' ? key : `${prefix}.${key}`),
        );
  return walk(ar, '') as MessageKey[];
}

/** Every branch `key` renders in `locale`: each plural form and both genders. */
function renderings(locale: 'ar' | 'en', key: MessageKey): string[] {
  return [0, 1, 2, 3, 11, 100].flatMap((count) =>
    (['female', 'male'] as const).map((gender) => {
      const values = new Proxy({} as Record<string, string | number>, {
        get: (_target, name) => (name === 'gender' ? gender : count),
        has: () => true,
      });
      return translate(locale, key, values);
    }),
  );
}
