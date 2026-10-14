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
