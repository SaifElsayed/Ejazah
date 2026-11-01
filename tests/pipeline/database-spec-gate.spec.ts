// T124: no spec writes to a database unless `IJAZAH_DB_SPECS=1` says so. Not sourcing `.env` is not
// enough, since the integrity harness and the API's fixtures read the two database URLs from `.env`
// by themselves; and the database's name decides nothing, since CI's is also named `ijazah`.
//
// HOW IT IS PROVEN. Two real database specs, one through the integrity harness and one through the
// admin fixtures, are run by the repository's own configuration from a folder whose `.env` names a
// database on a local port this spec listens on. The listener counts every connection and closes it
// at once, so nothing is ever written. Without the variable, both files report skipped and the count
// stays at 0: no hook ran and nothing connected. With it, the URLs come from the environment only
// (the owner's decision of 2026-11-01): `.env`'s are never read, so a run whose environment lacks
// one refuses, naming it, and connects to nothing; given the listener's URLs in the environment, the
// same run reaches it, so the files did run.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const SPECS = [
  'tests/db-integrity/audit.spec.ts',
  'apps/api/src/modules/admin/admin-invite.spec.ts',
];

let server: Server;
let connections = 0;
let folder: string;
let listening = '';

const urlAs = (role: string) => `postgresql://${role}:spec@${listening}/ijazah`;

beforeAll(async () => {
  server = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port to listen on');
  listening = `127.0.0.1:${address.port}`;
  folder = mkdtempSync(join(tmpdir(), 'ijazah-database-spec-gate-'));
  writeFileSync(
    join(folder, '.env'),
    `DATABASE_URL=${urlAs('ijazah_app')}\nDATABASE_URL_OWNER=${urlAs('ijazah_owner')}\n`,
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(folder, { recursive: true, force: true });
});

/**
 * The two specs, run by the repository's configuration from the folder holding the `.env`, with no
 * database URL in the environment but those given.
 */
function run(
  variable: string | undefined,
  urls: Readonly<Record<string, string>> = {},
): Promise<{ code: number | null; output: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['DATABASE_URL'];
  delete env['DATABASE_URL_OWNER'];
  delete env['IJAZAH_DB_SPECS'];
  if (variable !== undefined) env['IJAZAH_DB_SPECS'] = variable;
  Object.assign(env, urls);
  // Asynchronous, not `spawnSync`: the listener lives in this process and must answer meanwhile.
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(root, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--config',
        join(root, 'vitest.config.ts'),
        '--root',
        root,
        ...SPECS,
      ],
      { cwd: folder, env },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output: stripVTControlCharacters(output) }));
  });
}

describe('the database specs (T124)', () => {
  it('are skipped, and connect to nothing, without IJAZAH_DB_SPECS, though .env names a database', async () => {
    connections = 0;
    const { code, output } = await run(undefined);
    expect(connections, output).toBe(0);
    expect(code, output).toBe(0);
    expect(output).toMatch(/Test Files\s+2 skipped \(2\)/);
    expect(output).toMatch(/Tests\s+\d+ skipped \(\d+\)/);
  }, 150_000);

  it('are skipped with any value but 1', async () => {
    connections = 0;
    const { code, output } = await run('true');
    expect(connections, output).toBe(0);
    expect(code, output).toBe(0);
    expect(output).toMatch(/Test Files\s+2 skipped \(2\)/);
  }, 150_000);

  it('refuse with IJAZAH_DB_SPECS=1 when the environment lacks the URL, never reading .env', async () => {
    connections = 0;
    const { code, output } = await run('1');
    expect(connections, output).toBe(0);
    expect(code, output).not.toBe(0);
    expect(output).toMatch(/DATABASE_URL is not set in the environment/);
    expect(output).toMatch(/ijazah_integrity/);
    expect(output).not.toContain(listening);
  }, 150_000);

  it('run with IJAZAH_DB_SPECS=1, reaching the database the environment names', async () => {
    connections = 0;
    const { output } = await run('1', {
      DATABASE_URL: urlAs('ijazah_app'),
      DATABASE_URL_OWNER: urlAs('ijazah_owner'),
    });
    expect(output).not.toMatch(/Test Files\s+2 skipped \(2\)/);
    expect(connections, output).toBeGreaterThan(0);
  }, 150_000);
});
