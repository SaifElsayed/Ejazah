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
import { describe, expect, it, vi } from 'vitest';
import { onShutdown } from './shutdown.js';

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
