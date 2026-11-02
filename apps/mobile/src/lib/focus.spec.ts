// T015 (R-217, FR-383): the query cache knows when the app is in the foreground. React Native's
// `AppState` drives TanStack Query's `focusManager`, as TanStack's React Native guide shows, so a
// query whose data is stale reads again when the person comes back to the app.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { followAppState } from './focus';

type Listener = (status: AppStateStatus) => void;

/** Wires the cache to AppState and hands back what AppState would call on each change. */
function wired(): { readonly report: Listener; readonly remove: jest.Mock } {
  const remove = jest.fn();
  let report: Listener = () => undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'change') report = listener as Listener;
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  followAppState();
  return { report: (status) => report(status), remove };
}

/** Lets the cache's promises (a refetch and its result) run out. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** What each case leaves mounted, taken down after it whether it passed or not (T170). */
const mounted: (() => void)[] = [];

/** A mounted cache with one observed query, read once, whose data is stale at once. */
async function observed(): Promise<jest.Mock<() => Promise<string>>> {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.mount();
  const read = jest.fn(async () => 'data');
  const observer = new QueryObserver(queries, { queryKey: ['enrollment'], queryFn: read });
  const unsubscribe = observer.subscribe(() => undefined);
  mounted.push(() => {
    unsubscribe();
    queries.unmount();
    queries.clear();
  });
  await settle();
  return read;
}

afterEach(() => {
  mounted.splice(0).forEach((takeDown) => takeDown());
  focusManager.setEventListener(() => undefined);
  focusManager.setFocused(undefined);
  jest.restoreAllMocks();
});

describe('followAppState', () => {
  it('counts the app as focused only while AppState reports it active', () => {
    const { report } = wired();
    report('background');
    expect(focusManager.isFocused()).toBe(false);
    report('active');
    expect(focusManager.isFocused()).toBe(true);
    report('inactive');
    expect(focusManager.isFocused()).toBe(false);
  });

  it('reads a stale query again when the app comes back from the background', async () => {
    const { report } = wired();
    const read = await observed();
    expect(read).toHaveBeenCalledTimes(1);
    report('background');
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
    report('active');
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not read again when the app only turns inactive', async () => {
    const { report } = wired();
    report('active');
    const read = await observed();
    report('inactive');
    await settle();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stops listening to AppState when the cache is given another listener', () => {
    const { remove } = wired();
    expect(remove).not.toHaveBeenCalled();
    focusManager.setEventListener(() => undefined);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
