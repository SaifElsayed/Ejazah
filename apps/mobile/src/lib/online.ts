// T138 (FR-205): whether the phone has a connection, as the query cache knows it. NetInfo drives
// TanStack Query's `onlineManager` (TanStack's React Native guide), so a read waits for the
// connection instead of failing, reads again when it is back, and the screens draw the offline
// pattern meanwhile.
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * Lets NetInfo tell the query cache when the connection comes and goes. A connection NetInfo has
 * not determined yet (`isConnected: null`) counts as online, the cache's own assumption, so a
 * launch does not flash the offline banner.
 */
export function followNetInfo(): void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );
}

const subscribe = (listener: () => void) => onlineManager.subscribe(listener);
const isOnline = () => onlineManager.isOnline();

/** Whether the query cache counts the phone as online; a screen draws again when it changes. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline);
}
