// T065 of specs/004-sessions (FR-427 to FR-429, FR-437, FR-438; research R-324, items 2, 7, 8 and 9;
// R-325; contracts/app-surface.md, "`live`"): the phone's one live channel, `live.events`, opened at
// the root (`app/_layout.tsx`) while the person is signed in and the app is `active`, closed when it
// leaves `active` and opened again when it returns. Its stream is lib/live.ts' EventSource, which
// never reconnects by itself: this channel reopens it, so every opening reads the current token.
//
// REOPENING. After a failure, a backoff from 1 s doubling to a 30 s cap, each delay × a random 0.5
// to 1.5 (six opens in the worst minute, under `rate_limit_live_channel`'s 10 per 60 s); a stream
// that had started and then failed starts the backoff again from 1 s. After the server ended the
// stream (its token's expiry, an `account` event, a deploy's shutdown), a random 1 to 15 s, so a
// thousand phones come back at about 70 a second. After a refused opening `RATE_LIMITED`, the
// refusal's `retryAfterSeconds`, and 60 s only when it gives none. On `UNAUTHENTICATED`, `account.me`
// once through the normal client (which refreshes the session or signs out, as every call does),
// then the backoff's next delay. tRPC's link reports `started` on the server's first frame, which a
// refused opening sends too, so a refusal never resets the backoff; a failure with no API code
// after `started` is a stream that was open.
//
// SIGNALS. An `account` event reads `account.me` again; the server then ends the stream. A
// `session` or `enrollment` signal reads the open screens it names again, at most once per query key
// per second (`Rereads`). A `chat` event is handed to the open chat's merge, which places its message
// in the chat's first page by `messageId` (T045). Each (re)start reads the open live screens again
// (the open chat's first page among them), since events sent while the stream was down are not
// replayed, but the first start after a return to the foreground, which `focusManager`
// (lib/focus.ts) has read.
//
// THE NUMBERS are named constants on the phone, not settings (R-MONEY-12 as amended, constitution
// 2.6.1; the owner's decision of 2026-11-06, C1, C3 and C4, and the sixth analysis, item 6), each
// with its reason beside it.
import { type LiveEvent, liveEvent } from '@ijazah/contracts';
import { type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { getRandomValues } from 'expo-crypto';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { ME_QUERY_KEY } from './account';
import { type ApiClient, errorCodeOf } from './client';
import { retryAfterSecondsOf } from './error-message';
import { useSession } from './session';

/** The backoff's first delay: the phone cannot read settings before it connects (R-324, item 8). */
export const RECONNECT_BACKOFF_FIRST_MS = 1_000;
/** The backoff's cap: with the first delay, six opens in a minute, under the channel's limit. */
export const RECONNECT_BACKOFF_CAP_MS = 30_000;
/** Each delay × a random 0.5 to 1.5, so phones dropped together do not return together. */
const JITTER_LOW = 0.5;
const JITTER_SPAN = 1;
/** After the server's end, a random 1 to 15 s: a deploy's phones return at about 70 a second (item 9). */
export const SERVER_END_DELAY_MIN_MS = 1_000;
export const SERVER_END_DELAY_MAX_MS = 15_000;
/**
 * After `RATE_LIMITED` with no time: part of the backoff; the phone cannot know the window's end,
 * and an earlier retry is refused again (the fifth analysis, C4; the sixth, item 6).
 */
export const RATE_LIMITED_FALLBACK_MS = 60_000;
/** One re-read per query key per second: it protects the signed-in default limit (C4; R-325). */
export const REREAD_EVERY_MS = 1_000;

const MS_PER_SECOND = 1_000;
const RATE_LIMITED = 'RATE_LIMITED';
const UNAUTHENTICATED = 'UNAUTHENTICATED';

/** A source of uniform draws in [0, 1). */
export type Random = () => number;

const UINT32_VALUES = 2 ** 32;

/** A uniform draw in [0, 1) from the platform's secure generator (R-DB-6 refuses a weak one). */
function secureRandom(): number {
  const [value = 0] = getRandomValues(new Uint32Array(1));
  return value / UINT32_VALUES;
}

/** The wait before the next opening after `failures` failures in a row. */
export function backoffDelayMs(failures: number, random: Random): number {
  const base = Math.min(RECONNECT_BACKOFF_FIRST_MS * 2 ** failures, RECONNECT_BACKOFF_CAP_MS);
  return base * (JITTER_LOW + JITTER_SPAN * random());
}

/** The wait before the opening after the server ended the stream. */
export function serverEndDelayMs(random: Random): number {
  return SERVER_END_DELAY_MIN_MS + (SERVER_END_DELAY_MAX_MS - SERVER_END_DELAY_MIN_MS) * random();
}

/** The wait a `RATE_LIMITED` refusal asks for: its `retryAfterSeconds`, else 60 s. */
export function rateLimitedDelayMs(error: unknown): number {
  const seconds = retryAfterSecondsOf(error);
  return seconds === undefined ? RATE_LIMITED_FALLBACK_MS : seconds * MS_PER_SECOND;
}

/** What tRPC's subscription calls back. */
export interface LiveHandlers {
  onStarted(): void;
  onData(event: unknown): void;
  onError(error: unknown): void;
  onComplete(): void;
}

/** The two signals that make the open screens read again (T065). */
export type LiveSignal = Extract<LiveEvent, { type: 'session' | 'enrollment' }>;

/** A message of an enrollment's chat, carried rather than signalled (T066, T045). */
export type LiveChatEvent = Extract<LiveEvent, { type: 'chat' }>;

/** What the channel needs from the app. */
export interface LivePorts {
  open(handlers: LiveHandlers): { unsubscribe(): void };
  /** `account.me` once, through the normal client. */
  readAccount(): Promise<unknown>;
  /** A `session` or `enrollment` signal: its open screens read again. */
  signal(event: LiveSignal): void;
  /** A `chat` event: handed to the open chat's merge (T045). */
  chat(event: LiveChatEvent): void;
  /** The open live screens read again. */
  reread(): void;
  readonly random?: Random;
}

/** The channel: one stream at a time, reopened on its schedule while the app is `active`. */
export class LiveChannel {
  #active = false;
  #subscription: { unsubscribe(): void } | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every open and every stop, so a closed stream's late callback changes nothing. */
  #generation = 0;
  #failures = 0;
  /** The next start follows a return to the foreground, which `focusManager` has read. */
  #returned = false;

  constructor(private readonly ports: LivePorts) {}

  /** Whether the app is `active`: open when it is, closed when it is not. */
  setActive(active: boolean): void {
    if (active === this.#active) return;
    if (!active) {
      this.#active = false;
      this.#returned = true;
      this.#close();
      return;
    }
    this.#active = true;
    this.#open();
  }

  /** Closes the stream and drops a pending opening for good (a sign-out, the root going away). */
  stop(): void {
    this.#active = false;
    this.#close();
  }

  #close(): void {
    this.#generation += 1;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const subscription = this.#subscription;
    this.#subscription = undefined;
    subscription?.unsubscribe();
  }

  #open(): void {
    if (!this.#active || this.#subscription !== undefined || this.#timer !== undefined) return;
    this.#generation += 1;
    const generation = this.#generation;
    const current = () => generation === this.#generation;
    let started = false;
    this.#subscription = this.ports.open({
      onStarted: () => {
        if (!current()) return;
        started = true;
        if (this.#returned) this.#returned = false;
        else this.ports.reread();
      },
      onData: (data) => {
        if (current()) this.#received(data);
      },
      onError: (error) => {
        if (current()) void this.#failed(error, started);
      },
      onComplete: () => {
        if (!current()) return;
        this.#failures = 0;
        this.#ended(serverEndDelayMs(this.#random));
      },
    });
  }

  #received(data: unknown): void {
    const parsed = liveEvent.safeParse(data);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.type === 'account') void this.ports.readAccount().catch(() => undefined);
    // A `chat` event carries a message for the open chat to merge by `messageId` (T045,
    // contracts/app-surface.md's `chat` row), never a re-read (PR #135's review, round 1, Minor 1).
    else if (event.type === 'chat') this.ports.chat(event);
    // 005:T006 (FR-608; the owner's Q-A6 (a)): the request's state on the enrollment changed, so the
    // enrollment's open screens are read again, as on an `enrollment` signal.
    else if (event.type === 'ijazahRequest') {
      this.ports.signal({ type: 'enrollment', enrollmentId: event.enrollmentId });
    } else this.ports.signal(event);
  }

  async #failed(error: unknown, started: boolean): Promise<void> {
    const code = errorCodeOf(error);
    if (code === RATE_LIMITED) {
      this.#failures += 1;
      this.#ended(rateLimitedDelayMs(error));
      return;
    }
    if (code === UNAUTHENTICATED) {
      this.#subscription = undefined;
      const generation = this.#generation;
      await this.ports.readAccount().catch(() => undefined);
      if (generation !== this.#generation) return;
    } else if (code === undefined && started) {
      this.#failures = 0;
    }
    const delay = backoffDelayMs(this.#failures, this.#random);
    this.#failures += 1;
    this.#ended(delay);
  }

  /** The stream is over: the next opening after `delay`. */
  #ended(delay: number): void {
    this.#subscription = undefined;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#open();
    }, delay);
  }

  get #random(): Random {
    return this.ports.random ?? secureRandom;
  }
}

// ---------------------------------------------------------------------------------------------
// The re-reads.

/**
 * The first segments of the query keys of the screens a live event can change (`sessions.get`,
 * each role's enrollment screens and lists, the teacher's day), and the open chat's first page
 * (T045, `features/shared/chat/api.ts`), into which `chat` events merge: a (re)start reads it
 * again, since no event is replayed. Its older pages no event changes, so they are not here.
 */
const LIVE_QUERY_ROOTS: readonly (readonly string[])[] = [
  ['sessions'],
  ['student', 'enrollments'],
  ['teacher', 'students'],
  ['teacher', 'today'],
  ['chat', 'first'],
];
/** The lists an `enrollment` signal reads again (contracts/app-surface.md, "`live`"). */
const ENROLLMENT_LIST_ROOTS: readonly (readonly string[])[] = [
  ['student', 'enrollments', 'list'],
  ['teacher', 'students', 'list'],
  ['teacher', 'today'],
];

const startsWith = (key: QueryKey, root: readonly string[]) =>
  root.every((segment, index) => key[index] === segment);

/** Whether a query's key names one of `ids` (a session's, an enrollment's): its screen shows it. */
export function keyHoldsAny(key: QueryKey, ids: readonly string[]): boolean {
  return key.some((segment) => typeof segment === 'string' && ids.includes(segment));
}

/** The open screens' queries read again, each at most once per `REREAD_EVERY_MS`. */
export class Rereads {
  /** The keys read within the last second, and whether a signal came for them since. */
  readonly #cooling = new Map<string, { again: boolean; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly queries: QueryClient) {}

  /** A `session` or `enrollment` signal: the screens holding its ids, and an enrollment's lists. */
  signal(event: LiveSignal): void {
    const ids: readonly string[] =
      event.type === 'session' ? [event.sessionId, event.enrollmentId] : [event.enrollmentId];
    this.#readAgain(
      (key) =>
        keyHoldsAny(key, ids) ||
        (event.type === 'enrollment' &&
          ENROLLMENT_LIST_ROOTS.some((root) => startsWith(key, root))),
    );
  }

  /** On a (re)start: every open live screen. */
  readOpenLiveScreens(): void {
    this.#readAgain((key) => LIVE_QUERY_ROOTS.some((root) => startsWith(key, root)));
  }

  dispose(): void {
    for (const { timer } of this.#cooling.values()) clearTimeout(timer);
    this.#cooling.clear();
  }

  #readAgain(matches: (key: QueryKey) => boolean): void {
    const open = this.queries
      .getQueryCache()
      .findAll({ type: 'active', predicate: (query: Query) => matches(query.queryKey) });
    for (const query of open) this.#one(query.queryKey, query.queryHash);
  }

  #one(key: QueryKey, hash: string): void {
    const cooling = this.#cooling.get(hash);
    if (cooling !== undefined) {
      cooling.again = true;
      return;
    }
    this.#read(key);
    const entry = {
      again: false,
      timer: setTimeout(() => {
        this.#cooling.delete(hash);
        if (entry.again) this.#one(key, hash);
      }, REREAD_EVERY_MS),
    };
    this.#cooling.set(hash, entry);
  }

  #read(key: QueryKey): void {
    // A read already on its way is kept, not cancelled and counted twice (R-325, item 2).
    void this.queries.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
  }
}

// ---------------------------------------------------------------------------------------------
// The open chats (T045).

/** An open chat's merge of the `chat` events; a chat of another enrollment passes them by. */
export type ChatMerge = (event: LiveChatEvent) => void;

/** The merges of the chats open now: one per mounted chat screen, removed when it unmounts. */
const openChats = new Set<ChatMerge>();

/** Adds an open chat's merge; the function returned removes it. */
export function onChatEvent(merge: ChatMerge): () => void {
  openChats.add(merge);
  return () => {
    openChats.delete(merge);
  };
}

/** The channel's `chat` port: the event handed to every open chat's merge. */
export function handChatEvent(event: LiveChatEvent): void {
  for (const merge of openChats) merge(event);
}

// ---------------------------------------------------------------------------------------------
// The root's hook.

/**
 * The channel while signed in, following AppState; `app/_layout.tsx` mounts it once. A restricted
 * account opens none: the server refuses the channel to a restricted standing, so it would only be
 * refused at the backoff's cap; it opens once the account leaves the restricted screen (the
 * owner's decision of 2026-11-11, beyond T065's text).
 */
export function useLiveChannel(client: Pick<ApiClient, 'api'>, queries: QueryClient): void {
  const session = useSession();
  const signedIn = session.kind === 'signed-in' && session.landing !== 'restricted';
  useEffect(() => {
    if (!signedIn) return;
    const rereads = new Rereads(queries);
    const channel = new LiveChannel({
      open: (handlers) => client.api.live.events.subscribe(undefined, handlers),
      readAccount: () =>
        queries.invalidateQueries(
          { queryKey: ME_QUERY_KEY, exact: true },
          { cancelRefetch: false },
        ),
      signal: (event) => rereads.signal(event),
      chat: handChatEvent,
      reread: () => rereads.readOpenLiveScreens(),
    });
    channel.setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (status) =>
      channel.setActive(status === 'active'),
    );
    return () => {
      subscription.remove();
      channel.stop();
      rereads.dispose();
    };
  }, [client, queries, signedIn]);
}
