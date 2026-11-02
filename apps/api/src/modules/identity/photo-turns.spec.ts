// T073 — the photos route's turns (PR #117's review, round 1, Minor 1; the owner's decision of
// 2026-11-02): at most `atOnce` photos are processed together in a process, a request waiting its
// turn is served in the order it came, and one that waits past `waitMs` is refused with 429
// `RATE_LIMITED` and never takes a turn later. A turn is given back on every path: the work's
// answer, its refusal (a `DomainError`), a thrown error, a synchronous throw.
//
// The works here are promises the spec settles by hand, so "at once" and "in order" are read
// exactly, never from timing; the wait runs on Vitest's fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../platform/errors/domain-error.js';
import { PhotoTurns } from './photo-turns.js';

const WAIT_MS = 1000;

/** A work the spec settles by hand, recording when it started. */
interface HeldWork {
  readonly started: () => boolean;
  readonly finish: () => void;
  readonly fail: (error: unknown) => void;
  readonly work: () => Promise<string>;
}

function held(name: string, log: string[]): HeldWork {
  let started = false;
  let finish: () => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const settled = new Promise<string>((resolve, reject) => {
    finish = () => resolve(name);
    fail = reject;
  });
  return {
    started: () => started,
    finish: () => finish(),
    fail: (error) => fail(error),
    work: () => {
      started = true;
      log.push(name);
      return settled;
    },
  };
}

/** Lets every settled promise run its continuations. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PhotoTurns (T073)', () => {
  it('never processes more than one photo together, and serves the waiting in order', async () => {
    const turns = new PhotoTurns({ atOnce: 1, waitMs: WAIT_MS });
    const log: string[] = [];
    const works = ['a', 'b', 'c', 'd', 'e'].map((name) => held(name, log));
    const answers = works.map(({ work }) => turns.take(work));
    await flush();
    expect(log).toEqual(['a']);

    for (const [index, current] of works.entries()) {
      expect(works.filter(({ started }) => started()).length).toBe(index + 1);
      current.finish();
      await flush();
    }
    expect(log).toEqual(['a', 'b', 'c', 'd', 'e']);
    await expect(Promise.all(answers)).resolves.toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('processes up to its number together when it is more than one', async () => {
    const turns = new PhotoTurns({ atOnce: 2, waitMs: WAIT_MS });
    const log: string[] = [];
    const works = ['a', 'b', 'c'].map((name) => held(name, log));
    for (const { work } of works) void turns.take(work);
    await flush();
    expect(log).toEqual(['a', 'b']);
    works[1]?.finish();
    await flush();
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('refuses a request that waits past the set time with RATE_LIMITED, and never runs it later', async () => {
    const turns = new PhotoTurns({ atOnce: 1, waitMs: WAIT_MS });
    const log: string[] = [];
    const first = held('first', log);
    const late = held('late', log);
    void turns.take(first.work);
    const waiting = turns.take(late.work);
    const refusal = expect(waiting).rejects.toSatisfy(
      (error: unknown) => error instanceof DomainError && error.code === 'RATE_LIMITED',
    );

    await vi.advanceTimersByTimeAsync(WAIT_MS - 1);
    expect(late.started()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await refusal;

    first.finish();
    await flush();
    expect(late.started()).toBe(false);
    expect(log).toEqual(['first']);
  });

  it('gives the turn to the next still waiting, passing over one that timed out', async () => {
    const turns = new PhotoTurns({ atOnce: 1, waitMs: WAIT_MS });
    const log: string[] = [];
    const first = held('first', log);
    const early = held('early', log);
    const later = held('later', log);
    void turns.take(first.work);
    const timedOut = turns.take(early.work).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
    const served = turns.take(later.work);
    await vi.advanceTimersByTimeAsync(WAIT_MS / 2);
    expect(await timedOut).toBeInstanceOf(DomainError);

    first.finish();
    await flush();
    expect(log).toEqual(['first', 'later']);
    later.finish();
    await expect(served).resolves.toBe('later');
  });

  it('does not let a newcomer go before the waiting when a turn is given back', async () => {
    const turns = new PhotoTurns({ atOnce: 1, waitMs: WAIT_MS });
    const log: string[] = [];
    const first = held('first', log);
    const waiting = held('waiting', log);
    const newcomer = held('newcomer', log);
    void turns.take(first.work);
    void turns.take(waiting.work);
    await flush();

    first.finish();
    void turns.take(newcomer.work);
    await flush();
    expect(log).toEqual(['first', 'waiting']);
    waiting.finish();
    await flush();
    expect(log).toEqual(['first', 'waiting', 'newcomer']);
  });

  it('gives the turn back when the work is refused, throws, or throws before its promise', async () => {
    const turns = new PhotoTurns({ atOnce: 1, waitMs: WAIT_MS });
    const log: string[] = [];

    const refused = held('refused', log);
    const refusedAnswer = turns.take(refused.work);
    refused.fail(new DomainError('VALIDATION_FAILED', 'The image cannot be read.'));
    await expect(refusedAnswer).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const broken = held('broken', log);
    const brokenAnswer = turns.take(broken.work);
    broken.fail(new Error('libvips failed'));
    await expect(brokenAnswer).rejects.toThrow('libvips failed');

    await expect(
      turns.take(() => {
        throw new Error('thrown before a promise');
      }),
    ).rejects.toThrow('thrown before a promise');

    // Each of the three gave its turn back: the next is served at once, with no wait.
    const after = held('after', log);
    const afterAnswer = turns.take(after.work);
    await flush();
    expect(after.started()).toBe(true);
    after.finish();
    await expect(afterAnswer).resolves.toBe('after');
  });

  it('gives the turn back after a success, so the next is served at once', async () => {
    const turns = new PhotoTurns({ atOnce: 1, waitMs: WAIT_MS });
    await expect(turns.take(async () => 'one')).resolves.toBe('one');
    await expect(turns.take(async () => 'two')).resolves.toBe('two');
  });
});
