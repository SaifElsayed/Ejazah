// T019: the one page layout of the public routes (FR-144, research R-111; public-pages.md
// "Headers every route sends", docs/design/screens.md's web pages).
//
// The document's language and direction come from the route's `lang` (`ar` and `dir="rtl"` unless
// `?lang=en`), the stylesheets are the design's two, served by this API under `/public/design/`
// (`route.ts`), and nothing is inline: no `<script>`, no `style=` attribute, no `<style>` element,
// so the strict Content-Security-Policy the route helper sends (`default-src 'none'; style-src
// 'self'; …`) is what the page needs and no more. A page's body is a `SafeHtml` built by the
// escaping template, and its title is escaped here like any other value.
import type { Locale } from '../../surfaces/context.js';
import { html, type SafeHtml } from './html.js';

/** Where the design's stylesheets are served (public-pages.md "The pages"). */
export const DESIGN_ASSETS_PATH = '/public/design';

/** The two stylesheets every page links, in order: the tokens, then the components. */
export const DESIGN_STYLESHEETS = ['tokens.css', 'components.css'] as const;

export interface Page {
  readonly lang: Locale;
  /** The document title; escaped. */
  readonly title: string;
  /** The body, built by the escaping template. */
  readonly body: SafeHtml;
}

/** The direction a language is written in. */
export function directionOf(lang: Locale): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** The whole document for one page. */
export function renderPage({ lang, title, body }: Page): SafeHtml {
  const stylesheets = DESIGN_STYLESHEETS.map(
    (file) => html`<link rel="stylesheet" href="${DESIGN_ASSETS_PATH}/${file}" />`,
  );
  return html`<!doctype html>
    <html lang="${lang}" dir="${directionOf(lang)}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title}</title>
        ${stylesheets}
      </head>
      <body>
        ${body}
      </body>
    </html> `;
}
