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
  useLocale,
  useT,
} from './index';
import ar from './ar.json';

beforeEach(() => setLocale('ar'));
afterEach(() => {
  jest.restoreAllMocks();
});

describe('t: plurals', () => {
  it('renders the five Arabic forms and the zero the design draws', () => {
    const forms = [0, 1, 2, 3, 11, 100].map((count) => t('common.format.sessions', { count }));
    expect(forms).toEqual(['لا جلسات', 'جلسة واحدة', 'جلستان', '3 جلسات', '11 جلسة', '100 جلسة']);
  });

  it('renders the English forms, the drawn zero included', () => {
    setLocale('en');
    const forms = [0, 1, 2].map((count) => t('common.format.sessions', { count }));
    expect(forms).toEqual(['No sessions', '1 session', '2 sessions']);
  });

  it('falls back to other for zero where the design draws no zero', () => {
    expect(t('common.format.packageShort', { subject: 'تجويد', count: 0 })).toBe('تجويد · 0 جلسة');
  });

  it('interpolates a value inside one sentence', () => {
    expect(t('common.format.timeZone', { city: 'القاهرة' })).toBe('بتوقيت القاهرة');
  });

  it('writes the Western digits the boards draw, in both languages', () => {
    expect(t('common.format.progress', { done: 3, total: 12 })).toBe('3 من 12');
    expect(t('common.format.sessions', { count: 1234 })).toMatch(/^1,234 /);
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
