// T151 (FR-052, FR-039): after the build, both processes of the API start from built JavaScript.
//
// `node apps/api/dist/main.js` and `node apps/api/dist/worker.js` must get past module loading to
// their own startup. Before T151 the worker failed with ERR_MODULE_NOT_FOUND, because
// `@ijazah/time` published its TypeScript source as `main` and Node loaded `src/index.ts`, whose
// `./resolve.js` exists only after a build. This spec builds the API and the workspace packages it
// depends on exactly as `pnpm build` does (`pnpm --filter "@ijazah/api..." run build`: the API and
// its dependencies, nothing else), then starts each entrypoint and waits for a sign of its own
// startup:
//   - main.ts listens and logs `Listening`: a database is opened lazily, so an unreachable one
//     does not stop the request process booting (the readiness probe reports it, T110);
//   - worker.ts reaches the queue and is refused by Redis: the first thing it does after loading
//     its modules that a test can see without a Redis.
// Either way the output must not carry ERR_MODULE_NOT_FOUND, and the process is stopped after.
//
// THE CONFIGURATION comes from one place: `.env.example`, which config.spec.ts keeps equal to the
// schema's keys, plus `REQUIRED_WITHOUT_EXAMPLE` for a required value the example leaves empty on
// purpose (a secret). A task that adds a required key adds it to `.env.example` with a usable
// value, or to that table, and this spec needs nothing else. The database and Redis point at port
// 1 on the loopback address, where nothing listens. Every key of `.env.example` is removed from the
// inherited environment first, so a developer's own values never decide the outcome.
//
// IN THE PIPELINE. Stage 2 of `.github/workflows/ci.yml` (tests) and stage 5 (build) are
// placeholders until T081, so today this spec runs where `pnpm test` runs locally. Once T081 runs
// the tests in CI, this spec builds for itself and needs only the generated client
// (`pnpm db:generate`), which the API's build reads; it needs no database and no Redis.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const api = join(root, 'apps', 'api');

const NOBODY_LISTENS = '127.0.0.1:1';
const STARTUP_TIMEOUT_MILLISECONDS = 30_000;

/** Required values `.env.example` leaves empty on purpose: generated here, never a real secret. */
const REQUIRED_WITHOUT_EXAMPLE: Readonly<Record<string, () => string>> = {
  ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
};

const example = parse(readFileSync(join(root, '.env.example'), 'utf8'));

function validConfiguration(port: number): Record<string, string> {
  const configuration: Record<string, string> = { ...example };
  for (const [key, generate] of Object.entries(REQUIRED_WITHOUT_EXAMPLE)) {
    configuration[key] = generate();
  }
  return {
    ...configuration,
    PORT: String(port),
    LOG_LEVEL: 'info',
    DATABASE_URL: `postgresql://ijazah_app:app@${NOBODY_LISTENS}/ijazah`,
    REDIS_URL: `redis://${NOBODY_LISTENS}`,
  };
}

/** The inherited environment without any key the configuration declares. */
function inheritedEnvironment(): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key in example)) inherited[key] = value;
  }
  return inherited;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'));
        else resolve(address.port);
      });
    });
  });
}

/** `pnpm`, run the way this test was: through its own script when `pnpm test` started it. */
function runPnpm(args: readonly string[]): { status: number | null; output: string } {
  const pnpm = process.env['npm_execpath'];
  const viaScript = pnpm !== undefined && /\.c?js$/.test(pnpm);
  const result = viaScript
    ? spawnSync(process.execPath, [pnpm, ...args], { cwd: root, encoding: 'utf8' })
    : spawnSync('pnpm', [...args], {
        cwd: root,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

interface Startup {
  readonly reached: boolean;
  readonly output: string;
}

/** Starts one built entrypoint, stops it once `reached` matches its output or time is up, and reports. */
function start(entrypoint: string, reached: RegExp, port: number, cwd: string): Promise<Startup> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(process.execPath, [join(api, 'dist', entrypoint)], {
      cwd,
      env: { ...inheritedEnvironment(), ...validConfiguration(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    // Stopped once its startup is seen or time is up; the answer is given only after it has
    // exited, so it no longer holds the working directory the test removes.
    const stop = () => {
      clearTimeout(timer);
      child.kill();
    };
    const timer = setTimeout(stop, STARTUP_TIMEOUT_MILLISECONDS);
    const read = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (reached.test(output)) stop();
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('close', () => {
      clearTimeout(timer);
      resolve({ reached: reached.test(output), output });
    });
  });
}

let workingDirectory: string;

beforeAll(() => {
  // The entrypoints run from an empty directory, so nothing they might create lands in the tree.
  workingDirectory = mkdtempSync(join(tmpdir(), 'ijazah-built-entrypoints-'));
  const build = runPnpm(['--filter', '@ijazah/api...', 'run', 'build']);
  expect(build.status, build.output).toBe(0);
}, 300_000);

afterAll(() => {
  rmSync(workingDirectory, { recursive: true, force: true });
});

describe('the built entrypoints (T151)', () => {
  it('main.js loads every module and listens, with an unreachable database', async () => {
    const startup = await start('main.js', /"msg":"Listening"/, await freePort(), workingDirectory);
    expect(startup.output).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(startup.reached, startup.output).toBe(true);
  });

  it('worker.js loads every module and reaches the queue, with an unreachable database', async () => {
    const startup = await start('worker.js', /ECONNREFUSED/, await freePort(), workingDirectory);
    expect(startup.output).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(startup.reached, startup.output).toBe(true);
  });
});
