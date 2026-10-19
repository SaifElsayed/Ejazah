// T030: the guarded `@formatjs/intl-pluralrules` load the i18n runtime runs before its first
// message compiles (ADR 0020 D6). It lives in `lib/` because R-MOBILE-9 keeps every `Intl`
// reference there (`mobile/no-manual-format`).

/**
 * Loads the `Intl.PluralRules` polyfill and the rules of the two locales when the runtime lacks
 * the constructor or lacks Arabic's categories (Hermes builds differ); a runtime that has them is
 * left alone. True when the polyfill was loaded.
 */
export function ensurePluralRules(): boolean {
  if (typeof Intl.PluralRules === 'function' && pluralRulesKnowArabic()) return false;
  require('@formatjs/intl-pluralrules/polyfill-force.js');
  require('@formatjs/intl-pluralrules/locale-data/ar');
  require('@formatjs/intl-pluralrules/locale-data/en');
  return true;
}

function pluralRulesKnowArabic(): boolean {
  try {
    return new Intl.PluralRules('ar').resolvedOptions().pluralCategories.includes('few');
  } catch {
    return false;
  }
}
