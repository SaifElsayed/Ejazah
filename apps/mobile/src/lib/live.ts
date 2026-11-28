// T065 of specs/004-sessions (research R-324, item 2; contracts/app-surface.md, "`live`"): the
// phone's EventSource for the live channel. React Native has none, and the maintained one needs the
// DOM's `Event` and `EventTarget`, which Hermes lacks; so this is tRPC's `EventSourceLike` over the
// platform's `fetch` (`expo/fetch` on the phone, which streams a response's body) and
// `eventsource-parser`, a pure parser.
//
// It reads the stream as it arrives and never the body whole, and never goes through `timed()`
// (lib/client.ts), which reads the whole body and aborts after `CALL_TIMEOUT_MS`: a stream is open
// for minutes. The bearer is read from the session store at each open and sent in the
// `Authorization` header, never in the URL (the mount refuses `connectionParams`). It does not
// reconnect by itself: an answer that is not a stream, a failed transport or a body that ends
// closes it and says so once (`error`, with `readyState` CLOSED, which tRPC's link reads as the
// subscription's end), and the channel reopens it, so a reopening always reads the current token.
//
// R3 T184 (SRS DEC-99): each opening carries the build number in `x-app-build` (none without one),
// and an opening refused `UPDATE_REQUIRED`, which tRPC writes as the stream's `serialized-error`
// frame, calls `onUpdateRequired` once before the frame goes to tRPC's listener as any refusal does.
import { createParser, type EventSourceMessage } from 'eventsource-parser';

import { UPDATE_REQUIRED, withAppBuild } from './app-build';
import type { SessionStore } from './storage';

/** What the EventSource sends a request with: the platform's `fetch`, or a test's. */
export type LiveTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface LiveEventSourceOptions {
  readonly sessions: Pick<SessionStore, 'read'>;
  readonly fetch: LiveTransport;
  /** The running build's number, sent in `x-app-build` (R3 T184). */
  readonly appBuild?: number | null;
  /** Called once when an opening is refused `UPDATE_REQUIRED` (R3 T184). */
  readonly onUpdateRequired?: () => void;
}

/** An event as tRPC's link reads it: the `data` of a message, and its id when it has one. */
export interface LiveMessageEvent {
  readonly type: string;
  readonly data: string;
  readonly lastEventId?: string;
}

type Listener = (event: LiveMessageEvent) => void;

/** tRPC's `EventSourceLike.Instance`. */
export interface LiveEventSourceInstance {
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSED: number;
  readonly readyState: number;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  close(): void;
}

export type LiveEventSourceConstructor = new (url: string) => LiveEventSourceInstance;

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;
const EVENT_STREAM = 'text/event-stream';
/** The event tRPC writes a refusal in, its data the API's error shape (`{ code, message }`). */
const SERIALIZED_ERROR = 'serialized-error';

/** The EventSource class tRPC's `httpSubscriptionLink` constructs for each open. */
export function liveEventSource(options: LiveEventSourceOptions): LiveEventSourceConstructor {
  const { sessions, fetch: transport, onUpdateRequired } = options;
  const appBuild = options.appBuild ?? null;

  return class LiveEventSource implements LiveEventSourceInstance {
    readonly CONNECTING = CONNECTING;
    readonly OPEN = OPEN;
    readonly CLOSED = CLOSED;
    readyState = CONNECTING;
    readonly #listeners = new Map<string, Set<Listener>>();
    readonly #abort = new AbortController();

    constructor(url: string) {
      void this.#open(url);
    }

    addEventListener(type: string, listener: Listener): void {
      const listeners = this.#listeners.get(type) ?? new Set<Listener>();
      listeners.add(listener);
      this.#listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: Listener): void {
      this.#listeners.get(type)?.delete(listener);
    }

    close(): void {
      if (this.readyState === CLOSED) return;
      this.readyState = CLOSED;
      this.#abort.abort();
      this.#listeners.clear();
    }

    async #open(url: string): Promise<void> {
      try {
        const session = await sessions.read();
        if (this.readyState === CLOSED) return;
        const headers = withAppBuild(
          { accept: EVENT_STREAM, 'cache-control': 'no-cache' },
          appBuild,
        );
        if (session !== null) headers.set('authorization', `Bearer ${session.accessToken}`);
        const response = await transport(url, {
          method: 'GET',
          headers,
          signal: this.#abort.signal,
        });
        const reader = response.body?.getReader();
        if (this.readyState === CLOSED) {
          void reader?.cancel().catch(() => undefined);
          return;
        }
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !type.includes(EVENT_STREAM) || reader === undefined) {
          void reader?.cancel().catch(() => undefined);
          this.#fail();
          return;
        }
        this.readyState = OPEN;
        this.#dispatch({ type: 'open', data: '' });
        await this.#follow(reader);
      } catch {
        // A transport that fails (no connection, an abort by close()) is the stream's end.
      }
      this.#fail();
    }

    /** Parses each chunk as it arrives, until the body ends or the source is closed. */
    async #follow(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
      const decoder = new TextDecoder();
      const parser = createParser({
        onEvent: (message: EventSourceMessage) => {
          if (refusesThisBuild(message)) onUpdateRequired?.();
          this.#dispatch(eventOf(message));
        },
      });
      const stop = () => void reader.cancel().catch(() => undefined);
      this.#abort.signal.addEventListener('abort', stop);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || this.readyState === CLOSED) return;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } finally {
        this.#abort.signal.removeEventListener('abort', stop);
      }
    }

    /** Closed by the stream, not by close(): `error` once, with `readyState` CLOSED. */
    #fail(): void {
      if (this.readyState === CLOSED) return;
      this.readyState = CLOSED;
      this.#abort.abort();
      this.#dispatch({ type: 'error', data: '' });
      this.#listeners.clear();
    }

    #dispatch(event: LiveMessageEvent): void {
      for (const listener of [...(this.#listeners.get(event.type) ?? [])]) {
        if (this.readyState === CLOSED && event.type !== 'error') return;
        listener(event);
      }
    }
  };
}

/** True when the message is tRPC's refusal of the opening with `UPDATE_REQUIRED` (R3 T184). */
function refusesThisBuild(message: EventSourceMessage): boolean {
  if (message.event !== SERIALIZED_ERROR) return false;
  try {
    const refusal: unknown = JSON.parse(message.data);
    return (
      typeof refusal === 'object' &&
      refusal !== null &&
      'code' in refusal &&
      refusal.code === UPDATE_REQUIRED
    );
  } catch {
    return false;
  }
}

/** A parsed message as tRPC's listeners read it: `message` when the stream names no event. */
function eventOf(message: EventSourceMessage): LiveMessageEvent {
  const type = message.event ?? 'message';
  return message.id === undefined
    ? { type, data: message.data }
    : { type, data: message.data, lastEventId: message.id };
}
