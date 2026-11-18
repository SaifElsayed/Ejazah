// T008 of specs/005-certification (FR-606; R-401; ADR 0004 D1): the Typst CLI, pinned at 0.15.1, run
// as a child process by the worker's `render-certificate` job, never by a request (R-API-13).
//
// THE TIMEOUT. `CERTIFICATE_RENDER_TIMEOUT_MS` is a protection number of the kernel, named here once
// (R-MONEY-12's exception, constitution 2.6.1 as amended 2026-11-17): a stuck render would hold a
// worker slot for good, so a render past it is killed and the job fails into the queue's retries.
// It is not a setting, since an administrator lowering it below a real render's time would make
// every certificate fail. ADR 0004 measured 0.09 to 0.67 s for one page; 30 s leaves room for a
// cold start on a small machine and still frees the slot.
//
// WHAT IS NEVER READ. The child's output is not collected: Typst's diagnostics can quote the case's
// values (a name), and an error here reaches the logs and the error tracker (R-SEC-2). A failure is
// named by its exit code alone; the template spec is where a template error is read.
import { spawn } from 'node:child_process';

/** The longest one render may run before it is killed (R-MONEY-12's exception; see above). */
export const CERTIFICATE_RENDER_TIMEOUT_MS = 30_000;

/** The CLI could not render: a missing binary, or an exit other than 0. */
export class TypstRenderFailed extends Error {
  readonly exitCode: number | null;

  constructor(exitCode: number | null, options?: ErrorOptions) {
    super(
      exitCode === null
        ? 'The Typst CLI could not be started.'
        : `The Typst CLI exited with code ${String(exitCode)}.`,
      options,
    );
    this.name = 'TypstRenderFailed';
    this.exitCode = exitCode;
  }
}

/** The render ran past `CERTIFICATE_RENDER_TIMEOUT_MS` and was killed. */
export class TypstRenderTimedOut extends Error {
  constructor(timeoutMs: number) {
    super(`The Typst CLI ran past ${String(timeoutMs)} ms and was killed.`);
    this.name = 'TypstRenderTimedOut';
  }
}

export interface TypstRun {
  /** The binary (`TYPST_BIN`). */
  readonly bin: string;
  readonly args: readonly string[];
  /** The kill deadline; `CERTIFICATE_RENDER_TIMEOUT_MS` unless a spec sets one. */
  readonly timeoutMs?: number;
}

/** What renders a certificate: `runTypst`, or a spec's stand-in. */
export type TypstRunner = (run: TypstRun) => Promise<void>;

/**
 * Runs the CLI once and settles when the process has ended: resolved on exit 0, rejected with
 * `TypstRenderFailed` otherwise, and with `TypstRenderTimedOut` once a render past the timeout has
 * been killed. The process gets an empty environment but its search path, so nothing of the
 * worker's configuration reaches it.
 */
export const runTypst: TypstRunner = ({ bin, args, timeoutMs = CERTIFICATE_RENDER_TIMEOUT_MS }) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], {
      stdio: 'ignore',
      windowsHide: true,
      env: { PATH: process.env['PATH'] ?? '' },
    });
    let timedOut = false;
    let startFailure: Error | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', (error) => {
      startFailure = error;
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new TypstRenderTimedOut(timeoutMs));
      else if (startFailure !== undefined) {
        reject(new TypstRenderFailed(null, { cause: startFailure }));
      } else if (code === 0) resolve();
      else reject(new TypstRenderFailed(code));
    });
  });
