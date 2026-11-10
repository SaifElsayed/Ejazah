// T021 of specs/004-sessions — the `sessions.cancellation` schemas of contracts/app-surface.md,
// "`sessions.cancellation`" (FR-456, FR-457, FR-458). Written before the schemas, and run red first.
//
// The caller names the session or the request and nothing else (R-GENDER-4). A request carries a
// reason of 1 to 500 characters, never blank (ERD §15 rule 45), and the kernel's idempotency key; it
// is answered pending with its expiry, the session's start. An answer is accept or decline, and is
// answered with the request's new status and the session's.
import { describe, expect, it } from 'vitest';

import { isIdempotentProcedure } from './idempotent-procedures.js';
import {
  PARTICIPANT_REASON_MAX_LENGTH,
  sessionsCancellationAnswerInput,
  sessionsCancellationAnswerOutput,
  sessionsCancellationRequestInput,
  sessionsCancellationRequestOutput,
} from './sessions.js';

const SESSION = '0199d0a0-0000-7000-8000-0000000000a1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000b1';
const KEY = 'cancel-0199d0a0-0000-7000';

describe('sessions.cancellation.request', () => {
  it('takes the session, a reason and the idempotency key, the reason trimmed', () => {
    expect(
      sessionsCancellationRequestInput.parse({
        sessionId: SESSION,
        reason: '  سفر طارئ  ',
        idempotencyKey: KEY,
      }),
    ).toEqual({ sessionId: SESSION, reason: 'سفر طارئ', idempotencyKey: KEY });
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'ا'.repeat(PARTICIPANT_REASON_MAX_LENGTH + 1)],
  ])('refuses a reason %s', (_name, reason) => {
    expect(
      sessionsCancellationRequestInput.safeParse({
        sessionId: SESSION,
        reason,
        idempotencyKey: KEY,
      }).success,
    ).toBe(false);
  });

  it('takes a reason of exactly 500 characters', () => {
    expect(PARTICIPANT_REASON_MAX_LENGTH).toBe(500);
    expect(
      sessionsCancellationRequestInput.safeParse({
        sessionId: SESSION,
        reason: 'ا'.repeat(500),
        idempotencyKey: KEY,
      }).success,
    ).toBe(true);
  });

  it('refuses a request without its key or with a session id that is not one', () => {
    expect(
      sessionsCancellationRequestInput.safeParse({ sessionId: SESSION, reason: 'سفر' }).success,
    ).toBe(false);
    expect(
      sessionsCancellationRequestInput.safeParse({
        sessionId: 'session',
        reason: 'سفر',
        idempotencyKey: KEY,
      }).success,
    ).toBe(false);
  });

  it('is a keyed procedure of the kernel', () => {
    expect(isIdempotentProcedure('sessions.cancellation.request')).toBe(true);
    expect(isIdempotentProcedure('sessions.cancellation.answer')).toBe(false);
  });

  it('answers the request pending with its expiry, and strips any other field', () => {
    expect(
      sessionsCancellationRequestOutput.parse({
        requestId: REQUEST,
        status: 'pending',
        expiresAt: '2026-11-08T15:00:00.000Z',
        reason: 'not answered',
      }),
    ).toEqual({ requestId: REQUEST, status: 'pending', expiresAt: '2026-11-08T15:00:00.000Z' });
    expect(
      sessionsCancellationRequestOutput.safeParse({
        requestId: REQUEST,
        status: 'accepted',
        expiresAt: '2026-11-08T15:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('sessions.cancellation.answer', () => {
  it('takes the request and accept or decline', () => {
    expect(sessionsCancellationAnswerInput.parse({ requestId: REQUEST, accept: true })).toEqual({
      requestId: REQUEST,
      accept: true,
    });
    expect(sessionsCancellationAnswerInput.safeParse({ requestId: REQUEST }).success).toBe(false);
    expect(
      sessionsCancellationAnswerInput.safeParse({ requestId: REQUEST, accept: 'yes' }).success,
    ).toBe(false);
  });

  it.each([
    ['accepted', 'cancelled_by_agreement'],
    ['declined', 'scheduled'],
  ] as const)('answers %s with the session %s', (status, sessionStatus) => {
    expect(
      sessionsCancellationAnswerOutput.parse({ requestId: REQUEST, status, sessionStatus }),
    ).toEqual({ requestId: REQUEST, status, sessionStatus });
  });

  it('never answers a request pending or expired', () => {
    for (const status of ['pending', 'expired']) {
      expect(
        sessionsCancellationAnswerOutput.safeParse({
          requestId: REQUEST,
          status,
          sessionStatus: 'scheduled',
        }).success,
      ).toBe(false);
    }
  });
});
