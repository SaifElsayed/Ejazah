// T121: provider selection happens once, at startup, from the loaded configuration (FR-056). What
// a caller receives is typed as the port and nothing else, so no calling module can branch on which
// provider serves it. Push is selected apart from the other four, because only the queued
// notification job may reach it (R-API-15): the request process never holds it.
//
// Selection is checked by behaviour here, since this file may not name a concrete adapter
// (R-API-4); each port folder's own spec checks which adapter its entry picks.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { piasters } from '@ijazah/money';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { ConfigError, loadConfig, type Config } from '../config/config.module.js';
import type { EmailPort } from './email/email.port.js';
import type { PaymentPort } from './payment/payment.port.js';
import { type Ports, selectPorts, selectPushPort } from './ports.module.js';
import type { SignInPort } from './sign-in/sign-in.port.js';
import type { SmsPort } from './sms/sms.port.js';
import type { StoragePort } from './storage/storage.port.js';
import type { VideoPort } from './video/video.port.js';

const NOTIFICATION = '01928c3e-7a10-7000-8000-00000000c001';
const SESSION = '01928c3e-7a10-7000-8000-000000000001';

// Only what the schema requires: every provider variable unset, every provider defaulted (SC-005).
const required = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ijazah_app:app@127.0.0.1:5432/ijazah',
  REDIS_URL: 'redis://127.0.0.1:6379',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PAYMENT_GATEWAY: 'fake',
  SUPPORT_EMAIL: 'support@ijazah.invalid',
};

let root: string;
let config: Config;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ijazah-ports-'));
  config = loadConfig({ ...required, STORAGE_LOCAL_ROOT: root });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('provider selection (T121, FR-056)', () => {
  it('hands out each port as its interface, and nothing that names a provider', () => {
    expectTypeOf<Ports>().toEqualTypeOf<{
      readonly storage: StoragePort;
      readonly payment: PaymentPort;
      readonly sms: SmsPort;
      readonly video: VideoPort;
      readonly signIn: SignInPort;
      readonly email: EmailPort;
    }>();
  });

  it('keeps push out of the ports the request process receives (R-API-15)', () => {
    expect(Object.keys(selectPorts(config)).sort()).toEqual([
      'email',
      'payment',
      'signIn',
      'sms',
      'storage',
      'video',
    ]);
  });

  it('defaults video, push, messaging, sign-in and email to their stand-ins', () => {
    expect(config.VIDEO_PROVIDER).toBe('fake');
    expect(config.PUSH_PROVIDER).toBe('fake');
    expect(config.SMS_PROVIDER).toBe('fake');
    expect(config.SIGN_IN_PROVIDER).toBe('fake');
    expect(config.EMAIL_PROVIDER).toBe('fake');
  });

  it.each([
    'VIDEO_PROVIDER',
    'PUSH_PROVIDER',
    'SMS_PROVIDER',
    'SIGN_IN_PROVIDER',
    'EMAIL_PROVIDER',
  ])('refuses at startup a %s that names no implementation, naming the key', (key) => {
    let failure: unknown;
    try {
      loadConfig({ ...required, [key]: 'acme-cloud' });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConfigError);
    expect((failure as ConfigError).offendingKeys).toEqual([key]);
    expect((failure as ConfigError).message).not.toContain('acme-cloud');
  });

  it('selects working ports with no credential and no network (SC-005)', async () => {
    const { storage, payment, sms, video, signIn, email } = selectPorts(config);

    await storage.put('selection/probe.txt', new TextEncoder().encode('probe'), 'text/plain');
    expect(await storage.exists('selection/probe.txt')).toBe(true);
    await expect(
      payment.createCheckout('enr-1', piasters(100), 'EGP', new Date('2026-10-08T10:30:00Z')),
    ).resolves.toHaveProperty('gatewayOrderId');
    await expect(sms.send('+201000000000', 'Your code is 482913')).resolves.toBeUndefined();
    await expect(video.createRoom(SESSION)).resolves.toEqual(expect.any(String));
    const nonce = 'n_selection';
    await expect(
      signIn.verifyIdentityToken({
        provider: 'google',
        // The documented fake token shape (contracts/ports.md), spelled here: this file names no adapter.
        token: `fake.google.sub-1.a@example.invalid.verified.${nonce}`,
        nonce,
      }),
    ).resolves.toMatchObject({ subject: 'sub-1', emailVerified: true });
    await expect(
      email.deliver({ to: 'a@example.invalid', subject: 'probe', text: 'probe' }),
    ).resolves.toBeUndefined();
    await expect(
      selectPushPort(config).deliver(
        { token: 'device-token', platform: 'android' },
        { notificationId: NOTIFICATION },
      ),
    ).resolves.toBeUndefined();
  });

  it('selects anew on every call, holding nothing between processes or callers', () => {
    expect(selectPorts(config).payment).not.toBe(selectPorts(config).payment);
  });
});
