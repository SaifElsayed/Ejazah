// T011 of specs/005-certification — `reports.create` as contracts/app-surface.md declares it (FR-611,
// FR-613; research R-408). Written before the schema, and run red first.
//
// The caller names the person reported, the context and the reason; a session report names its
// session, a chat report its enrollment, a profile report neither. Who the caller is comes from the
// session, never the input (R-GENDER-4): no `userId`. The reason is free text, 1 to 500 characters,
// never blank (Q-R8 (a)). The answer says only that the report was received (spec.md:305). The
// call is keyed by the kernel's idempotency, and its refusals are `self` and `open_exists`.
import { describe, expect, it } from 'vitest';

import { isIdempotentProcedure } from './idempotent-procedures.js';
import {
  reportContext,
  reportCreateRefusal,
  reportsCreateInput,
  reportsCreateOutput,
} from './reports.js';

const REPORTED = '0199d0a0-0000-7000-8000-0000000000a2';
const SESSION = '0199d0a0-0000-7000-8000-0000000000d1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const KEY = 'report-key-for-the-spec-0001';
const REASON = 'كلام غير لائق في الحصة';

describe('reports.create', () => {
  it('takes a session report with its session', () => {
    const input = {
      reportedUserId: REPORTED,
      context: 'session',
      sessionId: SESSION,
      reason: REASON,
      idempotencyKey: KEY,
    };
    expect(reportsCreateInput.parse(input)).toEqual(input);
  });

  it('takes a chat report with its enrollment', () => {
    const input = {
      reportedUserId: REPORTED,
      context: 'chat',
      enrollmentId: ENROLLMENT,
      reason: REASON,
      idempotencyKey: KEY,
    };
    expect(reportsCreateInput.parse(input)).toEqual(input);
  });

  it('takes a profile report with neither', () => {
    const input = {
      reportedUserId: REPORTED,
      context: 'profile',
      reason: REASON,
      idempotencyKey: KEY,
    };
    expect(reportsCreateInput.parse(input)).toEqual(input);
  });

  it('trims the reason', () => {
    const parsed = reportsCreateInput.parse({
      reportedUserId: REPORTED,
      context: 'profile',
      reason: `  ${REASON}  `,
      idempotencyKey: KEY,
    });
    expect(parsed.reason).toBe(REASON);
  });

  it.each([
    ['a session report with no session', { context: 'session' }],
    [
      'a session report naming an enrollment',
      { context: 'session', sessionId: SESSION, enrollmentId: ENROLLMENT },
    ],
    ['a chat report with no enrollment', { context: 'chat' }],
    [
      'a chat report naming a session',
      { context: 'chat', enrollmentId: ENROLLMENT, sessionId: SESSION },
    ],
    ['a profile report naming a session', { context: 'profile', sessionId: SESSION }],
    ['a profile report naming an enrollment', { context: 'profile', enrollmentId: ENROLLMENT }],
    ['an unknown context', { context: 'review' }],
    ['a blank reason', { context: 'profile', reason: '   ' }],
    ['a reason over 500 characters', { context: 'profile', reason: 'x'.repeat(501) }],
    ['no key', { context: 'profile', idempotencyKey: undefined }],
    ['a reported user that is not an id', { context: 'profile', reportedUserId: 'them' }],
  ])('refuses %s', (_name, change) => {
    const input = {
      reportedUserId: REPORTED,
      reason: REASON,
      idempotencyKey: KEY,
      ...change,
    };
    expect(reportsCreateInput.safeParse(input).success).toBe(false);
  });

  it('takes a reason of exactly 500 characters', () => {
    const input = {
      reportedUserId: REPORTED,
      context: 'profile',
      reason: 'x'.repeat(500),
      idempotencyKey: KEY,
    };
    expect(reportsCreateInput.safeParse(input).success).toBe(true);
  });

  it('carries no caller id: who reports is the session (R-GENDER-4)', () => {
    const parsed = reportsCreateInput.parse({
      reportedUserId: REPORTED,
      context: 'profile',
      reason: REASON,
      idempotencyKey: KEY,
      userId: SESSION,
      reporterUserId: SESSION,
    });
    expect(parsed).not.toHaveProperty('userId');
    expect(parsed).not.toHaveProperty('reporterUserId');
  });

  it('answers that the report was received and nothing else', () => {
    expect(reportsCreateOutput.parse({ received: true, reportId: SESSION })).toEqual({
      received: true,
    });
    expect(reportsCreateOutput.safeParse({ received: false }).success).toBe(false);
  });

  it('names the three contexts and the two refusals', () => {
    expect(reportContext.options).toEqual(['session', 'chat', 'profile']);
    expect(reportCreateRefusal.options).toEqual(['self', 'open_exists']);
  });

  it('is keyed', () => {
    expect(isIdempotentProcedure('reports.create')).toBe(true);
  });
});
