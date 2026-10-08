// T114: the complete suite passes with every provider variable unset (SC-005, FR-054).
//
// DECISION (T114) — the narrowest reading that holds the claim without running the suite inside
// itself. Starting `vitest` again from here, with the environment stripped, would run every spec
// twice per run and need a guard against recursion. Instead this spec holds the three conditions
// under which no test can depend on a provider variable, each one mechanically:
//
//   1. Every key of the configuration schema is classified as a provider variable or a platform
//      value, so a new key cannot arrive unclassified; and the configuration loads with every
//      provider variable unset, selecting the stand-ins and local storage.
//   2. The ports selected from that configuration (T121) answer every operation with no
//      credential and touch no network: no `fetch`, no socket.
//   3. No file the suite runs, and no test helper, reads a provider variable from the ambient
//      environment (`process.env.X`, `process.env['X']`), or loads the ambient environment into
//      the configuration (`loadConfig` or `loadConfigOrExit` called with no source, or handed
//      `process.env`). Tests that need configuration hand it explicitly. This file, which spells
//      those forms out to test its own patterns, is the one file not scanned.
//
// Together they mean the suite's outcome cannot change with a provider variable set or unset, which
// is SC-005. What this does not see, and review does: a read through a computed name
// (`process.env[name]`, as the database harness reads the platform's own `DATABASE_URL`), and a
// child process handed the whole environment.
import { globSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { piasters } from '../../packages/money/src/index';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig, type Config } from '../../apps/api/src/platform/config/config.module';
import { envKeys } from '../../apps/api/src/platform/config/env.schema';
import { selectPorts, selectPushPort } from '../../apps/api/src/platform/ports/ports.module';

const repositoryRoot = resolve(import.meta.dirname, '../..');

/** Credentials and locations of third-party services: what SC-005 says the suite must not need. */
const providerVariables = [
  'PAYMENT_GATEWAY_API_KEY',
  'PAYMENT_GATEWAY_WEBHOOK_SECRET',
  'DAILY_API_KEY',
  'DAILY_WEBHOOK_SECRET',
  'SMS_PROVIDER_KEY',
  'EXPO_ACCESS_TOKEN',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'SENTRY_DSN',
  'PUBLIC_WEBHOOK_ORIGIN',
] as const;

/** The platform's own values: the process, its database and queue, and which adapter serves a port. */
const platformValues = [
  'NODE_ENV',
  'PORT',
  'LOG_LEVEL',
  'DATABASE_URL_OWNER',
  'DATABASE_URL',
  'REDIS_URL',
  'ENCRYPTION_KEY',
  'STORAGE_DRIVER',
  'STORAGE_LOCAL_ROOT',
  'PAYMENT_GATEWAY',
  'VIDEO_PROVIDER',
  'PUSH_PROVIDER',
  'SMS_PROVIDER',
] as const;

// What the schema requires, and nothing of a provider's.
const platformOnly = {
  DATABASE_URL: 'postgresql://ijazah_app:app@127.0.0.1:5432/ijazah',
  REDIS_URL: 'redis://127.0.0.1:6379',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PAYMENT_GATEWAY: 'fake',
};

describe('the configuration needs no provider variable (T114, SC-005)', () => {
  it('classifies every key of the schema, so a new one cannot arrive unclassified', () => {
    expect([...providerVariables, ...platformValues].sort()).toEqual([...envKeys].sort());
    expect(
      providerVariables.filter((key) => (platformValues as readonly string[]).includes(key)),
    ).toEqual([]);
  });

  it('loads with every provider variable unset, selecting the stand-ins and local storage', () => {
    const config = loadConfig(platformOnly);

    for (const key of providerVariables) expect(config[key]).toBeUndefined();
    expect(config).toMatchObject({
      STORAGE_DRIVER: 'local',
      PAYMENT_GATEWAY: 'fake',
      VIDEO_PROVIDER: 'fake',
      PUSH_PROVIDER: 'fake',
      SMS_PROVIDER: 'fake',
    });
  });
});

describe('the ports answer with no credential and no network (T114, SC-005)', () => {
  let root: string;
  let config: Config;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ijazah-no-credentials-'));
    config = loadConfig({ ...platformOnly, STORAGE_LOCAL_ROOT: root });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs every operation of every port without opening a connection', async () => {
    const fetching = vi.spyOn(globalThis, 'fetch');
    const connecting = vi.spyOn(Socket.prototype, 'connect');
    const { storage, payment, sms, video } = selectPorts(config);
    const push = selectPushPort(config);
    const session = '01928c3e-7a10-7000-8000-000000000001';
    const user = '01928c3e-7a10-7000-8000-0000000000a1';

    await storage.put('probe/file.txt', new TextEncoder().encode('probe'), 'text/plain');
    expect(await storage.exists('probe/file.txt')).toBe(true);
    expect(await storage.temporaryLink('probe/file.txt', 60)).toMatch(/^\/files\//);
    await storage.remove('probe/file.txt');

    const checkout = await payment.createCheckout(
      'enr-1',
      piasters(100),
      'EGP',
      new Date('2026-10-08T10:30:00Z'),
    );
    expect(await payment.cancelCheckout(checkout.gatewayOrderId)).toBe('cancelled');
    await expect(payment.verifyAndParseEvent(Buffer.from('{}'), {})).rejects.toThrow('signature');
    const recipient = await payment.registerPayoutRecipient(user, {
      holderName: 'Teacher Name',
      method: 'mobile_wallet',
      accountNumber: '01000000000',
    });
    expect(await payment.getRecipientStatus(recipient)).toBe('pending');

    await sms.send('+201000000000', 'Your code is 482913');

    await video.createRoom(session);
    expect(await video.createSessionToken(session, user)).toMatchObject({ sessionId: session });
    await expect(video.verifyAndParseParticipantEvent(Buffer.from('{}'), {})).rejects.toThrow(
      'signature',
    );
    await video.endRoom(session);

    const device = { token: 'device-token', platform: 'ios' } as const;
    await push.deliver(device, { notificationId: session });
    expect(await push.findStaleTargets([device])).toEqual([]);

    expect(fetching).not.toHaveBeenCalled();
    expect(connecting).not.toHaveBeenCalled();
  });
});

describe('no test reads a provider variable from the environment (T114, SC-005)', () => {
  // Every file vitest.config.ts collects, and every helper beside them under tests/.
  const sources = [
    ...globSync('tests/**/*.ts', { cwd: repositoryRoot }),
    ...globSync('apps/*/src/**/*.spec.ts', { cwd: repositoryRoot }),
    ...globSync('packages/*/src/**/*.spec.ts', { cwd: repositoryRoot }),
  ]
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => !path.includes('node_modules/') && !path.includes('/dist/'))
    .filter((path) => !path.startsWith('tests/violations/fixtures/'))
    .filter((path) => path !== 'tests/ports/no-credentials.spec.ts');

  const names = providerVariables.join('|');
  const readsProviderVariable = new RegExp(
    String.raw`process\.env(?:\.(?:${names})\b|\[\s*['"\x60](?:${names})['"\x60]\s*\])`,
  );
  const loadsAmbientEnvironment = /loadConfig(?:OrExit)?\(\s*(?:process\.env\s*)?\)/;

  it('finds the files the suite runs', () => {
    expect(sources).toContain('tests/db-integrity/harness.ts');
    expect(sources).toContain('apps/api/src/platform/ports/ports.module.spec.ts');
    expect(sources.length).toBeGreaterThan(50);
  });

  it('reads no provider variable from process.env, and loads no configuration from it', () => {
    const offenders = sources.filter((path) => {
      const text = readFileSync(resolve(repositoryRoot, path), 'utf8');
      return readsProviderVariable.test(text) || loadsAmbientEnvironment.test(text);
    });

    expect(offenders).toEqual([]);
  });

  it('would catch each form it looks for', () => {
    expect(readsProviderVariable.test('const key = process.env.DAILY_API_KEY;')).toBe(true);
    expect(readsProviderVariable.test("process.env['S3_SECRET_ACCESS_KEY']")).toBe(true);
    expect(readsProviderVariable.test('process.env.DATABASE_URL')).toBe(false);
    expect(loadsAmbientEnvironment.test('const config = loadConfig();')).toBe(true);
    expect(loadsAmbientEnvironment.test('loadConfigOrExit(process.env)')).toBe(true);
    expect(loadsAmbientEnvironment.test('loadConfig(validEnv)')).toBe(false);
  });
});
