// 003:T112 (SRS FR-POSTPONE-1 to FR-POSTPONE-5, DEC-90; the owner's Q-1 (a) and Q-3 (a) of
// 2026-11-19): what decides the postponement on the phone, the same for both roles. It is offered on
// a `confirmed` enrollment that is not paused; display only, the server decides. `sessions.postpone`
// is keyed as a cancellation request is (one key per reason sent, reused on that reason's retry, a
// new one once it went through), sends nothing for a blank reason or one over the contract's 500,
// and reads the enrollment's screens again after the server's answer. Each refusal has words of its
// own: `CONFLICT`'s three causes and `ACCOUNT_RESTRICTED`; every other failure is `genericErrorKey`'s.
import { PARTICIPANT_REASON_MAX_LENGTH } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { apiError } from '../__tests__/api-double';
import { postponementRefusal, postponeOffered, usePostpone } from './index';

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const OTHER_ID = '0193a6f0-0000-7000-8000-0000000000e2';
const POSTPONEMENT_ID = '0193a6f0-0000-7000-8000-0000000000f1';
const SESSION_A = '0193a6f0-0000-7000-8000-000000000501';
const SESSION_B = '0193a6f0-0000-7000-8000-000000000502';

const mockPostpone = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({
  useApi: () => ({ client: { api: { sessions: { postpone: { mutate: mockPostpone } } } } }),
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `postpone-key-${String(++mockKey)}` }));

const conflict = (cause: string) => apiError('CONFLICT', [{ path: 'cause', code: cause }]);

beforeEach(() => {
  mockPostpone.mockReset();
  mockKey = 0;
});

describe('where the postponement is offered (FR-POSTPONE-1)', () => {
  it('is offered on a confirmed enrollment that is not paused', () => {
    expect(postponeOffered({ status: 'confirmed', paused: false })).toBe(true);
  });

  it('is not offered on a paused enrollment, nor on one that is not confirmed', () => {
    expect(postponeOffered({ status: 'confirmed', paused: true })).toBe(false);
    for (const status of ['pending_payment', 'completed', 'terminated_no_show', 'cancelled']) {
      expect(postponeOffered({ status, paused: false })).toBe(false);
    }
  });
});

describe('each refusal in its own words (FR-POSTPONE-3, FR-POSTPONE-4)', () => {
  it('says no session is left in the week to postpone (`no_session_in_week`)', () => {
    expect(postponementRefusal(conflict('no_session_in_week'))).toEqual({
      key: 'postponement.refused.noSessionInWeek',
    });
  });

  it('says the interval has not passed since the last postponement (`interval_not_passed`)', () => {
    expect(postponementRefusal(conflict('interval_not_passed'))).toEqual({
      key: 'postponement.refused.intervalNotPassed',
    });
  });

  it('says the enrollment is no longer running (`enrollment_not_confirmed`)', () => {
    expect(postponementRefusal(conflict('enrollment_not_confirmed'))).toEqual({
      key: 'postponement.refused.enrollmentNotConfirmed',
    });
  });

  it('says the postponement is not possible now on `ACCOUNT_RESTRICTED`, naming no account', () => {
    expect(postponementRefusal(apiError('ACCOUNT_RESTRICTED'))).toEqual({
      key: 'postponement.refused.accountRestricted',
    });
  });

  it('keeps T065’s words for any other failure: a conflict of another cause, a limit, no answer', () => {
    expect(postponementRefusal(conflict('something_else'))).toEqual({
      key: 'common.state.actionError',
    });
    expect(
      postponementRefusal(apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '90' }])),
    ).toEqual({ key: 'common.state.rateLimitedIn', values: { count: 2 } });
    expect(postponementRefusal(new Error('offline'))).toEqual({ key: 'common.state.actionError' });
  });
});

describe('the postponement sent (keyed, read again after)', () => {
  let queries: QueryClient;
  let invalidated: unknown[][];

  afterEach(() => {
    queries.clear();
    jest.restoreAllMocks();
  });

  async function hook() {
    queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidated = [];
    const keys = [
      ['student', 'enrollments', 'get', ENROLLMENT_ID],
      ['teacher', 'students', 'get', ENROLLMENT_ID],
      ['sessions', 'get', SESSION_A],
      ['sessions', 'get', SESSION_B],
      ['student', 'enrollments', 'get', OTHER_ID],
    ];
    for (const key of keys) queries.setQueryData(key, {});
    jest.spyOn(queries, 'invalidateQueries').mockImplementation(async (filters) => {
      const predicate = filters?.predicate;
      invalidated.push(
        predicate === undefined
          ? keys
          : keys.filter((queryKey) => predicate({ queryKey } as never)),
      );
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    );
    return (await renderHook(() => usePostpone(ENROLLMENT_ID), { wrapper })).result;
  }

  it('sends nothing for a blank reason, nor for one longer than the contract’s bound', async () => {
    const result = await hook();
    await act(async () => {
      expect(await result.current.postpone('   ')).toBeUndefined();
      expect(
        await result.current.postpone('x'.repeat(PARTICIPANT_REASON_MAX_LENGTH + 1)),
      ).toBeUndefined();
    });
    expect(mockPostpone).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason with the enrollment and a key, then reads the enrollment and the moved sessions again', async () => {
    mockPostpone.mockResolvedValue({
      postponementId: POSTPONEMENT_ID,
      sessionIds: [SESSION_A, SESSION_B],
    });
    const result = await hook();
    await act(async () => {
      await result.current.postpone('  سفر مفاجئ  ');
    });
    expect(mockPostpone).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      reason: 'سفر مفاجئ',
      idempotencyKey: 'postpone-key-1',
    });
    expect(invalidated).toEqual([
      [
        ['student', 'enrollments', 'get', ENROLLMENT_ID],
        ['teacher', 'students', 'get', ENROLLMENT_ID],
        ['sessions', 'get', SESSION_A],
        ['sessions', 'get', SESSION_B],
      ],
    ]);
  });

  it('reuses the key when the same reason is sent again after a failure, and takes a new one once it went through', async () => {
    mockPostpone
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ postponementId: POSTPONEMENT_ID, sessionIds: [SESSION_A] });
    const result = await hook();
    await act(async () => {
      await result.current.postpone('سفر').catch(() => undefined);
      await result.current.postpone('سفر');
      await result.current.postpone('سفر');
    });
    const keys = mockPostpone.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual(['postpone-key-1', 'postpone-key-1', 'postpone-key-2']);
  });

  it('reads the enrollment again after a refusal, and nothing after a call that never reached the server', async () => {
    mockPostpone
      .mockRejectedValueOnce(conflict('interval_not_passed'))
      .mockRejectedValueOnce(new Error('offline'));
    const result = await hook();
    await act(async () => {
      await result.current.postpone('سفر').catch(() => undefined);
    });
    expect(invalidated).toEqual([
      [
        ['student', 'enrollments', 'get', ENROLLMENT_ID],
        ['teacher', 'students', 'get', ENROLLMENT_ID],
      ],
    ]);
    await act(async () => {
      await result.current.postpone('سفر آخر').catch(() => undefined);
    });
    expect(invalidated).toHaveLength(1);
  });
});
