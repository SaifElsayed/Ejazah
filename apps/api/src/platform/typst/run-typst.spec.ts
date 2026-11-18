// T008 of specs/005-certification (R-401): the Typst CLI run under the kernel's timeout. The binary is
// stood in for by Node itself running a one-line script, so this spec never needs Typst: what is
// proved is the process handling (an exit, a failure, a missing binary, and a render past the
// timeout killed), which is the same whatever the program.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  CERTIFICATE_RENDER_TIMEOUT_MS,
  runTypst,
  TypstRenderFailed,
  TypstRenderTimedOut,
} from './run-typst.js';

const node = process.execPath;
const scratch = mkdtempSync(join(tmpdir(), 'run-typst-spec-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Whether a process of this id is still alive. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('runTypst (T008, R-401)', () => {
  it('names the render timeout once, as a positive whole number of milliseconds', () => {
    expect(Number.isInteger(CERTIFICATE_RENDER_TIMEOUT_MS)).toBe(true);
    expect(CERTIFICATE_RENDER_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('resolves when the process exits 0', async () => {
    await expect(runTypst({ bin: node, args: ['-e', 'process.exit(0)'] })).resolves.toBeUndefined();
  });

  it('rejects a non-zero exit as TypstRenderFailed, naming the code and never the output', async () => {
    const failure = await runTypst({
      bin: node,
      args: ['-e', 'process.stderr.write("secret-name-in-output"); process.exit(3)'],
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypstRenderFailed);
    expect((failure as TypstRenderFailed).exitCode).toBe(3);
    expect((failure as Error).message).not.toContain('secret-name-in-output');
  });

  it('rejects a missing binary as TypstRenderFailed', async () => {
    const failure = await runTypst({
      bin: join(scratch, 'no-such-typst'),
      args: [],
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypstRenderFailed);
  });

  it('kills a render past the timeout and rejects it as TypstRenderTimedOut', async () => {
    const pidFile = join(scratch, 'stuck.pid');
    const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const started = performance.now();
    const failure = await runTypst({ bin: node, args: ['-e', script], timeoutMs: 1500 }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TypstRenderTimedOut);
    expect(performance.now() - started).toBeLessThan(4000);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(pid)).toBe(false);
  });
});
