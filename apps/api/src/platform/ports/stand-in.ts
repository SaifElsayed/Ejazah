// T122: what every stand-in shares (contracts/ports.md, "Stand-in behaviour"). A stand-in is not a
// stub that answers nothing: it records each operation it was asked to do, with its arguments, so a
// test can assert on it, and it can be told to fail an operation, so a failure path is exercised
// without a network. A stand-in extends `StandIn<Port>` and calls `attempt` first in each operation:
// the call is recorded, and a queued failure is handed back before anything changes.
//
// Records live in memory only and are never logged, because the arguments can carry a one-time code,
// a push token or payout details (R-SEC-2). The latest `MAX_RECORDED_CALLS` are kept, so a stand-in
// selected in a long-running development process does not grow without bound.

/** The most recent calls a stand-in keeps; older ones are dropped. */
export const MAX_RECORDED_CALLS = 1000;

/** One operation of the port `P`, with the arguments it was called with. */
export type StandInCall<P> = {
  [K in keyof P]: P[K] extends (...args: infer A) => unknown
    ? { readonly operation: K; readonly args: Readonly<A> }
    : never;
}[keyof P];

type ArgsOf<P, K extends keyof P> = P[K] extends (...args: infer A) => unknown ? A : never;

/** The failure a stand-in answers with when told to fail and given no error of its own. */
export class StandInFailure extends Error {
  constructor(operation: string) {
    super(`The stand-in was told to fail ${operation}.`);
    this.name = 'StandInFailure';
  }
}

export abstract class StandIn<P> {
  readonly #calls: StandInCall<P>[] = [];
  readonly #failures = new Map<keyof P, Error[]>();

  /** Every operation asked of this stand-in, oldest first. A copy. */
  get calls(): readonly StandInCall<P>[] {
    return [...this.#calls];
  }

  /** Fail the next call of `operation` with `error`; each instruction fails one call, in order. */
  failNext<K extends keyof P & string>(
    operation: K,
    error: Error = new StandInFailure(operation),
  ): void {
    this.#failures.set(operation, [...(this.#failures.get(operation) ?? []), error]);
  }

  /** Record the call, and answer the failure it was told to give, if any. */
  protected attempt<K extends keyof P>(operation: K, args: ArgsOf<P, K>): Error | undefined {
    this.#calls.push({ operation, args } as unknown as StandInCall<P>);
    if (this.#calls.length > MAX_RECORDED_CALLS) this.#calls.shift();
    const queued = this.#failures.get(operation);
    const failure = queued?.shift();
    if (queued?.length === 0) this.#failures.delete(operation);
    return failure;
  }
}
