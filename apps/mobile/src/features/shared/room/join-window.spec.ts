// T018 of specs/004-sessions (FR-431, FR-434; US1 acceptance 1): where the phone's clock stands
// against a session's join period, `join.opensAt` to `join.closesAt` from `sessions.get`. The server
// decides (`sessions.join` refuses `JOIN_NOT_OPEN` and `JOIN_CLOSED`); the screen only says so, and
// draws itself again at each boundary.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { joinWindowAt, useJoinWindow } from './join-window';

const join = { opensAt: '2026-11-11T15:45:00.000Z', closesAt: '2026-11-11T16:45:00.000Z' };

describe('joinWindowAt', () => {
  it('is before until opensAt, open from opensAt, and closed from closesAt', () => {
    expect(joinWindowAt(join, new Date('2026-11-11T15:44:59.000Z'))).toBe('before');
    expect(joinWindowAt(join, new Date('2026-11-11T15:45:00.000Z'))).toBe('open');
    expect(joinWindowAt(join, new Date('2026-11-11T16:44:59.000Z'))).toBe('open');
    expect(joinWindowAt(join, new Date('2026-11-11T16:45:00.000Z'))).toBe('closed');
  });
});

describe('useJoinWindow', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-11T15:44:00.000Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens at opensAt and closes at closesAt with no read of the server', async () => {
    const { result } = await renderHook(() => useJoinWindow(join));
    expect(result.current).toBe('before');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(59_000);
    });
    expect(result.current).toBe('before');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current).toBe('open');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(result.current).toBe('closed');
  });

  it('waits for an opening days away without one timer of days', async () => {
    const far = { opensAt: '2026-12-30T15:45:00.000Z', closesAt: '2026-12-30T16:45:00.000Z' };
    const timers = jest.spyOn(globalThis, 'setTimeout');
    const { result } = await renderHook(() => useJoinWindow(far));
    expect(result.current).toBe('before');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toBe('before');
    // The longest single wait is capped, so no timer overflows setTimeout's 24.8 days.
    const waits = timers.mock.calls.map(([, ms]) => ms ?? 0);
    expect(waits.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...waits)).toBeLessThanOrEqual(60_000);
    timers.mockRestore();
  });
});
