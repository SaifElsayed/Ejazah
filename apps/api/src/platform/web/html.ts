// T019: the escaping tagged template of the public pages (FR-144, ADR 0021 D5, research R-111;
// specs/002-identity/contracts/public-pages.md).
//
// Escaping is the template's only mode: every interpolated value is written as text, with the five
// characters HTML reads as markup replaced by their references, so no value a client sent, a
// setting holds or a person typed can become an element, an attribute or a script. The one way to
// insert markup is `raw()`, on a string the server built itself (a pre-rendered Terms fragment, a
// nested template's result), and a `SafeHtml` is never built from a value any other way: the class
// has no public constructor and `raw()` is the only factory, so a reviewer finds every unescaped
// insertion by searching for `raw(`.
//
// A template's result is itself `SafeHtml`, so templates nest without a second escape, and a list
// of results is written in order. `null` and `undefined` write nothing, a number or a boolean its
// text. Quotes are escaped too, so a value may sit inside a quoted attribute as well as in text.
// There is no attribute-name or URL position: a template never puts a value where HTML would read
// it as a name, and a URL is a server constant.

/** Known to the factory alone: a constructor call from anywhere else throws. */
const FACTORY: unique symbol = Symbol('SafeHtml');

/** Markup the server built, safe to insert as it is. Only `raw()` and `html` produce one. */
export class SafeHtml {
  readonly #markup: string;

  private constructor(markup: string, key: symbol) {
    if (key !== FACTORY)
      throw new TypeError('SafeHtml is built by raw() or the html template only.');
    this.#markup = markup;
  }

  /** The markup, for the response body or an enclosing template. */
  toString(): string {
    return this.#markup;
  }
}

/** The one factory, private to this module: `raw()` and the template are its only callers. */
function safe(markup: string): SafeHtml {
  // The class keeps the constructor private in the type; the symbol keeps it private at runtime.
  return new (SafeHtml as unknown as new (markup: string, key: symbol) => SafeHtml)(
    markup,
    FACTORY,
  );
}

/** Marks a string the server built as markup. Never for a value that came from outside. */
export function raw(markup: string): SafeHtml {
  return safe(markup);
}

const references: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** `text` with every character HTML reads as markup replaced by its reference. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => references[character] ?? character);
}

/** What a template may interpolate; anything else is a type error, not a string by accident. */
export type Interpolation =
  string | number | boolean | null | undefined | SafeHtml | readonly Interpolation[];

function write(value: Interpolation): string {
  if (value === null || value === undefined) return '';
  if (value instanceof SafeHtml) return value.toString();
  if (Array.isArray(value)) return (value as readonly Interpolation[]).map(write).join('');
  return escapeHtml(String(value));
}

/** The tagged template: every interpolation escaped, a `SafeHtml` inserted as it is. */
export function html(strings: TemplateStringsArray, ...values: readonly Interpolation[]): SafeHtml {
  let markup = '';
  strings.forEach((part, index) => {
    markup += part;
    if (index < values.length) markup += write(values[index]);
  });
  return safe(markup);
}
