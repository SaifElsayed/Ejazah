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
      '\u2068amal@example.com\u2069 مسجّل بحساب Google. ادخل به.',
    );
    expect(t('teacher.payout.rejected.supportNote', { email: 'support@ijazah.app' })).toBe(
      'إن تكرر الرفض، راسل فريق الدعم: \u2068support@ijazah.app\u2069',
    );
  });

  it('isolates a number and a plural count, and chooses a branch on the bare value', () => {
    expect(t('common.format.progress', { done: 3, total: 12 })).toBe(
      '\u20683\u2069 من \u206812\u2069',
    );
    expect(t('common.format.sessions', { count: 3 })).toBe('\u20683\u2069 جلسات');
    expect(t('common.format.sessions', { count: 1 })).toBe('جلسة واحدة');
    setLocale('en');
    expect(t('common.format.sessions', { count: 2 })).toBe('\u20682\u2069 sessions');
  });

  it('starts every Arabic string whose first strong letter is Latin, or that has none, with a right-to-left mark', () => {
    expect(t('teacher.credentials.add.pdfOnly')).toBe('\u200FPDF فقط.');
    const notRightToLeft = allKeys().filter((key) =>
      renderings('ar', key).some((text) => {
        // A value is isolated, so the paragraph's direction comes from the text around it; with no
        // strong letter there, Android falls back to left to right (T123). A string with no value
        // («، », the chain's separator) is joined into another paragraph, never one of its own.
        const strong = /[\p{L}\u200F]/u.exec(text.replace(/\u2068[^\u2069]*\u2069/g, ''))?.[0];
        if (strong === undefined) return text.includes('\u2068');
        return /\p{Script=Latin}/u.test(strong);
      }),
    );
    expect(notRightToLeft).toEqual([]);
    // English is left-to-right throughout and carries no mark.
    const marked = allKeys().filter((key) =>
      renderings('en', key).some((text) => text.includes('\u200F')),
    );
    expect(marked).toEqual([]);
  });
});

// T123: Android falls back to left to right when a paragraph has no strong letter outside its
// isolates, so an Arabic template made only of values («{date} · {time}») read in reverse. Its
// Arabic rendering starts with a right-to-left mark; its English one gains none.
describe('t: an Arabic template made only of values (T123)', () => {
  // The 37 keys of `ar.json` on 2026-10-29 (tasks.md T123).
  const valuesOnly: readonly MessageKey[] = [
    'common.format.dateTime',
    'common.package.withTeacher',
    'common.time.dateTime',
    'common.time.inZone',
    'common.time.range',
    'notifications.items.enrollmentTerminated.body',
    'notifications.items.reminderTomorrow.body',
    'notifications.teacher.ijazahApproved.meta',
    'notifications.teacher.sessionSoon.meta',
    'session.ended.timeValue',
    'session.pre.teacher.timeRange',
    'session.room.timer',
    'student.cancelPicker.option',
    'student.cancelRequest.sessionValue',
    'student.cancelRespond.quote',
    'student.checkout.slotWithCity',
    'student.checkoutConfirmed.sessionDate',
    'student.checkoutProcessing.summary',
    'student.credentials.teacherIssued',
    'student.discovery.card.meta',
    'student.discovery.card.ratingCount',
    'student.dispute.sessionMeta',
    'student.enrollmentDetail.session.row',
    'student.enrollments.reviewPrompt.subtitle',
    'student.home.package',
    'student.home.sessionTitle',
    'student.makeupProposal.slot',
    'student.teacherProfile.genderSubject',
    'student.teacherProfile.isnad.meta',
    'student.teacherProfile.isnad.more',
    'student.teacherProfile.reviewLine',
    'student.teacherReviews.reviewMeta',
    'teacher.cancel.picker.option',
    'teacher.enrollment.sessions.row',
    'teacher.ijazahRequest.sent.sentAtValue',
    'teacher.profile.subjectWithRiwaya',
    'web.verify.issuedValue',
  ];

  it('starts with one right-to-left mark in Arabic', () => {
    expect(t('common.time.range', { start: '9:00', end: '10:00' })).toBe(
      '\u200F\u20689:00\u2069 – \u206810:00\u2069',
    );
    const unmarkedKeys = valuesOnly.filter((key) =>
      renderings('ar', key).some((text) => !/^\u200F(?!\u200F)/u.test(text)),
    );
    expect(unmarkedKeys).toEqual([]);
  });

  it('gains no mark in English', () => {
    setLocale('en');
    expect(t('common.time.range', { start: '9:00', end: '10:00' })).toBe(
      '\u20689:00\u2069 – \u206810:00\u2069',
    );
    const markedKeys = valuesOnly.filter((key) =>
      renderings('en', key).some((text) => text.includes('\u200F')),
    );
    expect(markedKeys).toEqual([]);
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

describe('t: a weekly time in Arabic (B31, decided 2026-11-04)', () => {
  it('says «كل يوم الأربعاء», since the weekday formatter gives the name with its article', () => {
    // `format.weekday` answers «الأربعاء»; «كل الأربعاء» is not Arabic, «كل يوم الأربعاء» is.
    const bare = allKeys().filter((key) => /كل \{(weekday|day)\}/u.test(translateRaw(key)));
    expect(bare).toEqual([]);
    expect(
      t('student.enrollmentDetail.weekly', { weekday: 'الأربعاء', time: '9:00', city: 'القاهرة' }),
    ).toContain('كل يوم ⁨الأربعاء⁩');
  });
});

/** The Arabic template of `key` as the catalogue holds it. */
function translateRaw(key: MessageKey): string {
  return key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], ar) as string;
}

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
