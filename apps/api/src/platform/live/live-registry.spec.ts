// T063 of specs/004-sessions — the live channel's registry, bus and publisher (FR-427 to FR-429;
// research R-324; contracts/kernel.md, "The live channel").
//
// The registry is driven directly, over the in-process bus and a fake settings reader, as the live
// router drives it: each case opens streams, publishes on the bus, and reads what each stream
// yields. The lines a stream the server ends by itself writes are read back field for field: one
// `{ userId, reason }` line, `connection_cap`, `queue_overflow` or `account_restricted`; none for a
// token's expiry or a sign-out; shutdown's one `{ streamsEnded }`.
import type { LiveEvent } from '@ijazah/contracts';
import { addHours, addMinutes } from '@ijazah/time';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { SettingError, type SettingsReader } from '../settings/settings-reader.js';
import { InProcessLiveBus } from './live-bus.js';
import { LIVE_STREAM_QUEUE_BOUND } from './live-constants.js';
import { bindToTransaction, publisherOn, RequestLive } from './live-publisher.js';
import { LiveRegistry } from './live-registry.js';

const A = '0199d0a0-0000-7000-8000-00000000aaa1';
const B = '0199d0a0-0000-7000-8000-00000000bbb1';
const SESSION = '0199d0a0-0000-7000-8000-00000000c5e1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e1e1';
const signal: LiveEvent = { type: 'session', sessionId: SESSION, enrollmentId: ENROLLMENT };

type Line = readonly [Readonly<Record<string, unknown>>, string];

function fixture(rows: Readonly<Record<string, unknown>> = { live_channel_max_connections_per_user: 3 }) {
  const lines: Line[] = [];
  const settings: SettingsReader = {
    read: async <T>(key: string, schema: z.ZodType<T>): Promise<T> => {
      if (!(key in rows)) throw new SettingError(key, 'missing');
      const parsed = schema.safeParse(rows[key]);
      if (!parsed.success) throw new SettingError(key, 'invalid');
      return parsed.data;
    },
  };
  const bus = new InProcessLiveBus();
  const clock = { now: Date.parse('2026-11-08T10:00:00Z') };
  const registry = new LiveRegistry({
    bus,
    settings,
    log: { info: (fields, message) => void lines.push([{ ...fields }, message]) },
    now: () => clock.now,
  });
  const inAnHour = new Date(addHours(new Date(clock.now), 1));
  const open = (userId: string, sessionId = `${userId}-s1`, extra: { signal?: AbortSignal } = {}) =>
    registry.open({ userId, sessionId, expiresAt: inAnHour, ...extra });
  return { lines, bus, registry, open, clock };
}

/** Reads a stream as tRPC does, one event at a time. */
function readerOf(stream: AsyncIterable<LiveEvent>) {
  return stream[Symbol.asyncIterator]();
}

/** What a stream yields until it ends, when it has ended (or ends without waiting). */
async function drained(stream: AsyncIterable<LiveEvent>): Promise<LiveEvent[]> {
  const events: LiveEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** Whether the reader's next read is still waiting after the queue has been flushed. */
async function stillOpen(next: Promise<IteratorResult<LiveEvent>>): Promise<boolean> {
  const pending = Symbol('pending');
  const raced = await Promise.race([next, new Promise((resolve) => setImmediate(() => resolve(pending)))]);
  return raced === pending;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the live registry (T063, FR-427, FR-428)', () => {
  it('sends an event addressed to A to A’s streams only, never to B’s', async () => {
    const f = fixture();
    const a1 = readerOf(await f.open(A, 'a-1'));
    const a2 = readerOf(await f.open(A, 'a-2'));
    const b = readerOf(await f.open(B));

    f.bus.publish({ to: [A], event: signal });

    expect(await a1.next()).toEqual({ done: false, value: signal });
    expect(await a2.next()).toEqual({ done: false, value: signal });
    expect(await stillOpen(b.next())).toBe(true);
  });

  it('ends the oldest of a user’s streams when one more opens past the setting, with one line', async () => {
    const f = fixture();
    const oldest = await f.open(A, 'a-1');
    await f.open(A, 'a-2');
    await f.open(A, 'a-3');

    await f.open(A, 'a-4');

    expect(await drained(oldest)).toEqual([]);
    expect(f.registry.count(A)).toBe(3);
    expect(f.lines).toEqual([[{ userId: A, reason: 'connection_cap' }, expect.any(String)]]);
  });

  it('reads the cap at each open, and refuses the open when its row is missing or invalid', async () => {
    const rows: Record<string, unknown> = { live_channel_max_connections_per_user: 1 };
    const f = fixture(rows);
    const first = await f.open(A, 'a-1');
    rows['live_channel_max_connections_per_user'] = 2;
    await f.open(A, 'a-2');
    expect(f.registry.count(A)).toBe(2);
    expect(await stillOpen(readerOf(first).next())).toBe(true);

    delete rows['live_channel_max_connections_per_user'];
    await expect(f.open(A, 'a-3')).rejects.toBeInstanceOf(SettingError);
    rows['live_channel_max_connections_per_user'] = 0;
    await expect(f.open(A, 'a-3')).rejects.toBeInstanceOf(SettingError);
    expect(f.registry.count(A)).toBe(2);
  });

  it('ends a stream whose queue overflows, with one line, and keeps the others', async () => {
    const f = fixture();
    const slow = await f.open(A, 'a-1');
    const other = readerOf(await f.open(B));

    for (let sent = 0; sent <= LIVE_STREAM_QUEUE_BOUND; sent += 1) {
      f.bus.publish({ to: [A, B], event: signal });
      await other.next();
    }

    expect(await drained(slow)).toEqual([]);
    expect(f.registry.count(A)).toBe(0);
    expect(f.registry.count(B)).toBe(1);
    expect(f.lines).toEqual([[{ userId: A, reason: 'queue_overflow' }, expect.any(String)]]);
  });

  it('sends `account` to the person’s every stream and then ends them, one account_restricted line each', async () => {
    const f = fixture();
    const a1 = await f.open(A, 'a-1');
    const a2 = await f.open(A, 'a-2');
    const b = readerOf(await f.open(B));

    f.bus.publish({ to: [A], event: { type: 'account' } });

    expect(await drained(a1)).toEqual([{ type: 'account' }]);
    expect(await drained(a2)).toEqual([{ type: 'account' }]);
    expect(f.registry.count(A)).toBe(0);
    expect(await stillOpen(b.next())).toBe(true);
    expect(f.lines).toEqual([
      [{ userId: A, reason: 'account_restricted' }, expect.any(String)],
      [{ userId: A, reason: 'account_restricted' }, expect.any(String)],
    ]);
  });

  it('a sign-out’s `account` ends that sign-in session’s streams only, writing no line', async () => {
    const f = fixture();
    const signedOut = await f.open(A, 'a-phone');
    const other = readerOf(await f.open(A, 'a-tablet'));

    f.bus.publish({ to: [A], event: { type: 'account' }, session: 'a-phone' });

    expect(await drained(signedOut)).toEqual([{ type: 'account' }]);
    expect(f.registry.count(A)).toBe(1);
    expect(await stillOpen(other.next())).toBe(true);
    expect(f.lines).toEqual([]);
  });

  it('ends a stream when the access token it opened with expires, writing no line', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fixture();
    const stream = await f.registry.open({
      userId: A,
      sessionId: 'a-1',
      expiresAt: new Date(addMinutes(new Date(f.clock.now), 15)),
    });
    const next = readerOf(stream).next();

    await vi.advanceTimersByTimeAsync(15 * 60_000 - 1);
    expect(f.registry.count(A)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await next).toEqual({ done: true, value: undefined });
    expect(f.registry.count(A)).toBe(0);
    expect(f.lines).toEqual([]);
  });

  it('ends a stream whose client went away, and keeps nothing of it: no timer, no listener', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = fixture();
    const leaving = new AbortController();
    const stream = await f.open(A, 'a-1', { signal: leaving.signal });
    const next = readerOf(stream).next();
    expect(vi.getTimerCount()).toBe(1);

    leaving.abort();

    expect(await next).toEqual({ done: true, value: undefined });
    expect(f.registry.count()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.lines).toEqual([]);
  });

  it('shutdown ends every stream at once, writes one line with the count, and ends every later open', async () => {
    const f = fixture();
    const streams = [await f.open(A, 'a-1'), await f.open(A, 'a-2'), await f.open(B)];
    const reads = streams.map((stream) => readerOf(stream).next());

    expect(f.registry.endAll()).toBe(3);

    expect(await Promise.all(reads)).toEqual(
      Array.from({ length: 3 }, () => ({ done: true, value: undefined })),
    );
    expect(f.lines).toEqual([[{ streamsEnded: 3 }, expect.any(String)]]);
    expect(await drained(await f.open(A, 'a-3'))).toEqual([]);
    expect(f.registry.count()).toBe(0);
  });

  it('writes no event payload and no token in any line', async () => {
    const f = fixture({ live_channel_max_connections_per_user: 1 });
    await f.open(A, 'a-1');
    await f.open(A, 'a-2');
    f.bus.publish({ to: [A], event: signal });
    f.bus.publish({ to: [A], event: { type: 'account' } });
    f.registry.endAll();

    const written = JSON.stringify(f.lines);
    expect(written).not.toContain(SESSION);
    expect(written).not.toContain(ENROLLMENT);
    for (const [fields] of f.lines) {
      expect(Object.keys(fields).every((key) => ['userId', 'reason', 'streamsEnded'].includes(key))).toBe(
        true,
      );
    }
  });
});

describe('the after-commit publisher (T063, R-324 item 5)', () => {
  function published() {
    const bus = new InProcessLiveBus();
    const sent: unknown[] = [];
    bus.subscribe((message) => void sent.push(message));
    const warnings: Line[] = [];
    const live = new RequestLive(bus, { warn: (fields, message) => void warnings.push([fields, message]) });
    return { bus, sent, warnings, live };
  }

  it('sends nothing until it is flushed, then each event once', () => {
    const { sent, live } = published();
    live.afterCommit([A, B], signal);
    expect(sent).toEqual([]);

    live.flush();
    live.flush();
    expect(sent).toEqual([{ to: [A, B], event: signal }]);
  });

  it('sends nothing at all once dropped, as a rollback asks', () => {
    const { sent, live } = published();
    live.afterCommit([A], signal);
    live.drop();
    live.flush();
    expect(sent).toEqual([]);
  });

  it('carries a sign-out’s session scope', () => {
    const { sent, live } = published();
    live.afterCommit([A], { type: 'account' }, { session: 'a-1' });
    live.flush();
    expect(sent).toEqual([{ to: [A], event: { type: 'account' }, session: 'a-1' }]);
  });

  it('logs a publish that failed at warn without its payload, never retries it, and sends the rest', () => {
    const { bus, sent, warnings, live } = published();
    let refused = 0;
    bus.subscribe(() => {
      refused += 1;
      if (refused === 1) throw new Error(`the subscriber choked on ${SESSION}`);
    });
    live.afterCommit([A], signal);
    live.afterCommit([B], { type: 'enrollment', enrollmentId: ENROLLMENT });
    live.flush();

    expect(sent).toHaveLength(2);
    expect(warnings).toEqual([
      [{ eventType: 'session', recipients: 1, errorName: 'Error' }, expect.any(String)],
    ]);
    expect(JSON.stringify(warnings)).not.toContain(SESSION);
    live.flush();
    expect(refused).toBe(2);
  });

  it('is reached through the transaction the kind bound it to, and only while it is bound', () => {
    const { live } = published();
    const tx = {};
    expect(publisherOn(tx)).toBeUndefined();
    const unbind = bindToTransaction(tx, live);
    expect(publisherOn(tx)).toBe(live);
    expect(publisherOn({})).toBeUndefined();
    unbind();
    expect(publisherOn(tx)).toBeUndefined();
  });
});

// Nit 8 of PR #130's review, round 1 (B40a; the owner's decision of 2026-11-11, Q1 (a)): a
// sign-out reaches its sign-in session's streams through the bus with a session scope (the case
// above), which a bus between processes keeps; the registry has no `endSession` of its own.
describe('the registry’s ways to end streams (B40a, nit 8)', () => {
  it('ends streams by user and for shutdown only: no endSession bypassing the bus', () => {
    const { registry } = fixture();
    expect(typeof registry.endUser).toBe('function');
    expect(typeof registry.endAll).toBe('function');
    expect('endSession' in registry).toBe(false);
  });
});
