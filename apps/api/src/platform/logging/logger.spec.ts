// T095 — the redaction list declared in the logger (FR-040, R-SEC-2, research R-17).
//
// The lint rule refuses a logger call handed a raw request body; it cannot see a token three levels
// inside an object that was legitimately passed. These cases plant exactly that, at every depth and
// inside arrays, and assert the value is absent from the written record while the harmless fields
// beside it survive, and that every record carries the request's correlation identifier.
import { describe, expect, it } from 'vitest';
import { REDACTED, createLogger, redact, redactedKeys, requestLogger } from './logger.js';

type LogRecord = Record<string, unknown>;

function capture(): { lines: string[]; records: () => LogRecord[]; write: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    records: () => lines.map((line) => JSON.parse(line) as LogRecord),
    write: (line: string) => {
      lines.push(line);
    },
  };
}

const planted = 'S3NSITIVE-value-0f9a';

describe('the declared redaction list (T095, FR-040)', () => {
  it('names every class of value R-SEC-2 forbids', () => {
    for (const key of [
      'body',
      'otp',
      'token',
      'authSessionId',
      'documentUrl',
      'payoutAccountRef',
      'paymentPayload',
      'cardNumber',
      'apiKey',
      'password',
      'authorization',
      'code',
      'storageKey',
      'card',
      'gatewayEvent',
    ]) {
      expect(redact({ [key]: planted }), key).toEqual({ [key]: REDACTED });
    }
    expect(redactedKeys.length).toBeGreaterThan(0);
  });

  // The words are the ones `sec/no-body-logging` reads (its header, "DOMAIN VOCABULARY" and
  // "AMBIGUOUS NAMES"): a teaching session's id, a classification code and a name that says when or
  // whether are what a log line is for, and stay.
  it('writes an address-named key as its network, under every spelling of the address (T017, R-SEC-2)', () => {
    const out = redact({
      clientAddress: '203.0.113.77',
      remoteAddr: '::ffff:198.51.100.9',
      forwardedFor: '2001:db8:85a3:8d3:1319:8a2e:370:7348',
      'x-forwarded-for': '203.0.113.1, 203.0.113.2',
      ip: 'not an address',
      ipCount: 3,
    });
    expect(out).toEqual({
      clientAddress: '203.0.113.0/24',
      remoteAddr: '198.51.100.0/24',
      forwardedFor: '2001:db8:85a3::/48',
      'x-forwarded-for': REDACTED,
      ip: REDACTED,
      ipCount: 3,
    });
  });

  it('redacts the text, html and subject of a mail object, and keeps the same names elsewhere (T023, R-SEC-2)', () => {
    const out = redact({
      mail: {
        to: 'a@example.invalid',
        subject: 'رمز الدخول',
        text: 'الرمز 482913',
        html: '<b>482913</b>',
      },
      mails: [{ subject: 's', text: 't' }],
      emailDelivery: { subject: 'the subject', attempts: 2 },
      subject: 'the rate-limit subject',
      text: 'a log line',
      html: false,
    });
    expect(out).toEqual({
      mail: { to: 'a@example.invalid', subject: REDACTED, text: REDACTED, html: REDACTED },
      mails: [{ subject: REDACTED, text: REDACTED }],
      emailDelivery: { subject: REDACTED, attempts: 2 },
      subject: 'the rate-limit subject',
      text: 'a log line',
      html: false,
    });
  });

  it('keeps the names the lint rule marks as loggable', () => {
    const kept = {
      sessionId: 's-1',
      errorCode: 'INTERNAL',
      statusCode: 500,
      tokenExpiresAt: '2026-10-06T10:00:00Z',
      otpAttempts: 2,
      hasToken: true,
      idempotencyKey: 'k-1',
      eventType: 'payment.succeeded',
    };
    expect(redact(kept)).toEqual(kept);
  });

  it('removes a sensitive value nested three levels inside a legitimately passed object', () => {
    const out = capture();
    const logger = createLogger({ level: 'info', destination: out });

    // Built before the call, as a legitimately passed object is: the lint rule sees only a name.
    const confirmed = {
      booking: { teacher: { payout: { payoutAccountRef: planted, bank: 'NBE' } }, id: 'b-1' },
      event: { provider: { delivery: { webhook_secret: planted } } },
    };
    logger.info(confirmed, 'booking confirmed');

    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).not.toContain(planted);
    const [record] = out.records();
    expect(record).toMatchObject({
      msg: 'booking confirmed',
      booking: { id: 'b-1', teacher: { payout: { payoutAccountRef: REDACTED, bank: 'NBE' } } },
    });
  });

  it('removes a sensitive value inside an array, in any key spelling', () => {
    const out = capture();
    const logger = createLogger({ level: 'info', destination: out });

    const retry = {
      attempts: [{ OTP: planted }, { 'refresh-token': planted }, { Access_Token: planted }],
      headers: { Authorization: `Bearer ${planted}`, Cookie: planted },
    };
    logger.info(retry);

    expect(out.lines[0]).not.toContain(planted);
  });

  it('removes a sensitive value from bindings and from a child logger', () => {
    const out = capture();
    const logger = createLogger({ level: 'info', destination: out });

    const bound = { session: { authSessionId: planted } };
    logger.child(bound).info('joined');

    expect(out.lines[0]).not.toContain(planted);
  });

  it('does not touch the object the caller passed', () => {
    const passed = { user: { token: planted } };
    createLogger({ level: 'info', destination: capture() }).info(passed);
    expect(passed.user.token).toBe(planted);
  });

  it('survives a circular object without throwing or leaking', () => {
    const out = capture();
    const looped: Record<string, unknown> = { token: planted };
    looped['self'] = looped;
    createLogger({ level: 'info', destination: out }).info({ looped });
    expect(out.lines[0]).not.toContain(planted);
  });
});

// Review of PR #35: the Major (plurals) and the minors fixed in the same round.
describe('the list reads a name as the lint rule does (review of PR #35)', () => {
  it('redacts a plural as its singular, as the rule does (M1)', () => {
    for (const key of [
      'tokens',
      'cookies',
      'secrets',
      'credentials',
      'otpCodes',
      'gatewayEvents',
    ]) {
      expect(redact({ [key]: planted }), key).toEqual({ [key]: REDACTED });
    }
  });

  it('removes a plural holding the value one level down, where no rule can see it (M1)', () => {
    const out = capture();
    const session = { tokens: { access: planted, refresh: planted }, cookies: { sid: planted } };
    createLogger({ level: 'info', destination: out }).info(session);
    expect(out.lines[0]).not.toContain(planted);
  });

  it('keeps a plural classification code', () => {
    const kept = { errorCodes: ['INTERNAL'], statusCodes: [500] };
    expect(redact(kept)).toEqual(kept);
  });

  it('redacts the one-word and numbered spellings (m4)', () => {
    for (const key of [
      'apikey',
      'accesstoken',
      'refreshtoken',
      'sessionid',
      'jwt',
      'passphrase',
      'pan',
      'last4',
      'token2',
    ]) {
      expect(redact({ [key]: planted }), key).toEqual({ [key]: REDACTED });
    }
  });
});

describe('values that are not plain objects (review of PR #35)', () => {
  it('writes an Error with its type and cause chain, redacted (m1)', () => {
    const out = capture();
    const root = Object.assign(new Error('connect ECONNREFUSED'), { token: planted });
    const failure = new Error('booking failed', { cause: root });
    createLogger({ level: 'info', destination: out }).error({ err: failure }, 'unexpected');

    expect(out.lines[0]).not.toContain(planted);
    const [record] = out.records();
    expect(record?.['err']).toMatchObject({
      type: 'Error',
      message: expect.stringContaining('booking failed'),
      cause: { type: 'Error', message: 'connect ECONNREFUSED', token: REDACTED },
    });
  });

  // T173 (the logger item of the code review): the `code` of a serialized Error classifies what
  // happened (`ECONNREFUSED`, `57014`, `ERR_MODULE_NOT_FOUND`) and is what an operator reads first;
  // a bare `code` anywhere else may be the one-time code itself and stays redacted.
  it('keeps the code of a serialized Error, and of the errors in its cause chain', () => {
    const out = capture();
    const root = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
    });
    const failure = Object.assign(new Error('the counter is unreachable', { cause: root }), {
      code: 'RATE_LIMIT_COUNTER_DOWN',
    });
    createLogger({ level: 'info', destination: out }).error({ err: failure }, 'unexpected');

    const [record] = out.records();
    expect(record?.['err']).toMatchObject({
      type: 'Error',
      code: 'RATE_LIMIT_COUNTER_DOWN',
      cause: { type: 'Error', code: 'ECONNREFUSED' },
    });
    expect(redact({ failure: root })).toMatchObject({ failure: { code: 'ECONNREFUSED' } });
  });

  it('still redacts a bare code outside an Error, and one nested in an object an Error carries', () => {
    const out = capture();
    const planted = { code: 'ONE-TIME-7f3e', attempt: { code: 'ONE-TIME-7f3e' } };
    const failure = Object.assign(new Error('delivery failed'), {
      code: 'EAI_AGAIN',
      details: { code: 'ONE-TIME-7f3e', destination: 'phone' },
    });
    createLogger({ level: 'info', destination: out }).info({ ...planted, err: failure }, 'sent');

    expect(out.lines[0]).not.toContain('ONE-TIME-7f3e');
    const [record] = out.records();
    expect(record).toMatchObject({
      code: REDACTED,
      attempt: { code: REDACTED },
      err: { code: 'EAI_AGAIN', details: { code: REDACTED, destination: 'phone' } },
    });
    expect(redact({ code: 'ONE-TIME-7f3e' })).toEqual({ code: REDACTED });
  });

  it('reads a value through its own toJSON before redacting it (m2)', () => {
    const sneaky = { v: { toJSON: () => ({ token: planted, kept: 1 }) } };
    expect(redact(sneaky)).toEqual({ v: { token: REDACTED, kept: 1 } });
  });

  it('writes a URL as its text, not as an empty object (m2)', () => {
    expect(redact({ at: new URL('https://ijazah.example/health') })).toEqual({
      at: 'https://ijazah.example/health',
    });
  });

  it('writes the same object twice when it is reached twice side by side (m3)', () => {
    const shared = { id: 'x' };
    expect(redact({ a: shared, b: shared })).toEqual({ a: { id: 'x' }, b: { id: 'x' } });
  });
});

describe('the correlation identifier (T095, FR-040)', () => {
  it('is on every record written through a request logger', () => {
    const out = capture();
    const logger = requestLogger(createLogger({ level: 'debug', destination: out }), 'corr-123');

    logger.info('first');
    logger.warn({ step: 2 }, 'second');

    expect(out.records().map((record) => record['correlationId'])).toEqual([
      'corr-123',
      'corr-123',
    ]);
  });

  it('writes structured JSON with a level and a message', () => {
    const out = capture();
    createLogger({ level: 'info', destination: out }).error({ errorCode: 'INTERNAL' }, 'failed');
    expect(out.records()[0]).toMatchObject({
      level: 'error',
      msg: 'failed',
      errorCode: 'INTERNAL',
    });
  });

  it('honours the configured level', () => {
    const out = capture();
    createLogger({ level: 'warn', destination: out }).info('dropped');
    expect(out.lines).toHaveLength(0);
  });
});
