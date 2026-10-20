// B9 (T047, owner's decision 2026-10-20): the one Redis operation the identity module needs, a mark
// that can be placed once and taken once (research R-102, R-103), living until an instant (a
// nonce's or a token's own expiry). Over a scripted client: what the marks ask of Redis, not Redis;
// and the in-memory marks the services' specs run over.
import { describe, expect, it, vi } from 'vitest';

import { MemorySingleUseMarks } from './single-use-marks.fixtures.js';
import { type MarkCommands, RedisSingleUseMarks } from './single-use-marks.js';

const AT = new Date('2026-10-20T08:10:00Z');

function scripted(set: string | null, del: number) {
  const commands = {
    set: vi.fn(async () => set),
    del: vi.fn(async () => del),
    exists: vi.fn(async () => del),
  };
  return { commands, marks: new RedisSingleUseMarks(commands as unknown as MarkCommands) };
}

describe('RedisSingleUseMarks', () => {
  it('places a mark only where none is, until its instant, under the platform prefix', async () => {
    const { commands, marks } = scripted('OK', 0);
    await expect(marks.place('onboarding', 'abc', AT)).resolves.toBe(true);
    expect(commands.set).toHaveBeenCalledWith(
      'ijazah:mark:onboarding:abc',
      '1',
      'PXAT',
      AT.getTime(),
      'NX',
    );
  });

  it('answers false when the mark is already there', async () => {
    const { marks } = scripted(null, 0);
    await expect(marks.place('onboarding', 'abc', AT)).resolves.toBe(false);
  });

  it('takes a mark once: true when it was there, false when it was not', async () => {
    await expect(scripted(null, 1).marks.take('provider-nonce', 'n')).resolves.toBe(true);
    const { commands, marks } = scripted(null, 0);
    await expect(marks.take('provider-nonce', 'n')).resolves.toBe(false);
    expect(commands.del).toHaveBeenCalledWith('ijazah:mark:provider-nonce:n');
  });

  it('tells whether a mark is there, without taking it', async () => {
    const { commands, marks } = scripted(null, 1);
    await expect(marks.has('onboarding', 'j')).resolves.toBe(true);
    expect(commands.exists).toHaveBeenCalledWith('ijazah:mark:onboarding:j');
    expect(commands.del).not.toHaveBeenCalled();
    await expect(scripted(null, 0).marks.has('onboarding', 'j')).resolves.toBe(false);
  });

  it('refuses an instant that is not one', async () => {
    const { commands, marks } = scripted('OK', 0);
    await expect(marks.place('onboarding', 'abc', new Date('not a date'))).rejects.toThrow(
      RangeError,
    );
    expect(commands.set).not.toHaveBeenCalled();
  });

  it('refuses an empty or a separator-carrying value, so two kinds never share a key', async () => {
    const { marks } = scripted('OK', 1);
    await expect(marks.place('onboarding', '', AT)).rejects.toThrow(TypeError);
    await expect(marks.take('onboarding', 'a:b')).rejects.toThrow(TypeError);
  });
});

describe('MemorySingleUseMarks (the services’ specs)', () => {
  it('behaves as Redis does: once placed, once taken, gone at its instant', async () => {
    let now = new Date('2026-10-20T08:00:00Z');
    const marks = new MemorySingleUseMarks(() => now);
    expect(await marks.place('onboarding', 'j', AT)).toBe(true);
    expect(await marks.place('onboarding', 'j', AT)).toBe(false);
    expect(await marks.has('onboarding', 'j')).toBe(true);
    expect(await marks.take('onboarding', 'j')).toBe(true);
    expect(await marks.take('onboarding', 'j')).toBe(false);
    expect(await marks.place('provider-nonce', 'n', AT)).toBe(true);
    now = AT;
    expect(await marks.has('provider-nonce', 'n')).toBe(false);
    expect(await marks.take('provider-nonce', 'n')).toBe(false);
  });
});
