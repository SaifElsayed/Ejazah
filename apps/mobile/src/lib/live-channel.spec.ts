// T065 of specs/004-sessions (research R-324, items 2, 7, 8 and 9; R-325; contracts/app-surface.md,
// "`live`"): the phone's one live channel. It is open while the person is signed in and the app is
// `active`, closed when the app leaves `active` and opened again when it returns. It reopens after
// a failure with a backoff from 1 s doubling to 30 s, each delay × a random 0.5 to 1.5; after the
// server ended it, after a random 1 to 15 s; after `RATE_LIMITED`, after the refusal's
// `retryAfterSeconds`, or 60 s when it gives none. On `UNAUTHENTICATED` it reads `account.me` once,
// then reopens; an `account` event reads `account.me`; a `session` or `enrollment` signal reads the
// open screens again, at most once per query key per second; each (re)start reads the open live
// screens again, but the first after a return to the foreground, which `focusManager` has read.
import type { MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { apiError } from '../features/shared/__tests__/api-double';
import {
  backoffDelayMs,
  LiveChannel,
  type LiveHandlers,
  type LivePorts,
  RATE_LIMITED_FALLBACK_MS,
  RECONNECT_BACKOFF_CAP_MS,
  RECONNECT_BACKOFF_FIRST_MS,
  REREAD_EVERY_MS,
  handChatEvent,
  onChatEvent,
  Rereads,
  SERVER_END_DELAY_MAX_MS,
  SERVER_END_DELAY_MIN_MS,
  serverEndDelayMs,
  useLiveChannel,
} from './live-channel';
import { setSession } from './session';

// The jitter's default draw comes from the platform's secure generator; here always the middle.
jest.mock('expo-crypto', () => ({
  getRandomValues: (array: Uint32Array) => {
    array.fill(2 ** 31);
    return array;
  },
}));

/** Fifty draws spread over [0, 1). */
const DRAWS = Array.from({ length: 50 }, (_, index) => index / 50);

const SESSION_ID = '0193a6f0-0000-7000-8000-0000000000c1';
const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const OTHER_ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e2';

/** T045: a message of the enrollment's chat, as `chat.list` answers it to this recipient. */
const CHAT_EVENT = {
  type: 'chat',
  enrollmentId: ENROLLMENT_ID,
  message: {
    messageId: '0193a6f0-0000-7000-8000-0000000000f1',
    mine: false,
    body: 'السلام عليكم',
    sentAt: '2026-11-12T10:00:00.000Z',
    purged: false,
  },
} as const;

/** A channel over ports a case reads: each open hands back its handlers. */
function channelOver(random = () => 0.5) {
  const opened: LiveHandlers[] = [];
  const closed: number[] = [];
  const ports = {
    open: jest.fn((handlers: LiveHandlers) => {
      const index = opened.push(handlers) - 1;
      return { unsubscribe: () => void closed.push(index) };
    }),
    readAccount: jest.fn(async () => undefined),
    signal: jest.fn(),
    chat: jest.fn(),
    reread: jest.fn(),
    random,
  } satisfies LivePorts;
  const channel = new LiveChannel(ports);
  return {
    channel,
    ports,
    closed,
    /** The handlers of the latest open. */
    latest: (): LiveHandlers => {
      const last = opened.at(-1);
      if (last === undefined) throw new Error('the channel never opened');
      return last;
    },
  };
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

const offline = () => new TypeError('Network request failed');

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the reopening delays (T065, R-324 items 8 and 9)', () => {
  it('backs off from 1 s, doubling to a 30 s cap', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map((failures) => backoffDelayMs(failures, () => 0.5))).toEqual(
      [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000],
    );
    expect(RECONNECT_BACKOFF_FIRST_MS).toBe(1_000);
    expect(RECONNECT_BACKOFF_CAP_MS).toBe(30_000);
  });

  it('multiplies each delay by a random 0.5 to 1.5, never outside', () => {
    for (const failures of [0, 3, 5, 8]) {
      const base = Math.min(1_000 * 2 ** failures, 30_000);
      expect(backoffDelayMs(failures, () => 0)).toBe(base * 0.5);
      expect(backoffDelayMs(failures, () => 0.999_999)).toBeLessThanOrEqual(base * 1.5);
      expect(backoffDelayMs(failures, () => 0.999_999)).toBeGreaterThan(base * 1.49);
      for (const draw of DRAWS) {
        const delay = backoffDelayMs(failures, () => draw);
        expect(delay).toBeGreaterThanOrEqual(base * 0.5);
        expect(delay).toBeLessThanOrEqual(base * 1.5);
      }
    }
  });

  it('waits a random 1 to 15 s after the server ended the stream', () => {
    expect(SERVER_END_DELAY_MIN_MS).toBe(1_000);
    expect(SERVER_END_DELAY_MAX_MS).toBe(15_000);
    expect(serverEndDelayMs(() => 0)).toBe(1_000);
    expect(serverEndDelayMs(() => 0.999_999)).toBeLessThanOrEqual(15_000);
    expect(serverEndDelayMs(() => 0.999_999)).toBeGreaterThan(14_999);
    for (const draw of DRAWS) {
      const delay = serverEndDelayMs(() => draw);
      expect(delay).toBeGreaterThanOrEqual(1_000);
      expect(delay).toBeLessThanOrEqual(15_000);
    }
  });
});

describe('the channel’s reopenings (T065)', () => {
  it('opens once while wanted, and reopens a failed open on the backoff, never by itself before', async () => {
    const { channel, ports, latest } = channelOver(() => 0.5);
    channel.setActive(true);
    channel.setActive(true);
    expect(ports.open).toHaveBeenCalledTimes(1);
    latest().onError(offline());
    await advance(999);
    expect(ports.open).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(ports.open).toHaveBeenCalledTimes(2);
    latest().onError(offline());
    await advance(1_999);
    expect(ports.open).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(ports.open).toHaveBeenCalledTimes(3);
    channel.stop();
  });

  it('starts the backoff again from 1 s after a stream that was open fails', async () => {
    const { channel, ports, latest } = channelOver(() => 0.5);
    channel.setActive(true);
    latest().onError(offline());
    await advance(1_000);
    latest().onError(offline());
    await advance(2_000);
    expect(ports.open).toHaveBeenCalledTimes(3);
    latest().onStarted();
    latest().onError(offline());
    await advance(1_000);
    expect(ports.open).toHaveBeenCalledTimes(4);
    channel.stop();
  });

  it('after the server’s end, reopens after a random 1 to 15 s', async () => {
    const { channel, ports, latest } = channelOver(() => 0.5);
    channel.setActive(true);
    latest().onStarted();
    latest().onComplete();
    await advance(7_999);
    expect(ports.open).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(ports.open).toHaveBeenCalledTimes(2);
    channel.stop();
  });

  it('after a refused opening RATE_LIMITED, waits the refusal’s retryAfterSeconds', async () => {
    const { channel, ports, latest } = channelOver();
    channel.setActive(true);
    latest().onStarted();
    latest().onError(apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '31' }]));
    await advance(30_999);
    expect(ports.open).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(ports.open).toHaveBeenCalledTimes(2);
    channel.stop();
  });

  it('after a refused opening RATE_LIMITED with no time, or an unreadable one, waits 60 s', async () => {
    expect(RATE_LIMITED_FALLBACK_MS).toBe(60_000);
    for (const details of [[], [{ path: 'retryAfterSeconds', code: 'soon' }]]) {
      const { channel, ports, latest } = channelOver();
      channel.setActive(true);
      latest().onError(apiError('RATE_LIMITED', details));
      await advance(59_999);
      expect(ports.open).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(ports.open).toHaveBeenCalledTimes(2);
      channel.stop();
    }
  });

  it('on UNAUTHENTICATED reads account.me once, then reopens', async () => {
    const { channel, ports, latest } = channelOver(() => 0.5);
    channel.setActive(true);
    latest().onStarted();
    latest().onError(apiError('UNAUTHENTICATED'));
    await advance(0);
    expect(ports.readAccount).toHaveBeenCalledTimes(1);
    expect(ports.open).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(ports.open).toHaveBeenCalledTimes(2);
    expect(ports.readAccount).toHaveBeenCalledTimes(1);
    channel.stop();
  });

  it('reads account.me on an `account` event, and passes a session or enrollment signal on', () => {
    const { channel, ports, latest } = channelOver();
    channel.setActive(true);
    latest().onData({ type: 'account' });
    latest().onData({ type: 'session', sessionId: SESSION_ID, enrollmentId: ENROLLMENT_ID });
    latest().onData({ type: 'enrollment', enrollmentId: ENROLLMENT_ID });
    latest().onData({ type: 'unknown' });
    expect(ports.readAccount).toHaveBeenCalledTimes(1);
    expect(ports.signal.mock.calls).toEqual([
      [{ type: 'session', sessionId: SESSION_ID, enrollmentId: ENROLLMENT_ID }],
      [{ type: 'enrollment', enrollmentId: ENROLLMENT_ID }],
    ]);
    channel.stop();
  });

  // PR #135's review, round 1, Minor 1: a `chat` event carries a message for the open chat to merge
  // (T045, contracts/app-surface.md's `chat` row), never a re-read of the enrollment's screens.
  it('hands a `chat` event to the open chat’s merge, and re-reads nothing and reads no account.me (T045)', () => {
    const { channel, ports, latest } = channelOver();
    channel.setActive(true);
    latest().onData(CHAT_EVENT);
    // A message outside the contract is no event at all.
    latest().onData({ ...CHAT_EVENT, message: { ...CHAT_EVENT.message, sentAt: 'soon' } });
    expect(ports.chat.mock.calls).toEqual([[CHAT_EVENT]]);
    expect(ports.signal).not.toHaveBeenCalled();
    expect(ports.readAccount).not.toHaveBeenCalled();
    expect(ports.reread).not.toHaveBeenCalled();
    channel.stop();
  });

  it('closes when the app leaves `active`, reopens when it returns, and drops a pending reopening', async () => {
    const { channel, ports, latest, closed } = channelOver(() => 0.5);
    channel.setActive(true);
    channel.setActive(false);
    expect(closed).toEqual([0]);
    channel.setActive(true);
    expect(ports.open).toHaveBeenCalledTimes(2);
    latest().onError(offline());
    channel.setActive(false);
    await advance(60_000);
    expect(ports.open).toHaveBeenCalledTimes(2);
    // A late callback of a closed stream changes nothing.
    latest().onComplete();
    await advance(60_000);
    expect(ports.open).toHaveBeenCalledTimes(2);
  });

  it('reads the open live screens again on each start, but the first after a return to the foreground', () => {
    const { channel, ports, latest } = channelOver();
    channel.setActive(true);
    latest().onStarted();
    expect(ports.reread).toHaveBeenCalledTimes(1);
    channel.setActive(false);
    channel.setActive(true);
    latest().onStarted();
    expect(ports.reread).toHaveBeenCalledTimes(1);
    latest().onComplete();
    jest.advanceTimersByTime(SERVER_END_DELAY_MAX_MS);
    latest().onStarted();
    expect(ports.reread).toHaveBeenCalledTimes(2);
    channel.stop();
  });
});

describe('the re-reads after a signal (T065, R-325)', () => {
  const mounted: (() => void)[] = [];

  afterEach(() => {
    for (const unmount of mounted.splice(0)) unmount();
  });

  /** A cache with one observed query under each key, each read counted. */
  function observing(keys: readonly (readonly unknown[])[]) {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    return { queries, reads: (key: readonly unknown[]) => reads.get(JSON.stringify(key)) ?? 0 };
  }

  const sessionKey = ['sessions', 'get', SESSION_ID];
  const enrollmentKey = ['student', 'enrollments', 'get', ENROLLMENT_ID];
  const otherEnrollmentKey = ['student', 'enrollments', 'get', OTHER_ENROLLMENT_ID];
  const activeListKey = ['student', 'enrollments', 'list', 'active'];
  const teacherEnrollmentKey = ['teacher', 'students', 'get', ENROLLMENT_ID];
  const todayKey = ['teacher', 'today'];
  const discoveryKey = ['student', 'discovery', 'browse', {}];

  it('reads a session signal’s session and its enrollment again, at most once per key per second', async () => {
    const cache = observing([sessionKey, enrollmentKey, otherEnrollmentKey, discoveryKey]);
    await advance(0);
    const rereads = new Rereads(cache.queries);
    const signal = { type: 'session', sessionId: SESSION_ID, enrollmentId: ENROLLMENT_ID } as const;
    for (let flap = 0; flap < 5; flap += 1) rereads.signal(signal);
    await advance(0);
    expect(cache.reads(sessionKey)).toBe(2);
    expect(cache.reads(enrollmentKey)).toBe(2);
    await advance(REREAD_EVERY_MS - 1);
    expect(cache.reads(sessionKey)).toBe(2);
    await advance(1);
    // The signals inside the second are read once more at its end, never lost, never repeated.
    expect(cache.reads(sessionKey)).toBe(3);
    expect(cache.reads(enrollmentKey)).toBe(3);
    await advance(REREAD_EVERY_MS * 5);
    expect(cache.reads(sessionKey)).toBe(3);
    expect(cache.reads(otherEnrollmentKey)).toBe(1);
    expect(cache.reads(discoveryKey)).toBe(1);
    rereads.dispose();
  });

  it('reads an enrollment signal’s enrollment and the enrollment lists again, either role’s', async () => {
    const cache = observing([
      enrollmentKey,
      teacherEnrollmentKey,
      activeListKey,
      todayKey,
      sessionKey,
    ]);
    await advance(0);
    const rereads = new Rereads(cache.queries);
    rereads.signal({ type: 'enrollment', enrollmentId: ENROLLMENT_ID });
    await advance(0);
    expect(
      [enrollmentKey, teacherEnrollmentKey, activeListKey, todayKey, sessionKey].map(cache.reads),
    ).toEqual([2, 2, 2, 2, 1]);
    rereads.dispose();
  });

  it('on a (re)start reads the open live screens again, and nothing else', async () => {
    const cache = observing([sessionKey, enrollmentKey, todayKey, discoveryKey]);
    await advance(0);
    const rereads = new Rereads(cache.queries);
    rereads.readOpenLiveScreens();
    await advance(0);
    expect([sessionKey, enrollmentKey, todayKey, discoveryKey].map(cache.reads)).toEqual([
      2, 2, 2, 1,
    ]);
    rereads.dispose();
  });

  // T045 (FR-427; research R-324): events sent while the stream was down are not replayed, so a
  // (re)start reads the open chat's first page again; its older pages, which no event changes, are
  // not read again.
  it('on a (re)start reads the open chat’s first page again, never its older pages (T045)', async () => {
    const chatFirstKey = ['chat', 'first', { enrollmentId: ENROLLMENT_ID }];
    const chatOlderKey = ['chat', 'older', { enrollmentId: ENROLLMENT_ID, cursor: SESSION_ID }];
    const cache = observing([chatFirstKey, chatOlderKey]);
    await advance(0);
    const rereads = new Rereads(cache.queries);
    rereads.readOpenLiveScreens();
    await advance(0);
    expect([chatFirstKey, chatOlderKey].map(cache.reads)).toEqual([2, 1]);
    rereads.dispose();
  });
});

// T045: the open chat's merge. Each open chat screen adds its merge while it is mounted; the
// channel hands every `chat` event to the merges open, and a merge removed hears nothing more.
describe('the open chats’ merges (T045)', () => {
  it('hands a chat event to every open chat’s merge, and none to a merge removed', () => {
    const first = jest.fn();
    const second = jest.fn();
    const removeFirst = onChatEvent(first);
    const removeSecond = onChatEvent(second);
    handChatEvent(CHAT_EVENT);
    removeFirst();
    handChatEvent(CHAT_EVENT);
    removeSecond();
    handChatEvent(CHAT_EVENT);
    expect(first.mock.calls).toEqual([[CHAT_EVENT]]);
    expect(second.mock.calls).toEqual([[CHAT_EVENT], [CHAT_EVENT]]);
  });
});

describe('the channel at the root (T065): signed in and `active`', () => {
  type Listener = (status: AppStateStatus) => void;
  const restore: (() => void)[] = [];

  /** AppState as the case sets it: its state now, and what it reports on each change. */
  function appState(initial: AppStateStatus) {
    let report: Listener = () => undefined;
    const remove = jest.fn();
    const original = AppState.currentState;
    Object.assign(AppState, { currentState: initial });
    restore.push(() => Object.assign(AppState, { currentState: original }));
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'change') report = listener as Listener;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    return { report: (status: AppStateStatus) => report(status), remove };
  }

  function clientWithChannel() {
    const unsubscribe = jest.fn();
    const subscribe = jest.fn((_input: undefined, _handlers: LiveHandlers) => ({ unsubscribe }));
    const me = jest.fn(async () => ({}) as MeOutput);
    return {
      subscribe,
      unsubscribe,
      me,
      client: { api: { live: { events: { subscribe } }, account: { me: { query: me } } } },
    };
  }

  const signIn = () =>
    act(async () => {
      setSession({ kind: 'signed-in', landing: 'student_home' });
    });

  afterEach(async () => {
    await act(async () => {
      setSession({ kind: 'signed-out' });
    });
    for (const undo of restore.splice(0)) undo();
  });

  it('opens while signed in and active, closes when the app leaves active, reopens on return', async () => {
    const state = appState('active');
    const api = clientWithChannel();
    const queries = new QueryClient();
    await signIn();
    const hook = await renderHook(() => useLiveChannel(api.client as never, queries));
    expect(api.subscribe).toHaveBeenCalledTimes(1);

    await act(async () => state.report('background'));
    expect(api.unsubscribe).toHaveBeenCalledTimes(1);
    await advance(120_000);
    expect(api.subscribe).toHaveBeenCalledTimes(1);

    await act(async () => state.report('active'));
    expect(api.subscribe).toHaveBeenCalledTimes(2);

    await act(async () => {
      setSession({ kind: 'signed-out' });
    });
    expect(api.unsubscribe).toHaveBeenCalledTimes(2);
    await hook.unmount();
    expect(state.remove).toHaveBeenCalled();
  });

  it('stays closed while signed out, and while the app is in the background', async () => {
    // Signed out with the app in the foreground: each condition is tried on its own.
    appState('active');
    const api = clientWithChannel();
    const queries = new QueryClient();
    const signedOut = await renderHook(() => useLiveChannel(api.client as never, queries));
    expect(api.subscribe).not.toHaveBeenCalled();
    await signedOut.unmount();

    Object.assign(AppState, { currentState: 'background' });
    await signIn();
    const background = await renderHook(() => useLiveChannel(api.client as never, queries));
    expect(api.subscribe).not.toHaveBeenCalled();
    await background.unmount();
  });

  it('on UNAUTHENTICATED reads account.me once through the client, then reopens', async () => {
    appState('active');
    const api = clientWithChannel();
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queries.mount();
    await signIn();
    const observer = new QueryObserver(queries, {
      queryKey: ['account', 'me'],
      queryFn: () => api.client.api.account.me.query(),
    });
    const stop = observer.subscribe(() => undefined);
    await advance(0);
    expect(api.me).toHaveBeenCalledTimes(1);
    const hook = await renderHook(() => useLiveChannel(api.client as never, queries));
    const handlers = api.subscribe.mock.calls[0]?.[1];
    await act(async () => handlers?.onError(apiError('UNAUTHENTICATED')));
    await advance(0);
    expect(api.me).toHaveBeenCalledTimes(2);
    await advance(RECONNECT_BACKOFF_FIRST_MS * 1.5);
    expect(api.subscribe).toHaveBeenCalledTimes(2);
    expect(api.me).toHaveBeenCalledTimes(2);
    await hook.unmount();
    stop();
    queries.unmount();
    queries.clear();
  });

  it('hands a chat event of the stream to the open chat’s merge (T045)', async () => {
    appState('active');
    const api = clientWithChannel();
    const queries = new QueryClient();
    await signIn();
    const merge = jest.fn();
    const remove = onChatEvent(merge);
    const hook = await renderHook(() => useLiveChannel(api.client as never, queries));
    const handlers = api.subscribe.mock.calls[0]?.[1];
    await act(async () => handlers?.onData(CHAT_EVENT));
    expect(merge.mock.calls).toEqual([[CHAT_EVENT]]);
    remove();
    await hook.unmount();
  });
});
