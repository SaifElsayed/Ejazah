// T023 — the email port's entry picks its adapter from `EMAIL_PROVIDER` and hands it `EMAIL_FROM`;
// in development it also hands the stand-in the mail folder under `STORAGE_LOCAL_ROOT`, in test
// none, so no test run writes a mail anywhere (contracts/ports.md "Stand-in behaviour").
// 002:T177 (SRS DEC-108): `resend` serves Resend with EMAIL_PROVIDER_KEY, from EMAIL_FROM under
// EMAIL_FROM_NAME, replying to SUPPORT_EMAIL; the entry refuses to build it without the key, as the
// configuration does. The global `fetch` is replaced in the case that delivers: no request leaves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeEmailAdapter } from './fake.adapter.js';
import { createEmailPort, mailDirectoryOf } from './index.js';
import { ResendEmailAdapter } from './resend.adapter.js';

const config = {
  EMAIL_PROVIDER: 'fake',
  EMAIL_FROM: 'codes@ijazah.invalid',
  EMAIL_FROM_NAME: 'إجازة',
  SUPPORT_EMAIL: 'help@ijazah.invalid',
  NODE_ENV: 'test',
  STORAGE_LOCAL_ROOT: '.storage',
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the email port entry (T023, FR-056)', () => {
  it('selects the stand-in with the configured sender', () => {
    const port = createEmailPort(config);
    expect(port).toBeInstanceOf(FakeEmailAdapter);
    expect((port as FakeEmailAdapter).from).toBe('codes@ijazah.invalid');
  });

  it('names the mail folder under the local storage root in development, and none otherwise', () => {
    expect(mailDirectoryOf({ NODE_ENV: 'development', STORAGE_LOCAL_ROOT: '.storage' })).toBe(
      ['.storage', 'mail'].join(process.platform === 'win32' ? '\\' : '/'),
    );
    expect(mailDirectoryOf({ NODE_ENV: 'test', STORAGE_LOCAL_ROOT: '.storage' })).toBeUndefined();
    expect(
      mailDirectoryOf({ NODE_ENV: 'production', STORAGE_LOCAL_ROOT: '/var/ijazah' }),
    ).toBeUndefined();
  });

  it('selects Resend with its key, the sender under its name, and the support address for replies (002:T177)', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'mail-1' })));
    const port = createEmailPort({
      ...config,
      EMAIL_PROVIDER: 'resend',
      EMAIL_PROVIDER_KEY: 're_spec_placeholder',
    });

    expect(port).toBeInstanceOf(ResendEmailAdapter);
    await port.deliver({ to: 'a@example.invalid', subject: 'probe', text: 'probe' });

    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer re_spec_placeholder',
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      from: 'إجازة <codes@ijazah.invalid>',
      reply_to: 'help@ijazah.invalid',
    });
  });

  it('refuses to build Resend without EMAIL_PROVIDER_KEY, naming the key (002:T177)', () => {
    expect(() => createEmailPort({ ...config, EMAIL_PROVIDER: 'resend' })).toThrow(
      'EMAIL_PROVIDER=resend needs EMAIL_PROVIDER_KEY.',
    );
  });
});
