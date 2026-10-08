// T120: the messaging port and its stand-in (contracts/ports.md). One operation; the stand-in
// checks what it is handed and writes nothing anywhere, so a one-time code sent through it never
// reaches a log (R-SEC-2). It records each message in memory, so a test can read the code it carried,
// and fails a send when told (T122).
//
// The type check is enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { StandInFailure } from '../stand-in.js';
import { FakeSmsAdapter } from './fake.adapter.js';
import type { SmsPort } from './sms.port.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the messaging port (T120)', () => {
  it('has one operation: send a message to a destination', () => {
    expectTypeOf<keyof SmsPort>().toEqualTypeOf<'send'>();
    expectTypeOf<SmsPort['send']>().toEqualTypeOf<
      (destination: string, text: string) => Promise<void>
    >();
  });
});

describe('the messaging stand-in (T120)', () => {
  it('accepts a destination in international form and a text', async () => {
    await expect(
      new FakeSmsAdapter().send('+201000000000', 'Your code is 482913'),
    ).resolves.toBeUndefined();
  });

  it.each(['01000000000', '+0201000000000', '+20 100 000 0000', '+2', ''])(
    'refuses the destination %j, which is not in international form',
    async (destination) => {
      await expect(new FakeSmsAdapter().send(destination, 'text')).rejects.toThrow(RangeError);
    },
  );

  it('refuses an empty text', async () => {
    await expect(new FakeSmsAdapter().send('+201000000000', '')).rejects.toThrow(RangeError);
  });

  it('writes nothing to the console or the process streams, so a code never reaches a log', async () => {
    const writes = [
      vi.spyOn(process.stdout, 'write'),
      vi.spyOn(process.stderr, 'write'),
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method),
      ),
    ];

    await new FakeSmsAdapter().send('+201000000000', 'Your code is 482913');

    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });
});

describe('the messaging stand-in: records and induced failure (T122)', () => {
  it('records each message it was asked to send, so a test can read the code it carried', async () => {
    const sms = new FakeSmsAdapter();
    await sms.send('+201000000000', 'Your code is 482913');

    expect(sms.calls).toEqual([
      { operation: 'send', args: ['+201000000000', 'Your code is 482913'] },
    ]);
  });

  it('fails a send when told, then sends again', async () => {
    const sms = new FakeSmsAdapter();
    sms.failNext('send');

    await expect(sms.send('+201000000000', 'Your code is 482913')).rejects.toThrow(StandInFailure);
    await expect(sms.send('+201000000000', 'Your code is 482913')).resolves.toBeUndefined();
  });

  it('records a refused message too, and writes neither anywhere', async () => {
    const write = vi.spyOn(process.stdout, 'write');
    const sms = new FakeSmsAdapter();

    await expect(sms.send('01000000000', 'Your code is 482913')).rejects.toThrow(RangeError);

    expect(sms.calls).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
  });
});
