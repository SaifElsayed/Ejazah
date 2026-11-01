// T030: the i18n runtime (ADR 0020 D6). Arabic is the source locale; `ar.json` and `en.json` are
// the catalogue, parity-checked by `pnpm check:i18n`. No literal user-facing string outside these
// files (R-MOBILE-7); no sentence assembled from fragments (R-MOBILE-8): a value with data in it is
// one ICU MessageFormat template, rendered whole by `t(key, values)`.
//
// DECISIONS (B6, 2026-10-19).
// - A key the catalogue does not hold throws `MissingMessageError`. There is no fallback string:
//   a fallback would put a key name or English on an Arabic screen and hide the gap from every
//   test (task T030). The key type is derived from `ar.json`, so the compiler refuses a typo first.
// - Digits are the Western ones the boards draw in both languages (1,007 runs beside Arabic text
//   on the phone boards, none in Arabic-Indic outside the canvas titles), and the calendar is the
//   Gregorian one the boards draw («15 أكتوبر»); `formattingTag` names both, so ICU's `#` and
//   `lib/formatters.ts` agree.
// - The first locale is the one the native layout direction holds: right-to-left is Arabic and
//   left-to-right English. On a first launch the operating system sets that direction from the
//   device's language (`supportsRTL`, app.json); afterwards it holds what `syncNativeDirection`
//   (lib/direction.ts) last forced, which persists across launches, so the person's choice survives
//   the reload a change of direction needs, with no store of its own. A choice is made with
//   `setLocale`.
// - The guarded `@formatjs/intl-pluralrules` load lives in `lib/plural-rules.ts` and runs here
//   before the first message compiles: R-MOBILE-9 keeps every `Intl` reference in `lib/`.
// - T109 (2026-10-28, approved by the owner): Android takes a paragraph's direction from its first
//   strong character, so «{email} مسجّل بحساب Google.» read left to right. Every value a template
//   interpolates, a `#` included, is wrapped in a first-strong isolate (U+2068 … U+2069), which the
//   paragraph's direction skips; a select or plural chooses on the bare value. An Arabic string
//   that opens with a Latin run («PDF فقط.») starts with a right-to-left mark in `ar.json`.
// - T123 (2026-10-29, the owner's decision): with no strong letter outside the isolates Android
//   falls back to left to right, so «{date} · {time}» read in reverse. `translate` starts such an
//   Arabic rendering with a right-to-left mark; English gains none.
import { IntlMessageFormat } from 'intl-messageformat';
import { useCallback, useSyncExternalStore } from 'react';
import { I18nManager } from 'react-native';

import { ensurePluralRules } from '../lib/plural-rules';
import ar from './ar.json';
import en from './en.json';

export type Locale = 'ar' | 'en';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every key of the catalogue, as `area.screen.element`. */
export type MessageKey = Leaves<typeof ar>;

/** The values a template interpolates: `{name}`, `{count, plural, …}`, `{gender, select, …}`. */
export type MessageValues = Readonly<Record<string, string | number>>;

/** A key the catalogue does not hold, or a branch of it rather than a message. */
export class MissingMessageError extends Error {
  constructor(locale: Locale, key: string) {
    super(`i18n: "${key}" is not a message of ${locale}.json`);
    this.name = 'MissingMessageError';
  }
}

const catalogues: Readonly<Record<Locale, unknown>> = { ar, en };

/** The BCP 47 tag every formatter uses: the locale, the Gregorian calendar, the Latin digits. */
export function formattingTag(locale: Locale): string {
  return `${locale}-u-ca-gregory-nu-latn`;
}

/** The locale a launch starts in, from the native layout direction. */
export function initialLocale(nativeIsRTL: boolean): Locale {
  return nativeIsRTL ? 'ar' : 'en';
}

// Before the first template compiles: ICU's plural branches need Arabic's six categories.
ensurePluralRules();

let active: Locale = initialLocale(I18nManager.isRTL);
const listeners = new Set<() => void>();
const compiled = new Map<string, IntlMessageFormat>();

/** The active locale. */
export function getLocale(): Locale {
  return active;
}

/** Switches the active locale; every `useT` re-renders. */
export function setLocale(locale: Locale): void {
  if (locale === active) return;
  active = locale;
  for (const listener of listeners) listener();
}

/** Subscribes to locale changes; returns the unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The message `key` in the active locale, with `values` interpolated. */
export function t(key: MessageKey, values?: MessageValues): string {
  return translate(active, key, values);
}

/** The message `key` in `locale`. */
export function translate(locale: Locale, key: MessageKey, values?: MessageValues): string {
  const cacheKey = `${locale}:${key}`;
  let format = compiled.get(cacheKey);
  if (format === undefined) {
    const parsed = new IntlMessageFormat(messageOf(locale, key), formattingTag(locale));
    format = new IntlMessageFormat(isolated(parsed.getAst()), formattingTag(locale));
    compiled.set(cacheKey, format);
  }
  const text = format.format(values);
  // The catalogue holds no rich-text tag, so a template always formats to a string.
  if (typeof text !== 'string') throw new TypeError(`i18n: "${key}" did not format to text`);
  return locale === 'ar' && onlyValues(text) ? `${RIGHT_TO_LEFT_MARK}${text}` : text;
}

type Element = ReturnType<IntlMessageFormat['getAst']>[number];

/**
 * The parser's element kinds (`TYPE` of `@formatjs/icu-messageformat-parser`, which
 * `intl-messageformat` does not re-export): a literal, and the values a template interpolates.
 */
const LITERAL = 0;
const VALUES: ReadonlySet<number> = new Set([
  1, // argument, `{name}`
  2, // number
  3, // date
  4, // time
  7, // pound, a plural's `#`
]);
const FIRST_STRONG_ISOLATE = '\u2068';
const POP_DIRECTIONAL_ISOLATE = '\u2069';

const RIGHT_TO_LEFT_MARK = '\u200F';
const ISOLATED_RUNS = /\u2068[^\u2069]*\u2069/g;
const STRONG = /[\p{L}\u200F]/u;

/**
 * Whether `text` holds a value and no strong letter outside the isolates: Android would lay that
 * paragraph out left to right (T123). A string with no value, a separator such as «، », is joined
 * into another paragraph and is never one of its own.
 */
function onlyValues(text: string): boolean {
  const outside = text.replace(ISOLATED_RUNS, '');
  return outside !== text && !STRONG.test(outside);
}

/** `value` between the isolates `translate` puts around every interpolated value (T109). */
export function isolate(value: string): string {
  return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
}

/** The template with every value between isolates, through the branches of a select or plural. */
function isolated(elements: readonly Element[]): Element[] {
  return elements.flatMap((element): Element[] => {
    if (VALUES.has(element.type)) {
      return [literal(FIRST_STRONG_ISOLATE), element, literal(POP_DIRECTIONAL_ISOLATE)];
    }
    if (!('options' in element)) return [element];
    const options = Object.fromEntries(
      Object.entries(element.options).map(([name, option]) => [
        name,
        { ...option, value: isolated(option.value) },
      ]),
    );
    return [{ ...element, options } as Element];
  });
}

function literal(value: string): Element {
  return { type: LITERAL, value } as Element;
}

function messageOf(locale: Locale, key: string): string {
  let node: unknown = catalogues[locale];
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, part)) {
      throw new MissingMessageError(locale, key);
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== 'string') throw new MissingMessageError(locale, key);
  return node;
}

/** The active locale, re-rendering on a change. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** `t` bound to the active locale, re-rendering on a change. */
export function useT(): (key: MessageKey, values?: MessageValues) => string {
  const locale = useLocale();
  return useCallback(
    (key: MessageKey, values?: MessageValues) => translate(locale, key, values),
    [locale],
  );
}
