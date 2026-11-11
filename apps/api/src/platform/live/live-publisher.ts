// T063 of specs/004-sessions: the after-commit publisher (research R-324, item 5; contracts/kernel.md,
// "The live channel", `LivePublisher`; Saif's review of PR #126, round 1, follow-up 4).
//
// A REQUEST'S LIST. Each request's context carries its own `RequestLive`: a producer adds an event
// with `afterCommit(to, event)`, addressed to the user ids its own transaction read, and nothing is
// sent then. The caller kind that owns the request decides when the list goes out
// (`surfaces/procedures.ts`): the administrator kind flushes it once its transaction has committed
// and drops it on a rollback; the user kinds, which open no transaction (their services commit their
// own), flush it when the handler resolves and drop it when it throws. The three paths outside the
// kinds send after their own commit: the account deletion through `deletion.service.ts`' own
// after-commit work, the upload route after its transaction commits, and `POST /webhooks/video`
// (T065, `modules/sessions/video-webhook.controller.ts`) once its insert commits, straight through
// the bus for an event it recorded. The shape is `deletion.service.ts`'
// `#afterCommit`. A publish that fails loses a hint only: logged at warn without its payload, never
// retried (R-SEC-2: no event's payload, no token, in any log).
//
// A SERVICE THAT HAS ONLY THE TRANSACTION. The administrator kind binds its request's list to the
// transaction it opens (`bindToTransaction`), for as long as that transaction runs, so a service
// called on it reaches the list with the transaction it was handed (`publisherOn(tx)`), never through
// state of its own: identity's `StandingService` publishes a person's `account` this way. The
// binding is held weakly, by the transaction object, and removed when the transaction ends.
import type { LiveEvent } from '@ijazah/contracts';

import type { LiveBus, LiveMessage } from './live-bus.js';

/** What a producer is handed: an event to send once the request's work has committed. */
export interface LivePublisher {
  /**
   * Adds `event` for `to` to the request's after-commit list; `scope.session` narrows it to one
   * sign-in session's streams (a sign-out's `account`).
   */
  afterCommit(to: readonly string[], event: LiveEvent, scope?: { readonly session: string }): void;
}

/** Where a publish that failed is told: the event's type, never its payload. */
export interface LivePublishLog {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

/** One request's after-commit list, flushed or dropped by the caller kind that owns the request. */
export class RequestLive implements LivePublisher {
  readonly #bus: LiveBus;
  readonly #log: LivePublishLog;
  #pending: LiveMessage[] = [];

  constructor(bus: LiveBus, log: LivePublishLog) {
    this.#bus = bus;
    this.#log = log;
  }

  afterCommit(to: readonly string[], event: LiveEvent, scope?: { readonly session: string }): void {
    if (to.length === 0) return;
    this.#pending.push({
      to: [...to],
      event,
      ...(scope === undefined ? {} : { session: scope.session }),
    });
  }

  /** Sends every event the request added, once its work has committed; the list is then empty. */
  flush(): void {
    const pending = this.#pending;
    this.#pending = [];
    for (const message of pending) {
      try {
        this.#bus.publish(message);
      } catch (error: unknown) {
        this.#log.warn(
          {
            eventType: message.event.type,
            recipients: message.to.length,
            errorName: error instanceof Error ? error.name : 'unknown',
          },
          'A live event could not be published; it is not retried',
        );
      }
    }
  }

  /** Forgets every event the request added: its work rolled back or threw. */
  drop(): void {
    this.#pending = [];
  }
}

const bound = new WeakMap<object, LivePublisher>();

/**
 * Binds `publisher`, the request's list, to the transaction `tx` the caller kind opened, until the
 * returned function is called when that transaction ends.
 */
export function bindToTransaction(tx: unknown, publisher: LivePublisher): () => void {
  // A transaction is an object; a spec's stand-in that is not one binds nothing.
  if (!isBindable(tx)) return () => undefined;
  bound.set(tx, publisher);
  return () => {
    bound.delete(tx);
  };
}

/** The request's list bound to `tx`, or undefined for a transaction no caller kind bound. */
export function publisherOn(tx: unknown): LivePublisher | undefined {
  return isBindable(tx) ? bound.get(tx) : undefined;
}

function isBindable(tx: unknown): tx is object {
  return (typeof tx === 'object' && tx !== null) || typeof tx === 'function';
}
