// T041 of specs/004-sessions (FR-456, FR-458; the note under T041, Q2 (a)): what decides the
// cancellation request, the same for both roles. The control is shown from `sessions.get`'s answer:
// the session `scheduled`, no `pending` request, the phone's clock before `startsAt`, and it hides
// itself at the start; display only, the server decides. The request is keyed (a fresh key per
// reason, reused on that reason's retry), sends nothing for a blank reason, and reads the session's
// screens again after the server's answer; an accepted or declined answer reads them again too.
// `CANCELLATION_PENDING` and `CANCELLATION_EXPIRED` have words of their own; every other failure is
// `genericErrorKey`'s.
import type { SessionsGetOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { apiError } from '../__tests__/api-double';
import {
  cancellationRefusal,
  cancellationRequestShown,
  useAnswerRequest,
  useCancellationRequestShown,
  useRequestCancellation,
} from './index';

const SESSION_ID = '0193a6f0-0000-7000-8000-0000000000c1';
const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const OTHER_ID = '0193a6f0-0000-7000-8000-0000000000e2';
const REQUEST_ID = '0193a6f0-0000-7000-8000-0000000000a1';

const NOW = '2026-11-11T15:00:00.000Z';
/** The session's start. */
const STARTS = '2026-11-11T16:00:00.000Z';

type Cancellation = NonNullable<SessionsGetOutput['cancellation']>;

function request(status: Cancellation['status']): Cancellation {
  return {
    requestId: REQUEST_ID,
    requestedByMe: false,
    reason: 'سفر طارئ',
    status,
    expiresAt: STARTS,
  };
}

const scheduled = { status: 'scheduled', startsAt: STARTS } as const;

const mockRequest = jest.fn<(input: unknown) => Promise<unknown>>();
const mockAnswer = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({
  useApi: () => ({
    client: {
      api: {
        sessions: {
          cancellation: { request: { mutate: mockRequest }, answer: { mutate: mockAnswer } },
        },
      },
    },
  }),
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `cancel-key-${String(++mockKey)}` }));

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(NOW) });
  mockRequest.mockReset();
  mockAnswer.mockReset();
  mockKey = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the request control (T041, Q2 (a))', () => {
  it('is shown on a scheduled session with no pending request before its start', () => {
    expect(cancellationRequestShown(scheduled, new Date(NOW))).toBe(true);
    expect(
      cancellationRequestShown({ ...scheduled, cancellation: request('declined') }, new Date(NOW)),
    ).toBe(true);
    expect(
      cancellationRequestShown({ ...scheduled, cancellation: request('expired') }, new Date(NOW)),
    ).toBe(true);
  });

  it('is hidden from the start on, by the phone’s clock', () => {
    expect(cancellationRequestShown(scheduled, new Date(STARTS))).toBe(false);
    expect(cancellationRequestShown(scheduled, new Date('2026-11-11T16:30:00.000Z'))).toBe(false);
  });

  it('is hidden on a session that is not scheduled', () => {
    for (const status of [
      'done',
      'cancelled_by_agreement',
      'cancelled_by_admin',
      'disputed',
    ] as const) {
      expect(cancellationRequestShown({ ...scheduled, status }, new Date(NOW))).toBe(false);
    }
  });

  it('is hidden while a request is pending', () => {
    expect(
      cancellationRequestShown({ ...scheduled, cancellation: request('pending') }, new Date(NOW)),
    ).toBe(false);
  });

  it('hides itself when the start comes, the screen left open', async () => {
    const shown = await renderHook(() => useCancellationRequestShown(scheduled));
    expect(shown.result.current).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60 * 60 * 1_000 - 1_000);
    });
    expect(shown.result.current).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(shown.result.current).toBe(false);
    await shown.unmount();
  });
});

describe('the refusals in plain words (T041)', () => {
  it('says CANCELLATION_PENDING and CANCELLATION_EXPIRED in the screen’s own words', () => {
    expect(cancellationRefusal(apiError('CANCELLATION_PENDING'))).toEqual({
      key: 'session.cancellation.refused.pending',
    });
    expect(cancellationRefusal(apiError('CANCELLATION_EXPIRED'))).toEqual({
      key: 'session.cancellation.refused.expired',
    });
  });

  it('says every other failure through genericErrorKey, RATE_LIMITED with its time', () => {
    expect(
      cancellationRefusal(apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '120' }])),
    ).toEqual({ key: 'common.state.rateLimitedIn', values: { count: 2 } });
    expect(cancellationRefusal(apiError('RATE_LIMITED'))).toEqual({
      key: 'common.state.rateLimited',
    });
    expect(cancellationRefusal(apiError('SESSION_NOT_SCHEDULED'))).toEqual({
      key: 'common.state.actionError',
    });
    expect(cancellationRefusal(new TypeError('Network request failed'))).toEqual({
      key: 'common.state.actionError',
    });
  });
});

describe('the request and the answer (T041)', () => {
  let queries: QueryClient;
  let invalidated: (readonly unknown[])[][];

  const sessionKey = ['sessions', 'get', SESSION_ID];
  const enrollmentKey = ['student', 'enrollments', 'get', ENROLLMENT_ID];
  const otherKey = ['teacher', 'students', 'get', OTHER_ID];

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
  const session = { sessionId: SESSION_ID, enrollmentId: ENROLLMENT_ID };

  async function requests() {
    return (await renderHook(() => useRequestCancellation(session), { wrapper })).result;
  }

  it('sends the reason trimmed with a key, and reads the session’s screens again', async () => {
    mockRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'pending', expiresAt: STARTS });
    const hook = await requests();
    await act(async () => {
      await hook.current.request('  سفر طارئ  ');
    });
    expect(mockRequest).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      reason: 'سفر طارئ',
      idempotencyKey: 'cancel-key-1',
    });
    expect(invalidated).toEqual([[sessionKey, enrollmentKey]]);
  });

  it('reuses the key when the same reason is sent again after a failure, a new one after that', async () => {
    mockRequest.mockRejectedValueOnce(new TypeError('Network request failed'));
    mockRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'pending', expiresAt: STARTS });
    const hook = await requests();
    await act(async () => {
      await hook.current.request('سفر طارئ').catch(() => undefined);
      await hook.current.request('سفر طارئ');
      await hook.current.request('سفر طارئ');
    });
    const keys = mockRequest.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual(['cancel-key-1', 'cancel-key-1', 'cancel-key-2']);
  });

  it('takes a fresh key when the reason changes after a failure', async () => {
    mockRequest.mockRejectedValueOnce(apiError('CANCELLATION_PENDING'));
    mockRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'pending', expiresAt: STARTS });
    const hook = await requests();
    await act(async () => {
      await hook.current.request('سفر طارئ').catch(() => undefined);
      await hook.current.request('مرض');
    });
    const keys = mockRequest.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual(['cancel-key-1', 'cancel-key-2']);
  });

  it('sends nothing for a blank reason or one past 500 characters', async () => {
    const hook = await requests();
    await act(async () => {
      expect(await hook.current.request('')).toBeUndefined();
      expect(await hook.current.request('   \n ')).toBeUndefined();
      expect(await hook.current.request('س'.repeat(501))).toBeUndefined();
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('reads the screens again after a refusal, and nothing after a request that never arrived', async () => {
    mockRequest.mockRejectedValueOnce(apiError('CANCELLATION_PENDING'));
    mockRequest.mockRejectedValueOnce(new TypeError('Network request failed'));
    const hook = await requests();
    await act(async () => {
      await expect(hook.current.request('سفر طارئ')).rejects.toBeTruthy();
    });
    expect(invalidated).toEqual([[sessionKey, enrollmentKey]]);
    await act(async () => {
      await expect(hook.current.request('سفر طارئ')).rejects.toBeTruthy();
    });
    expect(invalidated).toEqual([[sessionKey, enrollmentKey]]);
  });

  it('reads the screens again once an accept or a decline went through', async () => {
    mockAnswer.mockResolvedValue({
      requestId: REQUEST_ID,
      status: 'declined',
      sessionStatus: 'scheduled',
    });
    const hook = (await renderHook(() => useAnswerRequest(session), { wrapper })).result;
    await act(async () => {
      await hook.current.answer(REQUEST_ID, false);
    });
    expect(mockAnswer).toHaveBeenCalledWith({ requestId: REQUEST_ID, accept: false });
    expect(invalidated).toEqual([[sessionKey, enrollmentKey]]);
  });
});
