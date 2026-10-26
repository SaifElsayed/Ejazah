// T083 (FR-144, the B16 check's decision 7): the words of the public pages, and the one way a value
// enters a line of them.
//
// The words are the phone catalogue's: `scripts/build-web-copy.ts` copies the keys the pages name
// into `i18n/ar.ts` and `i18n/en.ts` beside this file, under `check:generated`, so a page and the
// phone never say a thing two ways. The English module must have the Arabic one's shape, which the
// type below holds as `check:i18n` holds it for the catalogue.
//
// A line with a placeholder (`{email}`) is filled by `fill`, never by string replacement: the line's
// own text and every value are written through the escaping template (`html.ts`), and a value the
// server built as markup (an address in its left-to-right span) is inserted as it is.
import type { Locale } from '../http/locale.js';
import { html, type Interpolation, type SafeHtml } from './html.js';
import { ar } from './i18n/ar.js';
import { en } from './i18n/en.js';

/** The pages' copy in one language: the catalogue's keys at their own paths. */
export type WebCopy = typeof ar;

const catalogues: Readonly<Record<Locale, WebCopy>> = { ar, en };

/** The copy of `lang`. */
export function copyOf(lang: Locale): WebCopy {
  return catalogues[lang];
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** `line` with each `{name}` replaced by `values[name]`, all of it escaped but built markup. */
export function fill(line: string, values: Readonly<Record<string, Interpolation>>): SafeHtml {
  const parts: Interpolation[] = [];
  let from = 0;
  for (const match of line.matchAll(PLACEHOLDER)) {
    const [placeholder, name = ''] = match;
    if (!Object.hasOwn(values, name)) {
      throw new Error(`The line names {${name}}, and no value was given for it.`);
    }
    parts.push(line.slice(from, match.index), values[name]);
    from = match.index + placeholder.length;
  }
  parts.push(line.slice(from));
  return html`${parts}`;
}
