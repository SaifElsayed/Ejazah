// T039: `GET /terms` (FR-127, ADR 0021 D5, research R-111; public-pages.md "The pages"). The
// Terms body with its version: a pre-rendered HTML fragment per language, `ar.html` and `en.html`
// beside this file, server-built and inserted with `raw()`, so no Markdown dependency and nothing
// from outside the server reaches the markup unescaped; the version shown is the `terms_version`
// setting, read on every request through the settings reader (FR-034), the same value
// `platform.publicConfig` answers and `onboarding.complete` requires. The app's Terms modal is a
// WebView of this route, and the account tab's row opens it.
//
// The route is the kernel's: static content with a setting (R-111). It is written over the page
// helper (`route.ts`), which applies the strict policy, strips any cookie, counts the anonymous
// limit per client address and reads `?lang=en`; `main.ts` mounts it under `TERMS_PATH`.
//
// The fragments are placeholder bodies, marked as a draft for counsel in the text itself, with the
// sections the drawn board lists (docs/design/screens.md, "Terms"): the technology intermediary,
// payment, compensation (the make-up and refund rule), identity and gender, conduct (no refund on
// a suspension or ban), and the closing line about notice before a change. The effective date the
// board draws beside the version has no source yet: the version alone is shown until one exists.
//
// T105: `?theme=dark` or `?theme=light` draws the page in that scheme (the app's WebView passes its
// own); any other value is ignored and never reaches the markup. The body is drawn on
// `.web-surface`, which paints the scheme's background and text, inside the design's `gutter`.
//
// The copies are read from the package root, so the built `dist/` (which `tsc` emits without
// `.html` files) serves the same fragments; a missing fragment stops the start.
import { readFileSync } from 'node:fs';
import { termsVersion } from '@ijazah/contracts';
import type { Locale } from '../../http/locale.js';
import { TERMS_VERSION_SETTING } from '../../settings/keys.js';
import type { SettingsReader } from '../../settings/settings-reader.js';
import { html, raw, type SafeHtml } from '../html.js';
import { PAGE_THEMES, type PageTheme, renderPage } from '../page.js';
import type { WebRoute } from '../route.js';

/** Where the Terms are served (public-pages.md). */
export const TERMS_PATH = '/terms';

const FRAGMENTS_DIRECTORY = new URL('../../../../src/platform/web/terms/', import.meta.url);

const texts: Readonly<Record<Locale, { readonly title: string; readonly version: string }>> = {
  ar: { title: 'الشروط والأحكام', version: 'الإصدار' },
  en: { title: 'Terms and Conditions', version: 'Version' },
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

export interface TermsRouteDependencies {
  readonly settings: SettingsReader;
}

export function termsRoute({ settings }: TermsRouteDependencies): WebRoute {
  const fragments = readFragments();
  return {
    handle: async ({ lang, query }) => {
      const version = await settings.read(TERMS_VERSION_SETTING, termsVersion);
      const text = texts[lang];
      return {
        page: renderPage({
          lang,
          theme: themeOf(query),
          title: text.title,
          body: html`<main class="web-surface gutter">
            <header>
              <h1>${text.title}</h1>
              <p class="tone-muted">${text.version} ${version}</p>
            </header>
            ${fragments[lang]}
          </main>`,
        }),
      };
    },
  };
}
