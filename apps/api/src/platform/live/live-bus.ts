// T063 of specs/004-sessions: the live channel's bus (research R-324, item 10; contracts/kernel.md,
// "The live channel"). A producer's event, addressed to user ids its own transaction read, reaches
// every stream of those users that this process holds, through the registry that subscribes here.
//
// IN-PROCESS ONLY. Exact while the API is one process and every producer runs in it. A Redis bus
// between processes is Not scheduled, and is required before any of: a second API process, any
// worker event made live, payment confirmation made live. Forgotten, events from one process miss
// another's streams; screens still read on open, so the result is late, never wrong.
import type { LiveEvent } from '@ijazah/contracts';

/** One addressed event: to every stream of `to`, or only those of the sign-in session `session`. */
export interface LiveMessage {
  readonly to: readonly string[];
  readonly event: LiveEvent;
  /** A sign-out's `account` reaches that sign-in session's streams only (FR-429). */
  readonly session?: string;
}

export interface LiveBus {
  /** Hands `message` to every subscriber now; it never waits on a stream. */
  publish(message: LiveMessage): void;
  /** Hears every message published from now on; answers how to stop hearing them. */
  subscribe(listener: (message: LiveMessage) => void): () => void;
}

/** The bus within one process. */
export class InProcessLiveBus implements LiveBus {
  readonly #listeners = new Set<(message: LiveMessage) => void>();

  publish(message: LiveMessage): void {
    for (const listener of this.#listeners) listener(message);
  }

  subscribe(listener: (message: LiveMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
