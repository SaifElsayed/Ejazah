// T173 — the two processes stop once and cleanly, and a failure keeps its code (FR-040, FR-051;
// review finding SEC-10 and the worker item of the code review).
//
// A deploy stops a process with SIGTERM, and an operator's terminal with SIGINT, sometimes twice.
// `onShutdown` runs one stop sequence exactly once however many signals arrive: a later signal
// awaits the sequence already running rather than starting a second over a half-closed client.
// The exit code follows the sequence: 0 when it resolved, 1 when it rejected, after the rejection
// was logged, so a supervisor sees a failed stop as a failure. The process is a fake built on an
// EventEmitter, so no signal reaches the test runner and `exit` is a function that records.
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { addHours } from '@ijazah/time';
import { describe, expect, it, vi } from 'vitest';
import { InProcessLiveBus } from '../live/live-bus.js';
import { LiveRegistry } from '../live/live-registry.js';
import { apiStopSequence, onShutdown } from './shutdown.js';

/** A process that can be signalled and asked to exit, and records both. */
function fakeProcess() {
  const emitter = new EventEmitter();
  const exit = vi.fn<(code: number) => never>();
  return {
    exit,
    on: emitter.on.bind(emitter),
    signal: (name: 'SIGTERM' | 'SIGINT') => emitter.emit(name, name),
    listenerCount: (name: string) => emitter.listenerCount(name),
  };
}

function fakeLog() {
  const records: { level: 'info' | 'error'; fields: unknown; message: string }[] = [];
  return {
    records,
    info: (fields: unknown, message: string) => void records.push({ level: 'info', fields, message }),
    error: (fields: unknown, message: string) =>
      void records.push({ level: 'error', fields, message }),
  };
}

/** Lets every promise the handlers chained settle. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('onShutdown (T173)', () => {
  it('registers SIGTERM and SIGINT on the given process, and nothing until a signal arrives', () => {
    const process = fakeProcess();
    const sequence = vi.fn(async () => {});

    onShutdown(sequence, { process, log: fakeLog() });

    expect(process.listenerCount('SIGTERM')).toBe(1);
    expect(process.listenerCount('SIGINT')).toBe(1);
    expect(sequence).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('runs the sequence once for two signals, then exits 0 once', async () => {
    const process = fakeProcess();
    let finish: () => void = () => {};
    const sequence = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    onShutdown(sequence, { process, log: fakeLog() });

    process.signal('SIGTERM');
    process.signal('SIGTERM');
    process.signal('SIGINT');
    await settled();
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(process.exit).not.toHaveBeenCalled();

    finish();
    await settled();
    expect(process.exit).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when the sequence rejects, after logging the rejection', async () => {
    const process = fakeProcess();
    const log = fakeLog();
    const failure = new Error('the queue did not close');
    onShutdown(
      async () => {
        throw failure;
      },
      { process, log },
    );

    process.signal('SIGINT');
    await settled();

    expect(process.exit).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(1);
    const logged = log.records.find((record) => record.level === 'error');
    expect(logged?.fields).toEqual({ err: failure });
    expect(logged?.message).toMatch(/stop/i);
  });

  it('logs which signal started the stop, once', async () => {
    const process = fakeProcess();
    const log = fakeLog();
    onShutdown(async () => {}, { process, log });

    process.signal('SIGTERM');
    process.signal('SIGINT');
    await settled();

    const started = log.records.filter((record) => record.level === 'info');
    expect(started).toHaveLength(1);
    expect(started[0]?.fields).toEqual({ signal: 'SIGTERM' });
  });

  it('listens for the signals it is given instead of the two defaults', () => {
    const process = fakeProcess();
    onShutdown(async () => {}, { process, log: fakeLog(), signals: ['SIGINT'] });
    expect(process.listenerCount('SIGINT')).toBe(1);
    expect(process.listenerCount('SIGTERM')).toBe(0);
  });

  it('hands back the stop itself, so a caller can run the same once-only sequence without a signal', async () => {
    const process = fakeProcess();
    const sequence = vi.fn(async () => {});
    const stop = onShutdown(sequence, { process, log: fakeLog() });

    await Promise.all([stop(), stop()]);
    process.signal('SIGTERM');
    await settled();

    expect(sequence).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});

// T063 of specs/004-sessions (FR-429; research R-324, item 9; contracts/kernel.md, "Shutdown order",
// the owner's hard condition): the API's stop ends every live stream before the application
// closes, then the queue and the database, so `server.close()`, which waits on a connection still
// answering, never waits on a stream. Proved over a real HTTP server holding a stream open per
// request from a real registry, as `live.events` holds one.
describe('the API’s stop sequence (T063, FR-429)', () => {
  it('ends the live streams, then closes the application, then each later part, in that order', async () => {
    const order: string[] = [];
    const stop = apiStopSequence({
      live: {
        endAll: () => {
          order.push('live');
          return 0;
        },
      },
      application: {
        close: async () => {
          order.push('application');
        },
      },
      afterwards: [
        async () => {
          order.push('queue');
        },
        () => {
          order.push('database');
          return undefined;
        },
      ],
    });

    await stop();
    expect(order).toEqual(['live', 'application', 'queue', 'database']);
  });

  it('completes with streams open, never waiting on one, and the registry logs the count', async () => {
    const lines: Array<Readonly<Record<string, unknown>>> = [];
    const bus = new InProcessLiveBus();
    const registry = new LiveRegistry({
      bus,
      settings: { read: async (_key, schema) => schema.parse(3) },
      log: { info: (fields) => void lines.push(fields) },
    });
    const server = createServer((request, response) => {
      void (async () => {
        const stream = await registry.open({
          userId: request.url ?? '/',
          sessionId: 's',
          expiresAt: new Date(addHours(new Date(), 1)),
        });
        // As the user surface answers a subscription (`app.module.ts`, `responseMeta`, T063).
        response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' });
        response.write(': open\n\n');
        for await (const event of stream) response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end();
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const readers = await Promise.all(
      ['/a', '/b', '/c'].map(async (path) => {
        const response = await fetch(`http://127.0.0.1:${String(port)}${path}`);
        const reader = response.body?.getReader();
        await reader?.read();
        return reader;
      }),
    );
    expect(registry.count()).toBe(3);

    const started = performance.now();
    await apiStopSequence({
      live: registry,
      application: {
        close: () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error === undefined ? resolve() : reject(error))),
          ),
      },
      afterwards: [],
    })();

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(registry.count()).toBe(0);
    expect(lines).toEqual([{ streamsEnded: 3 }]);
    for (const reader of readers) await reader?.cancel();
  });
});
