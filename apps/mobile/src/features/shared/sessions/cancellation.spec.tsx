// T065 of specs/004-sessions (FR-438; SRS FR-CANCEL-4; research R-324, item 7; contracts/app-surface.md,
// "`live`"): a pending cancellation request is shown expired from its `expiresAt` against the
// phone's own clock, for display only (the server decides); an answer the server refuses
// (`CANCELLATION_EXPIRED`, or any refusal) reads `sessions.get` and the enrollment's screens again.
// The same for both roles (R-MOBILE-3); T041 draws both.
import type { SessionsGetOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { apiError } from '../__tests__/api-double';
import {
  cancellationShownExpired,
  useAnswerCancellation,
  useCancellationShownExpired,
} from './index';

const SESSION_ID = '0193a6f0-0000-7000-8000-0000000000c1';
const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const OTHER_ID = '0193a6f0-0000-7000-8000-0000000000e2';
const REQUEST_ID = '0193a6f0-0000-7000-8000-0000000000a1';

type Cancellation = NonNullable<SessionsGetOutput['cancellation']>;

const NOW = '2026-11-11T15:00:00.000Z';
/** The session's start, when the request expires. */
const STARTS = '2026-11-11T16:00:00.000Z';

function request(of: Partial<Cancellation> = {}): Cancellation {
  return {
    requestId: REQUEST_ID,
    requestedByMe: false,
    reason: 'سفر طارئ',
    status: 'pending',
    expiresAt: STARTS,
    ...of,
  };
}

const mockAnswer = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({
  useApi: () => ({
    client: { api: { sessions: { cancellation: { answer: { mutate: mockAnswer } } } } },
  }),
}));

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(NOW) });
  mockAnswer.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the «expired» display (T065, FR-438)', () => {
  it('shows a pending request expired once the phone’s clock reaches expiresAt, never before', () => {
    expect(cancellationShownExpired(request(), new Date('2026-11-11T15:59:59.000Z'))).toBe(false);
    expect(cancellationShownExpired(request(), new Date(STARTS))).toBe(true);
    expect(cancellationShownExpired(request(), new Date('2026-11-11T17:00:00.000Z'))).toBe(true);
  });

  it('shows the server’s own expired as expired, and an answered request never as expired', () => {
    const late = new Date('2026-11-11T17:00:00.000Z');
    expect(cancellationShownExpired(request({ status: 'expired' }), new Date(NOW))).toBe(true);
    expect(cancellationShownExpired(request({ status: 'accepted' }), late)).toBe(false);
    expect(cancellationShownExpired(request({ status: 'declined' }), late)).toBe(false);
    expect(cancellationShownExpired(undefined, late)).toBe(false);
  });

  it('turns to expired by itself when expiresAt comes, the screen left open', async () => {
    const shown = await renderHook(() => useCancellationShownExpired(request()));
    expect(shown.result.current).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60 * 60 * 1_000 - 1_000);
    });
    expect(shown.result.current).toBe(false);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(shown.result.current).toBe(true);
    await shown.unmount();
  });
});

describe('a refused answer reads the screen again (T065)', () => {
  const mounted: (() => void)[] = [];

  afterEach(() => {
    for (const unmount of mounted.splice(0)) unmount();
  });

  function cacheWith(keys: readonly (readonly unknown[])[]) {
    const queries = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queries.mount();
    const reads = new Map<string, number>();
    for (const key of keys) {
      const name = JSON.stringify(key);
      const observer = new QueryObserver(queries, {
        queryKey: key,
        queryFn: async () => {
          reads.set(name, (reads.get(name) ?? 0) + 1);
          return name;
        },
      });
      mounted.push(observer.subscribe(() => undefined));
    }
    mounted.push(() => {
      queries.unmount();
      queries.clear();
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    );
    return { wrapper, reads: (key: readonly unknown[]) => reads.get(JSON.stringify(key)) ?? 0 };
  }

  const sessionKey = ['sessions', 'get', SESSION_ID];
  const studentEnrollment = ['student', 'enrollments', 'get', ENROLLMENT_ID];
  const teacherEnrollment = ['teacher', 'students', 'get', ENROLLMENT_ID];
  const otherEnrollment = ['student', 'enrollments', 'get', OTHER_ID];
  const keys = [sessionKey, studentEnrollment, teacherEnrollment, otherEnrollment];

  async function answerWith(error: unknown) {
    const cache = cacheWith(keys);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    mockAnswer.mockRejectedValueOnce(error);
    const hook = await renderHook(
      () => useAnswerCancellation({ sessionId: SESSION_ID, enrollmentId: ENROLLMENT_ID }),
      { wrapper: cache.wrapper },
    );
    await act(async () => {
      await hook.result.current.answer(REQUEST_ID, true).catch(() => undefined);
      await jest.advanceTimersByTimeAsync(0);
    });
    await hook.unmount();
    return keys.map(cache.reads);
  }

  it('reads sessions.get and the enrollment’s screens again after CANCELLATION_EXPIRED', async () => {
    expect(await answerWith(apiError('CANCELLATION_EXPIRED'))).toEqual([2, 2, 2, 1]);
    expect(mockAnswer).toHaveBeenCalledWith({ requestId: REQUEST_ID, accept: true });
  });

  it('reads them again after any other refusal too', async () => {
    for (const code of ['CONFLICT', 'SESSION_NOT_SCHEDULED', 'NOT_FOUND']) {
      expect(await answerWith(apiError(code))).toEqual([2, 2, 2, 1]);
    }
  });

  it('reads nothing again when the answer never reached the server', async () => {
    expect(await answerWith(new TypeError('Network request failed'))).toEqual([1, 1, 1, 1]);
  });
});
