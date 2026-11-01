// T138 (FR-205): the query cache knows when the phone has no connection. NetInfo drives TanStack
// Query's `onlineManager`, as TanStack's React Native guide shows, so a read waits for the
// connection instead of failing, and the screens draw the offline pattern while it is away.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { followNetInfo, useOnline } from './online';

type Listener = (state: Pick<NetInfoState, 'isConnected'>) => void;

const addEventListener = NetInfo.addEventListener as unknown as jest.Mock<
  (listener: Listener) => () => void
>;

/** Wires the cache to NetInfo and hands back what NetInfo would call on each change. */
function wired(): { readonly report: Listener; readonly unsubscribe: jest.Mock } {
  const unsubscribe = jest.fn();
  let report: Listener = () => undefined;
  addEventListener.mockImplementation((listener) => {
    report = listener;
    return unsubscribe;
  });
  followNetInfo();
  return { report: (state) => report(state), unsubscribe };
}

afterEach(() => {
  onlineManager.setEventListener(() => undefined);
  onlineManager.setOnline(true);
  addEventListener.mockReset();
});

describe('followNetInfo', () => {
  it('takes the cache offline and back online as NetInfo reports the connection', () => {
    const { report } = wired();
    report({ isConnected: false });
    expect(onlineManager.isOnline()).toBe(false);
    report({ isConnected: true });
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('counts a connection NetInfo has not determined yet as online', () => {
    const { report } = wired();
    report({ isConnected: false });
    report({ isConnected: null });
    expect(onlineManager.isOnline()).toBe(true);
  });

  it('stops listening to NetInfo when the cache is given another listener', () => {
    const { unsubscribe } = wired();
    onlineManager.setEventListener(() => undefined);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('useOnline', () => {
  it('follows the cache’s connection', async () => {
    const { result } = await renderHook(() => useOnline());
    expect(result.current).toBe(true);
    await act(async () => onlineManager.setOnline(false));
    expect(result.current).toBe(false);
    await act(async () => onlineManager.setOnline(true));
    expect(result.current).toBe(true);
  });
});
