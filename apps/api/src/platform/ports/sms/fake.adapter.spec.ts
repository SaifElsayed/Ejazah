// T120: the messaging port and its stand-in (contracts/ports.md). One operation; the stand-in
// checks what it is handed and writes nothing anywhere, so a one-time code sent through it never
// reaches a log (R-SEC-2). Recording calls and induced failure are T122's.
//
// The type check is enforced by `pnpm typecheck` (CI stage 1), not by vitest.
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
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
