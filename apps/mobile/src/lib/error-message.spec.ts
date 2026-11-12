// T065 of specs/004-sessions (the owner's decisions of 2026-11-06 on the fifth analysis and on the
// sixth, item 6): a refusal of `RATE_LIMITED` says when to try again when the server says it
// (T062's `retryAfterSeconds` detail, contracts/README.md "Errors"), and without a time to wait a
// little; every other failure keeps the screen's own generic message.
import { describe, expect, it } from '@jest/globals';
import { TRPCClientError } from '@trpc/client';

import { translate, type Locale } from '../i18n';
import { ApiRefusal } from './client';
import { genericErrorKey } from './error-message';

/** The error the client raises for an API refusal of `code`, as the screens' specs build it. */
function refused(code: string, details?: readonly unknown[]): TRPCClientError<never> {
  return new TRPCClientError('refused', {
    meta: {
      responseJSON: {
        error: { code, message: 'refused', ...(details === undefined ? {} : { details }) },
      },
    },
  });
}

const rateLimitedAfter = (seconds: string) =>
  refused('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: seconds }]);

const said = (locale: Locale, error: unknown) => {
  const { key, values } = genericErrorKey(error, 'common.state.actionError');
  return translate(locale, key, values);
};

describe('genericErrorKey: RATE_LIMITED with the time to wait', () => {
  it.each([
    ['31', 1],
    ['61', 2],
    ['120', 2],
    ['60', 1],
    ['1', 1],
  ])('%s seconds → try again in %i minute(s), rounded up', (seconds, count) => {
    expect(genericErrorKey(rateLimitedAfter(seconds), 'common.state.actionError')).toEqual({
      key: 'common.state.rateLimitedIn',
      values: { count },
    });
  });

  it('says one minute and two minutes in Arabic and English', () => {
    expect(said('ar', rateLimitedAfter('31'))).toBe(
      translate('ar', 'common.state.rateLimitedIn', { count: 1 }),
    );
    expect(said('ar', rateLimitedAfter('31'))).toContain('دقيقة');
    expect(said('ar', rateLimitedAfter('61'))).toContain('دقيقتين');
    expect(said('en', rateLimitedAfter('31'))).toContain('minute.');
    expect(said('en', rateLimitedAfter('31'))).toContain('1');
    expect(said('en', rateLimitedAfter('120'))).toContain('minutes.');
    expect(said('en', rateLimitedAfter('120'))).toContain('2');
  });

  it('reads the refusal of an upload (ApiRefusal) as it reads a call’s', () => {
    const refusal = new ApiRefusal({
      error: {
        code: 'RATE_LIMITED',
        message: 'refused',
        details: [{ path: 'retryAfterSeconds', code: '90' }],
      },
    });
    expect(genericErrorKey(refusal, 'common.state.actionError')).toEqual({
      key: 'common.state.rateLimitedIn',
      values: { count: 2 },
    });
  });
});

describe('genericErrorKey: RATE_LIMITED without a readable time', () => {
  it.each([
    ['no details', refused('RATE_LIMITED')],
    ['empty details', refused('RATE_LIMITED', [])],
    ['another detail', refused('RATE_LIMITED', [{ path: 'limit', code: '30' }])],
    ['zero', rateLimitedAfter('0')],
    ['a negative number', rateLimitedAfter('-5')],
    ['a fraction', rateLimitedAfter('1.5')],
    ['text', rateLimitedAfter('soon')],
    ['an empty time', rateLimitedAfter('')],
    ['a time that is not text', refused('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: 31 }])],
  ])('%s → the message without a time', (_case, error) => {
    expect(genericErrorKey(error, 'common.state.loadError')).toEqual({
      key: 'common.state.rateLimited',
    });
  });

  it('says to wait a little in Arabic and English', () => {
    expect(said('ar', refused('RATE_LIMITED'))).toBe(translate('ar', 'common.state.rateLimited'));
    expect(said('ar', refused('RATE_LIMITED'))).toContain('انتظر قليلًا');
    expect(said('en', refused('RATE_LIMITED'))).toBe(
      'Too many requests. Wait a little and try again.',
    );
  });
});

describe('genericErrorKey: any other failure', () => {
  it.each(['common.state.actionError', 'common.state.loadError', 'auth.welcome.failed'] as const)(
    'another API code → the fallback %s',
    (fallback) => {
      expect(genericErrorKey(refused('INTERNAL'), fallback)).toEqual({ key: fallback });
    },
  );

  it('a network failure, with no API code, → the fallback', () => {
    expect(
      genericErrorKey(new TypeError('Network request failed'), 'common.state.loadError'),
    ).toEqual({ key: 'common.state.loadError' });
    expect(genericErrorKey(undefined, 'common.state.actionError')).toEqual({
      key: 'common.state.actionError',
    });
  });

  it('a retryAfterSeconds detail on another code does not make it a rate limit', () => {
    expect(
      genericErrorKey(
        refused('CONFLICT', [{ path: 'retryAfterSeconds', code: '31' }]),
        'common.state.actionError',
      ),
    ).toEqual({ key: 'common.state.actionError' });
  });

  it('says the fallback in Arabic and English', () => {
    expect(said('ar', new TypeError('Network request failed'))).toBe(
      translate('ar', 'common.state.actionError'),
    );
    expect(said('en', refused('INTERNAL'))).toBe('That did not go through. Try again.');
  });
});
