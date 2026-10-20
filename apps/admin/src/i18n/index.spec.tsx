// T035: the admin panel's i18n runtime (FR-175, ADR 0014 D2). Arabic is the default and lays out
// right to left; English lays out left to right; the choice is the browser's (`localStorage`),
// never the account's, and switches without signing out.
import { act, render, screen } from '@testing-library/react';
import { IntlMessageFormat } from 'intl-messageformat';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ar from './ar.json';
import en from './en.json';
import {
  directionOf,
  formattingTag,
  getLocale,
  loadStoredLocale,
  LOCALE_STORAGE_KEY,
  MissingMessageError,
  type MessageKey,
  setLocale,
  t,
  translate,
  useLocale,
  useT,
} from './index';
import { UserText } from './UserText';

function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  loadStoredLocale();
});

describe('the language at load', () => {
  it('is Arabic, right to left, when nothing is stored', () => {
    expect(loadStoredLocale()).toBe('ar');
    expect(getLocale()).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('is the stored language when one is stored', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(loadStoredLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('is Arabic when the stored value is not a language of the panel', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(loadStoredLocale()).toBe('ar');
  });

  it('is Arabic when the browser refuses the store (private mode, blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(loadStoredLocale()).toBe('ar');
  });
});

describe('a change of language', () => {
  it('is kept in the browser and lays the document out in its direction', () => {
    setLocale('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    setLocale('ar');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('still switches when the browser refuses to keep it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('never reaches the server: the language is not on the account (FR-175)', () => {
    const network = vi.spyOn(globalThis, 'fetch');
    setLocale('en');
    setLocale('ar');
    expect(network).not.toHaveBeenCalled();
  });

  it('re-renders every screen that reads the catalogue, with no reload', () => {
    function Probe() {
      const translateNow = useT();
      return <p data-locale={useLocale()}>{translateNow('admin.nav.items.home')}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('نظرة عامة').dataset['locale']).toBe('ar');
    act(() => setLocale('en'));
    expect(screen.getByText('Overview').dataset['locale']).toBe('en');
  });
});

describe('the messages', () => {
  it('reads a message in the active language', () => {
    expect(t('admin.signIn.title')).toBe('دخول الإدارة');
    expect(translate('en', 'admin.signIn.title')).toBe(en.admin.signIn.title);
  });

  it('refuses a key the catalogue does not hold, and a group of keys, with no fallback text', () => {
    expect(() => t('admin.signIn.missing' as MessageKey)).toThrow(MissingMessageError);
    expect(() => t('admin.signIn' as MessageKey)).toThrow(MissingMessageError);
  });

  it('chooses Arabic plural forms and writes Latin digits, as the boards draw', () => {
    expect(translate('ar', 'admin.admins.detail.auditEntriesCount', { count: 2 })).toBe('قيدان');
    expect(translate('ar', 'admin.admins.detail.auditEntriesCount', { count: 12 })).toBe(
      '12 قيدًا',
    );
    expect(formattingTag('ar')).toBe('ar-u-ca-gregory-nu-latn');
  });

  it('compiles every message of both catalogues', () => {
    for (const [locale, catalogue] of [
      ['ar', ar],
      ['en', en],
    ] as const) {
      for (const [key, message] of leaves(catalogue)) {
        expect(
          () => new IntlMessageFormat(message, formattingTag(locale)),
          `${locale}: ${key}`,
        ).not.toThrow();
      }
    }
  });

  it('names the direction of each language', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });
});

describe('UserText', () => {
  it('shows what a person typed as typed, isolated for direction', () => {
    const { container } = render(
      <p>
        {t('admin.nav.brand')} <UserText>Sara Adel (QA)</UserText>
      </p>,
    );
    const isolated = container.querySelector('bdi');
    expect(isolated?.textContent).toBe('Sara Adel (QA)');
  });
});
