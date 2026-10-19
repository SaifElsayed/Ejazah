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
    format = new IntlMessageFormat(messageOf(locale, key), formattingTag(locale));
    compiled.set(cacheKey, format);
  }
  const text = format.format(values);
  if (typeof text !== 'string') throw new MissingMessageError(locale, key);
  return text;
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
