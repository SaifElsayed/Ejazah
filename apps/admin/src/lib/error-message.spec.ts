// T058 of specs/004-sessions (plan.md decision 7; the owner's decisions of 2026-11-06 on the fifth
// analysis and on the sixth, item 6): a refusal of `RATE_LIMITED` says when to try again when the
// server says it (T062's `retryAfterSeconds` detail, contracts/README.md "Errors"), and without a
// time to wait a little; every other failure keeps the page's own generic key. In Arabic and English.
import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';

import { type Locale, translate } from '../i18n';
import { refusal } from '../test/app-harness';
import { errorMessageKey } from './error-message';

const rateLimitedAfter = (seconds: string) =>
  refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: seconds }]);

const said = (locale: Locale, error: unknown) => {
  const { key, values } = errorMessageKey(error, 'admin.dialogs.submitError');
  return translate(locale, key, values);
};

describe('errorMessageKey: RATE_LIMITED with the time to wait', () => {
  it.each([
    ['31', 1],
    ['61', 2],
    ['120', 2],
    ['60', 1],
    ['1', 1],
  ])('%s seconds → try again in %i minute(s), rounded up', (seconds, count) => {
    expect(errorMessageKey(rateLimitedAfter(seconds), 'admin.dialogs.submitError')).toEqual({
      key: 'admin.common.rateLimitedIn',
      values: { count },
    });
  });

  it('says one minute and two minutes in Arabic and English', () => {
    expect(said('ar', rateLimitedAfter('31'))).toBe(
      'طلبات كثيرة. لم يتغيّر شيء؛ حاول مرة أخرى بعد دقيقة.',
    );
    expect(said('ar', rateLimitedAfter('61'))).toBe(
      'طلبات كثيرة. لم يتغيّر شيء؛ حاول مرة أخرى بعد دقيقتين.',
    );
    expect(said('ar', rateLimitedAfter('120'))).toBe(
      'طلبات كثيرة. لم يتغيّر شيء؛ حاول مرة أخرى بعد دقيقتين.',
    );
    expect(said('en', rateLimitedAfter('31'))).toBe(
      'Too many requests. Nothing changed; try again in ⁨1⁩ minute.',
    );
    expect(said('en', rateLimitedAfter('120'))).toBe(
      'Too many requests. Nothing changed; try again in ⁨2⁩ minutes.',
    );
  });
});

describe('errorMessageKey: RATE_LIMITED without a readable time', () => {
  it.each([
    ['no details', refusal('RATE_LIMITED')],
    ['another detail', refusal('RATE_LIMITED', [{ path: 'limit', code: '30' }])],
    ['zero', rateLimitedAfter('0')],
    ['a negative number', rateLimitedAfter('-5')],
    ['a fraction', rateLimitedAfter('1.5')],
    ['text', rateLimitedAfter('soon')],
    ['empty text', rateLimitedAfter('')],
  ])('%s → the message without a time', (_name, error) => {
    expect(errorMessageKey(error, 'admin.dialogs.submitError')).toEqual({
      key: 'admin.common.rateLimited',
    });
  });

  it('says to wait a little in Arabic and English', () => {
    expect(said('ar', refusal('RATE_LIMITED'))).toBe(
      'طلبات كثيرة. لم يتغيّر شيء؛ انتظر قليلًا ثم حاول مرة أخرى.',
    );
    expect(said('en', refusal('RATE_LIMITED'))).toBe(
      'Too many requests. Nothing changed; wait a little and try again.',
    );
  });
});

describe('errorMessageKey: every other failure keeps the page’s own key', () => {
  it.each([
    ['another code', refusal('INTERNAL')],
    ['another code carrying a time', refusal('CONFLICT', [{ path: 'retryAfterSeconds', code: '61' }])],
    ['a network failure', new TRPCClientError('Failed to fetch')],
    ['an error the API never sent', new Error('offline')],
    ['nothing at all', undefined],
  ])('%s → the fallback', (_name, error) => {
    expect(errorMessageKey(error, 'admin.common.loadError.text')).toEqual({
      key: 'admin.common.loadError.text',
    });
    expect(errorMessageKey(error, 'admin.dialogs.submitError')).toEqual({
      key: 'admin.dialogs.submitError',
    });
  });

  it('says the fallback’s own words in Arabic and English', () => {
    for (const locale of ['ar', 'en'] as const) {
      expect(said(locale, refusal('INTERNAL'))).toBe(
        translate(locale, 'admin.dialogs.submitError'),
      );
    }
  });
});
