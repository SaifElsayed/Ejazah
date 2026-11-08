// T173: one stop sequence, run exactly once, however many signals arrive (FR-051; review finding
// SEC-10 and the worker item of the code review).
//
// A deploy stops a process with SIGTERM and an operator's terminal with SIGINT, sometimes twice in
// a row. Each process registers its own close sequence here (main.ts stops listening and closes
// the database; worker.ts closes the worker, the queue and the database), and this file promises
// three things about it: it runs once, so a second signal awaits the sequence already running
// instead of closing a half-closed client again; the process exits when it settles, 0 on success
// and 1 on a rejection, so a supervisor sees a failed stop as a failure; and the rejection is
// logged before the exit, with the error as `err` so the logger keeps its classification code.
//
// The process is a parameter, defaulting to Node's, so a spec can signal a fake and watch what it
// records; nothing here reads a signal from anywhere else.
//
// The request process's own sequence is `apiStopSequence` (T063 of specs/004-sessions): the live
// streams first, then the application, then the queue and the database, so a spec proves the order
// and that the stop never waits on an open stream without `main.ts`.

/** The two signals a process is stopped with. */
export const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/** What `onShutdown` needs of a process: to be signalled, and to exit with a code. */
export interface ProcessLike {
  on(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  exit(code: number): unknown;
}

/** What `onShutdown` logs: which signal started the stop, and a sequence that rejected. */
export interface ShutdownLog {
  info(fields: { readonly signal: NodeJS.Signals }, message: string): void;
  error(fields: { readonly err: unknown }, message: string): void;
}

export interface ShutdownOptions {
  readonly signals?: readonly NodeJS.Signals[];
  readonly process?: ProcessLike;
  readonly log?: ShutdownLog;
}

const silent: ShutdownLog = { info: () => undefined, error: () => undefined };

/**
 * Registers `sequence` as the process's stop: on the first of the signals it runs once and the
 * process exits with its outcome; every later signal awaits that same run. Returns the stop
 * itself, which runs the same once-only sequence without a signal.
 */
export function onShutdown(
  sequence: () => Promise<void>,
  {
    signals = SHUTDOWN_SIGNALS,
    process: target = process,
    log = silent,
  }: ShutdownOptions = {},
): () => Promise<void> {
  let stopping: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    stopping ??= sequence().then(
      () => {
        target.exit(0);
      },
      (error: unknown) => {
        log.error({ err: error }, 'The stop sequence failed');
        target.exit(1);
      },
    );
    return stopping;
  };

  for (const signal of signals) {
    target.on(signal, () => {
      if (stopping === undefined) log.info({ signal }, 'Stopping');
      void stop();
    });
  }
  return stop;
}

/** What the API's stop closes (T063 of specs/004-sessions). */
export interface ApiStopParts {
  /** The process's live streams: every one ended at once, synchronously (`LiveRegistry.endAll`). */
  readonly live: { endAll(): number };
  /** The HTTP application: stops listening and waits for the requests it is answering. */
  readonly application: { close(): Promise<void> };
  /** What closes after it, in order: the queue when an add opened it, then the database. */
  readonly afterwards: ReadonlyArray<() => Promise<unknown> | undefined>;
}

/**
 * The request process's stop sequence, for `onShutdown` (T063; FR-429; contracts/kernel.md,
 * "Shutdown order", the owner's hard condition): every live stream ended BEFORE the application
 * closes, since Node's `server.close()` waits on a connection still answering and one open stream
 * would hold a deploy until it is killed; then the application; then each later part.
 */
export function apiStopSequence({ live, application, afterwards }: ApiStopParts): () => Promise<void> {
  return async () => {
    live.endAll();
    await application.close();
    for (const close of afterwards) await close();
  };
}
