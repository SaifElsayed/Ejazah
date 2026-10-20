// B9: single-use marks in memory, for the identity services' specs and nothing else: placed once,
// taken once, gone at their instant as Redis lets a key with `PXAT` lapse, on the spec's own clock.
import { assertInstant, type MarkKind, markKey, type SingleUseMarks } from './single-use-marks.js';

export class MemorySingleUseMarks implements SingleUseMarks {
  readonly #now: () => Date;
  readonly #marks = new Map<string, Date>();

  constructor(now: () => Date) {
    this.#now = now;
  }

  #live(key: string): boolean {
    const expiresAt = this.#marks.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.#now()) {
      this.#marks.delete(key);
      return false;
    }
    return true;
  }

  async place(kind: MarkKind, value: string, expiresAt: Date): Promise<boolean> {
    const key = markKey(kind, value);
    assertInstant(expiresAt);
    if (this.#live(key)) return false;
    this.#marks.set(key, expiresAt);
    return true;
  }

  async take(kind: MarkKind, value: string): Promise<boolean> {
    const key = markKey(kind, value);
    const live = this.#live(key);
    this.#marks.delete(key);
    return live;
  }

  async has(kind: MarkKind, value: string): Promise<boolean> {
    return this.#live(markKey(kind, value));
  }
}
