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
      'sessionId',
      'documentUrl',
      'payoutAccountRef',
      'paymentPayload',
      'cardNumber',
      'apiKey',
      'password',
      'authorization',
    ]) {
      expect(redact({ [key]: planted }), key).toEqual({ [key]: REDACTED });
    }
    expect(redactedKeys.length).toBeGreaterThan(0);
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

    const bound = { session: { sessionId: planted } };
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
    createLogger({ level: 'info', destination: out }).error({ code: 'INTERNAL' }, 'failed');
    expect(out.records()[0]).toMatchObject({ level: 'error', msg: 'failed', code: 'INTERNAL' });
  });

  it('honours the configured level', () => {
    const out = capture();
    createLogger({ level: 'warn', destination: out }).info('dropped');
    expect(out.lines).toHaveLength(0);
  });
});
