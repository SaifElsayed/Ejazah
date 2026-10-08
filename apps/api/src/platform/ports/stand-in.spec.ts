// T122: what every stand-in shares (contracts/ports.md, "Stand-in behaviour"). A stand-in records
// each operation it was asked to do, with its arguments, so a test can assert on it; and it can be
// told to fail an operation, so a failure path is exercised without a network.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { MAX_RECORDED_CALLS, StandIn, StandInFailure, type StandInCall } from './stand-in.js';

interface Greeter {
  greet(name: string): Promise<string>;
  wave(times: number, loudly: boolean): Promise<void>;
}

class FakeGreeter extends StandIn<Greeter> implements Greeter {
  greet(name: string): Promise<string> {
    const failure = this.attempt('greet', [name]);
    return failure === undefined ? Promise.resolve(`hello ${name}`) : Promise.reject(failure);
  }

  wave(times: number, loudly: boolean): Promise<void> {
    const failure = this.attempt('wave', [times, loudly]);
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }
}

describe('a stand-in records what it was asked (T122)', () => {
  it('types each record as an operation of the port with that operation’s arguments', () => {
    expectTypeOf<StandInCall<Greeter>>().toEqualTypeOf<
      | { readonly operation: 'greet'; readonly args: readonly [name: string] }
      | { readonly operation: 'wave'; readonly args: readonly [times: number, loudly: boolean] }
    >();
  });

  it('records every call in order, with its arguments', async () => {
    const greeter = new FakeGreeter();
    await greeter.greet('Amr');
    await greeter.wave(2, true);

    expect(greeter.calls).toEqual([
      { operation: 'greet', args: ['Amr'] },
      { operation: 'wave', args: [2, true] },
    ]);
  });

  it('hands out a copy, so a test cannot rewrite what was recorded', async () => {
    const greeter = new FakeGreeter();
    await greeter.greet('Amr');
    (greeter.calls as unknown[]).pop();

    expect(greeter.calls).toHaveLength(1);
  });

  it(`keeps the latest ${MAX_RECORDED_CALLS} calls, so a long-running process does not grow without bound`, async () => {
    const greeter = new FakeGreeter();
    for (let index = 0; index <= MAX_RECORDED_CALLS; index += 1) await greeter.wave(index, false);

    expect(greeter.calls).toHaveLength(MAX_RECORDED_CALLS);
    expect(greeter.calls[0]).toEqual({ operation: 'wave', args: [1, false] });
  });
});

describe('a stand-in fails when told to (T122)', () => {
  it('fails the next call of the operation named, and records it', async () => {
    const greeter = new FakeGreeter();
    greeter.failNext('greet');

    await expect(greeter.greet('Amr')).rejects.toThrow(StandInFailure);
    expect(greeter.calls).toEqual([{ operation: 'greet', args: ['Amr'] }]);
  });

  it('fails once per instruction, then answers again; another operation is untouched', async () => {
    const greeter = new FakeGreeter();
    greeter.failNext('greet');

    await expect(greeter.wave(1, false)).resolves.toBeUndefined();
    await expect(greeter.greet('Amr')).rejects.toThrow(StandInFailure);
    await expect(greeter.greet('Amr')).resolves.toBe('hello Amr');
  });

  it('fails with the error it is given, in the order given', async () => {
    const greeter = new FakeGreeter();
    const timeout = new Error('provider timed out');
    greeter.failNext('greet', timeout);
    greeter.failNext('greet');

    await expect(greeter.greet('a')).rejects.toBe(timeout);
    await expect(greeter.greet('b')).rejects.toThrow(StandInFailure);
    await expect(greeter.greet('c')).resolves.toBe('hello c');
  });

  it('names the operation in its own failure, and nothing of the arguments', async () => {
    const greeter = new FakeGreeter();
    greeter.failNext('greet');

    const refusal = greeter.greet('secret-name');

    await expect(refusal).rejects.toThrow('greet');
    await expect(refusal).rejects.not.toThrow('secret-name');
  });
});
