// T063 of specs/004-sessions: the open live streams of this process (FR-427 to FR-429; research
// R-324, items 3, 8 and 9; contracts/kernel.md, "The live channel", `LiveRegistry`).
//
// BY USER AND BY SIGN-IN SESSION. Each stream belongs to the user and the sign-in session that
// opened it. At most `live_channel_max_connections_per_user` streams per user, a setting read at
// each open (a missing or invalid row refuses the open, FR-034): when one more opens, the OLDEST is
// ended, since a half-open connection left by a network switch would otherwise lock the phone out
// for minutes.
//
// WHAT ENDS A STREAM. Its access token's expiry (every stream ends no later than the token it was
// opened with, so a lost `account` publish never leaves a revoked device streaming); the client
// leaving (the request's abort signal); an `account` event, which the stream sends and then ends;
// a bounded queue that overflows (`LIVE_STREAM_QUEUE_BOUND`: a reader that falls behind is ended,
// not held in memory); one more open past the cap; and shutdown (`endAll`). A stream the server ends
// by itself writes one `info` line, `{ userId, reason }` and nothing else (never an event's payload
// or a token): `connection_cap`, `queue_overflow` or `account_restricted`; shutdown writes one line
// `{ streamsEnded }`. A token's expiry and a sign-out write none: both happen in the normal course
// (an access token lives `session_access_ttl_minutes`) and would flood the log (the owner's
// decision of 2026-11-06 before the push).
//
// SHUTDOWN, THE OWNER'S HARD CONDITION. `endAll` ends every stream at once, synchronously, and every
// open after it ends at once too, so `application.close()` (Node's `server.close()`, which waits on
// a connection still answering) never waits on a stream (FR-429).
//
// NOTHING LEAKS. A stream's expiry timer and abort listener are removed when it ends, and its entry
// leaves both maps then, whether or not anything read it.
import { type LiveEvent, liveEvent } from '@ijazah/contracts';

import { LIVE_MAX_CONNECTIONS_SETTING, liveMaxConnections } from '../settings/keys.js';
import type { SettingsReader } from '../settings/settings-reader.js';
import type { LiveBus, LiveMessage } from './live-bus.js';
import { LIVE_STREAM_QUEUE_BOUND } from './live-constants.js';

/** Why the server ended a stream by itself; the three reasons it logs. */
export type LiveEndReason = 'connection_cap' | 'queue_overflow' | 'account_restricted';

/** Where the registry writes a stream it ended by itself, and shutdown's count. */
export interface LiveRegistryLog {
  info(fields: Readonly<Record<string, string | number>>, message: string): void;
}

export interface LiveRegistryDependencies {
  readonly bus: LiveBus;
  readonly settings: SettingsReader;
  readonly log: LiveRegistryLog;
  /** The wall clock in milliseconds, against which a token's expiry is read; `Date.now` by default. */
  readonly now?: () => number;
}

/** What one open stream belongs to and when it must end. */
export interface LiveOpening {
  readonly userId: string;
  /** The sign-in session the stream was opened under, so a sign-out ends that session's only. */
  readonly sessionId: string;
  /** The access token's expiry: the stream ends then at the latest. */
  readonly expiresAt: Date;
  /** The request's abort signal: the client went away. */
  readonly signal?: AbortSignal;
}

/** Node's largest timer delay; a longer one is armed again when it fires. */
const LONGEST_TIMER_MS = 2_147_483_647;

/** One open stream: its unsent events, and how it ends. */
class LiveStream {
  readonly userId: string;
  readonly sessionId: string;
  #queue: LiveEvent[] = [];
  /** `open`; `closing` sends what is queued, then ends; `ended` sends nothing more. */
  #state: 'open' | 'closing' | 'ended' = 'open';
  #wake: (() => void) | undefined;
  readonly #cleanups: Array<() => void> = [];
  #released = false;

  constructor(userId: string, sessionId: string) {
    this.userId = userId;
    this.sessionId = sessionId;
  }

  get open(): boolean {
    return this.#state === 'open';
  }

  /** Queues `event`; false when the queue is already at its bound. */
  push(event: LiveEvent): boolean {
    if (this.#state !== 'open') return true;
    if (this.#queue.length >= LIVE_STREAM_QUEUE_BOUND) return false;
    this.#queue.push(event);
    this.#notify();
    return true;
  }

  /** Sends `last`, then ends: an `account` event's way out. */
  closeAfter(last: LiveEvent): void {
    if (this.#state !== 'open') return;
    this.#queue.push(last);
    this.#state = 'closing';
    this.#release();
    this.#notify();
  }

  /** Ends now: nothing queued is sent. */
  end(): void {
    if (this.#state === 'ended') return;
    this.#queue = [];
    this.#state = 'ended';
    this.#release();
    this.#notify();
  }

  /** Runs `cleanup` once the stream stops taking events (a timer, a listener). */
  onRelease(cleanup: () => void): void {
    // Registered once the stream already let go (ended as it opened): run now, never held.
    if (this.#released) {
      cleanup();
      return;
    }
    this.#cleanups.push(cleanup);
  }

  /** What the subscription yields: every queued event in order, until the stream ends. */
  async *events(): AsyncGenerator<LiveEvent, void, undefined> {
    try {
      for (;;) {
        const next = this.#queue.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (this.#state !== 'open') return;
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
      }
    } finally {
      // The reader stopped (the response ended or was cancelled): nothing more is taken.
      this.end();
    }
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }

  #release(): void {
    this.#released = true;
    for (const cleanup of this.#cleanups.splice(0)) cleanup();
  }
}

export class LiveRegistry {
  readonly #settings: SettingsReader;
  readonly #log: LiveRegistryLog;
  readonly #now: () => number;
  /** Each user's open streams, oldest first. */
  readonly #byUser = new Map<string, LiveStream[]>();
  readonly #unsubscribe: () => void;
  #closed = false;

  constructor({ bus, settings, log, now }: LiveRegistryDependencies) {
    this.#settings = settings;
    this.#log = log;
    this.#now = now ?? (() => Date.now());
    this.#unsubscribe = bus.subscribe((message) => this.#deliver(message));
  }

  /** How many streams this process holds, for one user or for everyone. */
  count(userId?: string): number {
    if (userId !== undefined) return this.#byUser.get(userId)?.length ?? 0;
    let total = 0;
    for (const streams of this.#byUser.values()) total += streams.length;
    return total;
  }

  /**
   * Opens a stream for the caller: the oldest of theirs ended while they hold the most the setting
   * allows. A missing or invalid setting throws before anything opens; after `endAll`, the stream
   * answered has already ended.
   */
  async open({ userId, sessionId, expiresAt, signal }: LiveOpening): Promise<AsyncIterable<LiveEvent>> {
    const max = await this.#settings.read(LIVE_MAX_CONNECTIONS_SETTING, liveMaxConnections);
    const stream = new LiveStream(userId, sessionId);
    if (this.#closed || signal?.aborted === true) {
      stream.end();
      return stream.events();
    }
    const streams = this.#byUser.get(userId) ?? [];
    while (streams.length >= max) {
      const oldest = streams[0];
      if (oldest === undefined) break;
      this.#endLogged(oldest, 'connection_cap');
    }
    this.#add(stream);
    this.#armExpiry(stream, expiresAt.getTime());
    if (signal !== undefined) {
      const left = () => this.#remove(stream, () => stream.end());
      signal.addEventListener('abort', left, { once: true });
      stream.onRelease(() => signal.removeEventListener('abort', left));
    }
    return stream.events();
  }

  /** The person's every stream sent `account` and ended (`account_restricted`, logged per stream). */
  endUser(userId: string): number {
    const streams = [...(this.#byUser.get(userId) ?? [])];
    for (const stream of streams) {
      this.#remove(stream, () => stream.closeAfter({ type: 'account' }));
      this.#log.info({ userId, reason: 'account_restricted' }, 'A live stream was ended by the server');
    }
    return streams.length;
  }

  /** One sign-in session's streams sent `account` and ended: a sign-out, not logged. */
  endSession(sessionId: string): number {
    let ended = 0;
    for (const streams of [...this.#byUser.values()]) {
      for (const stream of streams.filter((open) => open.sessionId === sessionId)) {
        this.#remove(stream, () => stream.closeAfter({ type: 'account' }));
        ended += 1;
      }
    }
    return ended;
  }

  /**
   * Shutdown: every stream ended now, and every later open ended at once; one line with the count.
   * Synchronous, so nothing is awaited before `application.close()`.
   */
  endAll(): number {
    this.#closed = true;
    let streamsEnded = 0;
    for (const streams of [...this.#byUser.values()]) {
      for (const stream of [...streams]) {
        this.#remove(stream, () => stream.end());
        streamsEnded += 1;
      }
    }
    this.#unsubscribe();
    this.#log.info({ streamsEnded }, 'Every live stream was ended for shutdown');
    return streamsEnded;
  }

  #deliver({ to, event, session }: LiveMessage): void {
    if (event.type === 'account') {
      for (const userId of to) {
        if (session === undefined) {
          this.endUser(userId);
        } else {
          for (const stream of [...(this.#byUser.get(userId) ?? [])]) {
            if (stream.sessionId !== session) continue;
            this.#remove(stream, () => stream.closeAfter(event));
          }
        }
      }
      return;
    }
    for (const userId of to) {
      for (const stream of [...(this.#byUser.get(userId) ?? [])]) {
        if (session !== undefined && stream.sessionId !== session) continue;
        if (!stream.push(event)) this.#endLogged(stream, 'queue_overflow');
      }
    }
  }

  #endLogged(stream: LiveStream, reason: Exclude<LiveEndReason, 'account_restricted'>): void {
    this.#remove(stream, () => stream.end());
    this.#log.info({ userId: stream.userId, reason }, 'A live stream was ended by the server');
  }

  #add(stream: LiveStream): void {
    const streams = this.#byUser.get(stream.userId);
    if (streams === undefined) this.#byUser.set(stream.userId, [stream]);
    else streams.push(stream);
    // However it ends, by the server or by its reader, it leaves the map.
    stream.onRelease(() => this.#forget(stream));
  }

  /** Takes `stream` out of the maps and ends it as `finish` says. */
  #remove(stream: LiveStream, finish: () => void): void {
    this.#forget(stream);
    finish();
  }

  #forget(stream: LiveStream): void {
    const streams = this.#byUser.get(stream.userId);
    if (streams === undefined) return;
    const index = streams.indexOf(stream);
    if (index >= 0) streams.splice(index, 1);
    if (streams.length === 0) this.#byUser.delete(stream.userId);
  }

  /** Ends `stream` quietly when its token expires; the timer is cleared if it ends first. */
  #armExpiry(stream: LiveStream, expiresAtMs: number): void {
    const delay = expiresAtMs - this.#now();
    if (delay <= 0) {
      this.#remove(stream, () => stream.end());
      return;
    }
    const timer = setTimeout(() => {
      if (!stream.open) return;
      if (delay > LONGEST_TIMER_MS) this.#armExpiry(stream, expiresAtMs);
      else this.#remove(stream, () => stream.end());
    }, Math.min(delay, LONGEST_TIMER_MS));
    stream.onRelease(() => clearTimeout(timer));
  }
}

/** Who opens a stream, as the user kind authenticated them. */
export interface LiveCaller {
  readonly userId: string;
  readonly sessionId: string;
  /** The access token's expiry; a session that does not say opens no stream. */
  readonly accessExpiresAt?: Date;
}

/** Where an event that does not parse is told, without its payload. */
export interface LiveServeLog {
  warn(fields: Readonly<Record<string, string>>, message: string): void;
}

/**
 * What `live.events` yields (T063): a stream opened in `registry` for `caller`, every event parsed
 * by `liveEvent` before it is sent, since tRPC parses no value a subscription yields; one that does
 * not parse is never sent, and its line carries nothing of it. No registry, or a session that does
 * not say when its token expires, is a wiring fault: the internal error, never a stream that could
 * outlive its token.
 */
export async function* serveLiveEvents(
  registry: LiveRegistry | null,
  caller: LiveCaller,
  signal: AbortSignal | undefined,
  log: LiveServeLog,
): AsyncGenerator<LiveEvent, void, undefined> {
  if (registry === null || caller.accessExpiresAt === undefined) {
    throw new Error('The live channel is not bound, or the session does not say when its token expires.');
  }
  const stream = await registry.open({
    userId: caller.userId,
    sessionId: caller.sessionId,
    expiresAt: caller.accessExpiresAt,
    ...(signal === undefined ? {} : { signal }),
  });
  for await (const event of stream) {
    const parsed = liveEvent.safeParse(event);
    if (parsed.success) yield parsed.data;
    else log.warn({ reason: 'invalid_event' }, 'A live event that does not parse was not sent');
  }
}
