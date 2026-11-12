// T042 of specs/004-sessions (FR-473, FR-474; the note under T042): what decides a dispute, the same
// for both roles. The control only while `sessions.get`'s `canRaiseDispute` is true; the raise keyed
// (a fresh key per reason, reused on that reason's retry), nothing sent for a blank reason, the
// session's screens read again after the server's answer; `DISPUTE_WINDOW_CLOSED`, `DISPUTE_OPEN`,
// `SESSION_UNDER_REVIEW` and `NOT_DISPUTABLE` in words of their own, every other failure through
// `genericErrorKey`.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { apiError } from '../__tests__/api-double';
import { disputeRaiseShown, disputeRefusal, useRaiseDispute } from './index';

const SESSION_ID = '0193a6f0-0000-7000-8000-0000000000c1';
const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const OTHER_ID = '0193a6f0-0000-7000-8000-0000000000e2';
const DISPUTE_ID = '0193a6f0-0000-7000-8000-0000000000f1';

const mockRaise = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({
  useApi: () => ({
    client: { api: { sessions: { dispute: { raise: { mutate: mockRaise } } } } },
  }),
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `dispute-key-${String(++mockKey)}` }));

beforeEach(() => {
  mockRaise.mockReset();
  mockKey = 0;
});

describe('the dispute control (T042)', () => {
  it('is shown while canRaiseDispute is true', () => {
    expect(disputeRaiseShown({ canRaiseDispute: true })).toBe(true);
  });

  it('is hidden while canRaiseDispute is false or not answered', () => {
    expect(disputeRaiseShown({ canRaiseDispute: false })).toBe(false);
    expect(disputeRaiseShown({})).toBe(false);
  });
});

describe('the dispute’s refusals in plain words (T042)', () => {
  it('says each of the raise’s four refusals in the screen’s own words', () => {
    expect(disputeRefusal(apiError('DISPUTE_WINDOW_CLOSED'))).toEqual({
      key: 'session.dispute.refused.windowClosed',
    });
    expect(disputeRefusal(apiError('DISPUTE_OPEN'))).toEqual({
      key: 'session.dispute.refused.open',
    });
    expect(disputeRefusal(apiError('SESSION_UNDER_REVIEW'))).toEqual({
      key: 'session.dispute.refused.underReview',
    });
    expect(disputeRefusal(apiError('NOT_DISPUTABLE'))).toEqual({
      key: 'session.dispute.refused.notDisputable',
    });
  });

  it('says every other failure through genericErrorKey, RATE_LIMITED with its time', () => {
    expect(
      disputeRefusal(apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }])),
    ).toEqual({ key: 'common.state.rateLimitedIn', values: { count: 2 } });
    expect(disputeRefusal(apiError('NOT_FOUND'))).toEqual({ key: 'common.state.actionError' });
    expect(disputeRefusal(new TypeError('Network request failed'))).toEqual({
      key: 'common.state.actionError',
    });
  });
});

describe('the raise (T042)', () => {
  let queries: QueryClient;
  let invalidated: (readonly unknown[])[][];

  const sessionKey = ['sessions', 'get', SESSION_ID];
  const enrollmentKey = ['teacher', 'students', 'get', ENROLLMENT_ID];
  const otherKey = ['student', 'enrollments', 'get', OTHER_ID];

  beforeEach(() => {
    queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalidated = [];
    const invalidate = queries.invalidateQueries.bind(queries);
    jest.spyOn(queries, 'invalidateQueries').mockImplementation(async (filters) => {
      const predicate = filters?.predicate;
      const keys = [sessionKey, enrollmentKey, otherKey];
      invalidated.push(
        predicate === undefined
          ? keys
          : keys.filter((queryKey) => predicate({ queryKey } as never)),
      );
      await invalidate(filters);
    });
  });

  afterEach(() => {
    queries.clear();
    jest.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queries}>{children}</QueryClientProvider>
  );

  async function disputes() {
    return (
      await renderHook(
        () => useRaiseDispute({ sessionId: SESSION_ID, enrollmentId: ENROLLMENT_ID }),
        { wrapper },
      )
    ).result;
  }

  const keysSent = () =>
    mockRaise.mock.calls.map(([input]) => (input as { idempotencyKey: string }).idempotencyKey);

  it('sends the reason trimmed with a key, and reads the session’s screens again', async () => {
    mockRaise.mockResolvedValue({ disputeId: DISPUTE_ID, status: 'open' });
    const hook = await disputes();
    await act(async () => {
      expect(await hook.current.raise('  انقطع الصوت  ')).toEqual({
        disputeId: DISPUTE_ID,
        status: 'open',
      });
    });
    expect(mockRaise).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      reason: 'انقطع الصوت',
      idempotencyKey: 'dispute-key-1',
    });
    expect(invalidated).toEqual([[sessionKey, enrollmentKey]]);
  });

  it('reuses the key on the same reason’s retry, and takes a new one for a new reason or after success', async () => {
    mockRaise.mockRejectedValueOnce(new TypeError('Network request failed'));
    mockRaise.mockRejectedValueOnce(apiError('DISPUTE_OPEN'));
    mockRaise.mockResolvedValue({ disputeId: DISPUTE_ID, status: 'open' });
    const hook = await disputes();
    await act(async () => {
      await hook.current.raise('انقطع الصوت').catch(() => undefined);
      await hook.current.raise('انقطع الصوت').catch(() => undefined);
      await hook.current.raise('غاب المعلم');
      await hook.current.raise('غاب المعلم');
    });
    expect(keysSent()).toEqual([
      'dispute-key-1',
      'dispute-key-1',
      'dispute-key-2',
      'dispute-key-3',
    ]);
  });

  it('sends nothing for a blank reason or one past 500 characters', async () => {
    const hook = await disputes();
    await act(async () => {
      expect(await hook.current.raise(' \n ')).toBeUndefined();
      expect(await hook.current.raise('س'.repeat(501))).toBeUndefined();
    });
    expect(mockRaise).not.toHaveBeenCalled();
  });

  it('reads the screens again after a refusal, and nothing after a raise that never arrived', async () => {
    mockRaise.mockRejectedValueOnce(apiError('DISPUTE_WINDOW_CLOSED'));
    mockRaise.mockRejectedValueOnce(new TypeError('Network request failed'));
    const hook = await disputes();
    await act(async () => {
      await expect(hook.current.raise('انقطع الصوت')).rejects.toBeTruthy();
      await expect(hook.current.raise('انقطع الصوت')).rejects.toBeTruthy();
    });
    expect(invalidated).toEqual([[sessionKey, enrollmentKey]]);
  });
});
