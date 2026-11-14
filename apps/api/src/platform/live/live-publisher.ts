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
// HOW A PRODUCER REACHES THE LIST (T066; the owner's decision of 2026-11-11, Q3 (a)). A user kind's
// service is handed the request's list by its router (`ctx.live`) and adds its events inside its
// own transaction, a keyed one inside the keyed effect, so a replay, which runs no effect, adds
// none. An upload's handler is handed the upload's list (`AcceptedUpload.live`).
//
// A SERVICE THAT HAS ONLY THE TRANSACTION. The administrator kind binds its request's list to the
// transaction it opens (`bindToTransaction`), for as long as that transaction runs, so a service
// called on it reaches the list with the transaction it was handed (`publisherOn(tx)`), never through
// state of its own: identity's `StandingService` publishes a person's `account` this way. The
// deletion binds its own transaction to its own list the same way (T066), so booking's subscriber
// reaches the list of every account's end through the transaction. The binding is held weakly, by
// the transaction object, and removed when the transaction ends.
//
// WORK AFTER THE COMMIT (T081 of specs/004-sessions; the note under T081, Q-O2 (a); tasks.md's
// Not-scheduled item (13)'s `afterCommitDo`). A request's list also takes work: `afterCommitDo(action)`
// queues a function the list runs when it is flushed, after its events, and forgets when it is
// dropped, so the work runs only once the caller kind's transaction has committed, never after a
// rollback, and never twice. Each action's failure is caught and reported (the error tracker), and
// the next one still runs. A service handed only the administrator kind's transaction reaches it
// through `publisherOn(tx)`: an administrator's deletion (`users.delete`) queues its own work after
// the commit there. A spec's stand-in publisher may lack it, so it is optional on `LivePublisher`.
import type { LiveEvent } from '@ijazah/contracts';

import { reportError } from '../errors/reporting.js';
import type { LiveBus, LiveMessage } from './live-bus.js';

/** What a producer is handed: an event to send once the request's work has committed. */
export interface LivePublisher {
  /**
   * Adds `event` for `to` to the request's after-commit list; `scope.session` narrows it to one
   * sign-in session's streams (a sign-out's `account`).
   */
  afterCommit(to: readonly string[], event: LiveEvent, scope?: { readonly session: string }): void;
  /**
   * T081: queues `action`, run once the request's work has committed, after its events; dropped on
   * a rollback. The request's own list (`RequestLive`) has it; a spec's stand-in may not.
   */
  afterCommitDo?(action: () => void): void;
}

/** Where a publish that failed is told: the event's type, never its payload. */
export interface LivePublishLog {
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

/**
 * The bus of a context, a route or a deletion built without the process's channel: what it is
 * handed goes nowhere (nit 8 of PR #130's review: one, shared).
 */
export const unboundBus: LiveBus = {
  publish: () => undefined,
  subscribe: () => () => undefined,
};

/** One request's after-commit list, flushed or dropped by the caller kind that owns the request. */
export class RequestLive implements LivePublisher {
  readonly #bus: Pick<LiveBus, 'publish'>;
  readonly #log: LivePublishLog;
  readonly #report: (error: unknown) => void;
  #pending: LiveMessage[] = [];
  /** T081: the work queued after the commit, run after the events. */
  #actions: (() => void)[] = [];

  constructor(
    bus: Pick<LiveBus, 'publish'>,
    log: LivePublishLog,
    report: (error: unknown) => void = reportError,
  ) {
    this.#bus = bus;
    this.#log = log;
    this.#report = report;
  }

  afterCommit(to: readonly string[], event: LiveEvent, scope?: { readonly session: string }): void {
    if (to.length === 0) return;
    this.#pending.push({
      to: [...to],
      event,
      ...(scope === undefined ? {} : { session: scope.session }),
    });
  }

  /** T081: queues `action` for the flush, after the events; a drop forgets it. */
  afterCommitDo(action: () => void): void {
    this.#actions.push(action);
  }

  /**
   * Sends every event the request added, once its work has committed, then runs the work it queued
   * (T081), each failure reported; the list is then empty.
   */
  flush(): void {
    const pending = this.#pending;
    const actions = this.#actions;
    this.#pending = [];
    this.#actions = [];
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
    for (const action of actions) {
      try {
        action();
      } catch (error: unknown) {
        this.#report(error);
      }
    }
  }

  /** Forgets every event and every action the request added: its work rolled back or threw. */
  drop(): void {
    this.#pending = [];
    this.#actions = [];
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
