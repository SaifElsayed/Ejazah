// R3 T185 (with `specs/004-sessions/tasks.md` T078): `GET /privacy` (public-pages.md "The pages";
// PLAN.md, «Privacy policy and terms publicly hosted»). The privacy policy: a pre-rendered HTML
// fragment per language, `ar.html` and `en.html` beside this file, server-built and inserted with
// `raw()`, as the Terms' are (`terms/terms.controller.ts`), but with no version setting: the version
// and the effective date are part of the text. The app's privacy modal is a WebView of this route,
// opened from the account screen and the sign-up's Terms sentence, and Play's listing links it, its
// deletion section by the anchor `#delete-account`.
//
// The route is the kernel's: static content (R-111), written over the page helper (`route.ts`),
// which applies the strict policy, strips any cookie, counts the anonymous limit per client address
// and reads `?lang=en` (Arabic otherwise); `main.ts` mounts it under `PRIVACY_PATH`. `?theme=dark`
// or `?theme=light` draws the page in that scheme, as the Terms' (T105); any other value is ignored.
//
// The text is the owner's decisions of 2026-11-28 (R3's ق1 to ق5) over `r3\research\privacy.md`
// §4, a draft so marked, Arabic first and prevailing. The fragments are read from the package root
// at mount, so the built `dist/` serves the same files; a missing fragment stops the start.
import { readFileSync } from 'node:fs';
import type { Locale } from '../../http/locale.js';
import { html, raw, type SafeHtml } from '../html.js';
import { PAGE_THEMES, type PageTheme, renderPage } from '../page.js';
import type { WebRoute } from '../route.js';

/** Where the privacy policy is served (public-pages.md). */
export const PRIVACY_PATH = '/privacy';

const FRAGMENTS_DIRECTORY = new URL('../../../../src/platform/web/privacy/', import.meta.url);

const titles: Readonly<Record<Locale, string>> = {
  ar: 'سياسة الخصوصية',
  en: 'Privacy Policy',
};

/** The two fragments, read once at mount; each a server-built file, so marked safe. */
function readFragments(): Readonly<Record<Locale, SafeHtml>> {
  const read = (lang: Locale): SafeHtml =>
    raw(readFileSync(new URL(`${lang}.html`, FRAGMENTS_DIRECTORY), 'utf8'));
  return { ar: read('ar'), en: read('en') };
}

/** The scheme `?theme=` asks for, when it is one of the design's; nothing otherwise. */
function themeOf(query: URLSearchParams): PageTheme | undefined {
  const asked = query.get('theme');
  return PAGE_THEMES.find((theme) => theme === asked);
}

export function privacyRoute(): WebRoute {
  const fragments = readFragments();
  return {
    handle: ({ lang, query }) => {
      const title = titles[lang];
      return {
        page: renderPage({
          lang,
          theme: themeOf(query),
          title,
          body: html`<main class="web-surface gutter">
            <header>
              <h1>${title}</h1>
            </header>
            ${fragments[lang]}
          </main>`,
        }),
      };
    },
  };
}
