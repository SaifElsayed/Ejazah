// T035: the admin panel's i18n runtime (FR-175, ADR 0014 D2). Arabic is the default and lays out
// right to left; English lays out left to right. `ar.json` and `en.json` are the catalogue,
// parity-checked by `pnpm check:i18n:admin`; no literal user-facing string lives outside them, and a
// value with data in it is one ICU MessageFormat template rendered whole by `t(key, values)`.
//
// DECISIONS (B8, 2026-10-19), the phone's where they apply (apps/mobile/src/i18n/index.ts).
// - A key the catalogue does not hold throws `MissingMessageError`; there is no fallback string, so
//   a gap shows in every test rather than as a key name on an Arabic page. The key type is derived
//   from `ar.json`, so the compiler refuses a typo first.
// - Digits are Western and the calendar Gregorian, as the boards draw them (`formattingTag`).
// - The language is the browser's, never the account's (FR-175): `setLocale` keeps it in
//   `localStorage` under `LOCALE_STORAGE_KEY`, and `loadStoredLocale` reads it at start
//   (`main.tsx`). A store the browser refuses (a private window, blocked site data) leaves Arabic
//   and the switch still works for the visit. Switching sets `lang` and `dir` on the document root
//   and re-renders every reader of the catalogue; nothing is reloaded and the session is kept.
// - The browser's own `Intl` carries Arabic's six plural categories, so the panel needs no
//   plural-rules polyfill (the phone's Hermes does).
// - 002:T153, its first part, done with T053 (the owner's decision of 2026-11-04): every value a
//   template interpolates, a plural's `#` included, is wrapped in a first-strong isolate (U+2068 …
//   U+2069), as the phone's `t` does since T109, so a Latin name, an order reference or a number
//   placed in an Arabic sentence (or an Arabic name in an English one) keeps the sentence's order;
//   a select or a plural chooses on the bare value. The page's direction is the document's `dir`,
//   not its first strong letter, so the phone's right-to-left mark (T123) is not needed here.
import { IntlMessageFormat } from 'intl-messageformat';
import { useCallback, useSyncExternalStore } from 'react';

import ar from './ar.json';
import en from './en.json';

export type Locale = 'ar' | 'en';

export type Direction = 'rtl' | 'ltr';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every key of the catalogue, as `admin.page.element`. */
export type MessageKey = Leaves<typeof ar>;

/** The values a template interpolates: `{name}`, `{count, plural, …}`, `{gender, select, …}`. */
export type MessageValues = Readonly<Record<string, string | number>>;

/** Where the browser keeps the chosen language. */
export const LOCALE_STORAGE_KEY = 'ijazah.admin.locale';

const DEFAULT_LOCALE: Locale = 'ar';

/** A key the catalogue does not hold, or a group of keys rather than a message. */
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

/** The layout direction of a language. */
export function directionOf(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

let active: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();
const compiled = new Map<string, IntlMessageFormat>();

function isLocale(value: unknown): value is Locale {
  return value === 'ar' || value === 'en';
}

function storedLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function applyToDocument(locale: Locale): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = directionOf(locale);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Reads the browser's stored language, makes it active and lays the document out in it. */
export function loadStoredLocale(): Locale {
  active = storedLocale();
  applyToDocument(active);
  notify();
  return active;
}

/** The active locale. */
export function getLocale(): Locale {
  return active;
}

/** Switches the language, keeps it in the browser, and re-renders every reader of the catalogue. */
export function setLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The browser refuses the store: the switch holds for this visit.
  }
  applyToDocument(locale);
  if (locale === active) return;
  active = locale;
  notify();
}

/** Subscribes to language changes; returns the unsubscribe. */
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
  return text;
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
const FIRST_STRONG_ISOLATE = '⁨';
const POP_DIRECTIONAL_ISOLATE = '⁩';

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
