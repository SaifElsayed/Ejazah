// T073: the photos route's turns (PR #117's review, round 1, Minor 1; the owner's decision of
// 2026-11-02). Decoding a photo at `PHOTO_MAX_INPUT_PIXELS` holds up to about 551 MB, so the route
// processes at most `atOnce` photos together in a process (`PHOTOS_PROCESSED_AT_ONCE`, one). A
// request that finds no free turn waits in line and is served in the order it came; one still
// waiting after `waitMs` is refused with 429 `RATE_LIMITED` ("try again later") and leaves the
// line, so it never takes a turn later. A turn is given back however the work ends.
//
// Beside the controller, not in the kernel: the photos route is the only one that decodes what it
// receives (the documents route stores its PDF as sent). One instance per route, which the process
// builds once; nothing here is per request or per user, and the line holds only requests in flight.
import { DomainError } from '../../platform/errors/domain-error.js';

export interface PhotoTurnsOptions {
  /** The most photos processed together. */
  readonly atOnce: number;
  /** How long a request may wait for its turn before it is refused. */
  readonly waitMs: number;
}

interface Waiter {
  readonly admit: () => void;
  readonly timer: NodeJS.Timeout;
}

function busy(): DomainError {
  return new DomainError('RATE_LIMITED', 'Too many photos are being processed. Try again shortly.');
}

export class PhotoTurns {
  private running = 0;
  private readonly line: Waiter[] = [];

  constructor(private readonly options: PhotoTurnsOptions) {}

  /** Runs `work` in a turn, after those already waiting; refused if no turn comes within the wait. */
  async take<T>(work: () => Promise<T>): Promise<T> {
    await this.turn();
    try {
      return await work();
    } finally {
      this.giveBack();
    }
  }

  private turn(): Promise<void> {
    if (this.running < this.options.atOnce && this.line.length === 0) {
      this.running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        admit: resolve,
        timer: setTimeout(() => {
          this.line.splice(this.line.indexOf(waiter), 1);
          reject(busy());
        }, this.options.waitMs),
      };
      this.line.push(waiter);
    });
  }

  /** The turn goes straight to the first in line, so a newcomer cannot pass the waiting. */
  private giveBack(): void {
    const next = this.line.shift();
    if (next === undefined) {
      this.running -= 1;
      return;
    }
    clearTimeout(next.timer);
    next.admit();
  }
}
