// T023 — the email port's entry picks its adapter from `EMAIL_PROVIDER` and hands it `EMAIL_FROM`;
// in development it also hands the stand-in the mail folder under `STORAGE_LOCAL_ROOT`, in test
// none, so no test run writes a mail anywhere (contracts/ports.md "Stand-in behaviour").
import { describe, expect, it } from 'vitest';
import { FakeEmailAdapter } from './fake.adapter.js';
import { createEmailPort, mailDirectoryOf } from './index.js';

const config = {
  EMAIL_PROVIDER: 'fake',
  EMAIL_FROM: 'codes@ijazah.invalid',
  NODE_ENV: 'test',
  STORAGE_LOCAL_ROOT: '.storage',
} as const;

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
});
