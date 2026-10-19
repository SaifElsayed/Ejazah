// T030: the guarded plural-rules load the i18n runtime runs first (ADR 0020 D6).
import { afterEach, describe, expect, it } from '@jest/globals';

import { ensurePluralRules } from './plural-rules';

describe('the guarded plural-rules load', () => {
  const native = Intl.PluralRules;
  afterEach(() => {
    Object.defineProperty(Intl, 'PluralRules', {
      value: native,
      configurable: true,
      writable: true,
    });
  });

  it('leaves a runtime that already knows Arabic plurals alone', () => {
    expect(ensurePluralRules()).toBe(false);
    expect(Intl.PluralRules).toBe(native);
  });

  it('loads the polyfill and both locales where the runtime has none', () => {
    Object.defineProperty(Intl, 'PluralRules', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    expect(ensurePluralRules()).toBe(true);
    expect(new Intl.PluralRules('ar').select(3)).toBe('few');
    expect(new Intl.PluralRules('ar').select(0)).toBe('zero');
    expect(new Intl.PluralRules('en').select(1)).toBe('one');
  });
});
