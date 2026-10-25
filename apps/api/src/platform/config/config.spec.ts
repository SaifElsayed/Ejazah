import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig, loadConfigOrExit } from './config.module.js';
import { columnKeyId } from '../crypto/encryption.js';
import { envKeys, platformKeys, providerKeys } from './env.schema.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

// 32 zero bytes, base64. A stand-in shape, never a real key (R-SEC-1).
const thirtyTwoBytesBase64 = Buffer.alloc(32).toString('base64');

const validEnv: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'debug',
  DATABASE_URL_OWNER: 'postgresql://ijazah_owner:owner@localhost:5432/ijazah',
  DATABASE_URL: 'postgresql://ijazah_app:app@localhost:5432/ijazah',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: thirtyTwoBytesBase64,
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_ROOT: '.storage',
  PAYMENT_GATEWAY: 'fake',
  SUPPORT_EMAIL: 'support@ijazah.invalid',
};

function without(env: Record<string, string>, ...keys: string[]): Record<string, string> {
  const copy = { ...env };
  for (const key of keys) delete copy[key];
  return copy;
}

describe('env.schema (T015, FR-039)', () => {
  it('covers exactly the keys .env.example names, so the two cannot drift', () => {
    const example = readFileSync(resolve(repositoryRoot, '.env.example'), 'utf8');
    const exampleKeys = example
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
      .filter((key): key is string => key !== undefined)
      .sort();

    expect([...envKeys].sort()).toEqual(exampleKeys);
  });

  it('names the two values T010 left unnamed', () => {
    expect(envKeys).toContain('PUBLIC_WEBHOOK_ORIGIN');
    expect(envKeys).toContain('DAILY_WEBHOOK_SECRET');
  });

  it('accepts the stand-in adapter and refuses an unknown gateway naming the key, never the value', () => {
    expect(loadConfig(validEnv).PAYMENT_GATEWAY).toBe('fake');

    const unknown = 'not-a-gateway-xyz';
    let failure: unknown;
    try {
      loadConfig({ ...validEnv, PAYMENT_GATEWAY: unknown });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConfigError);
    const configError = failure as ConfigError;
    expect(configError.offendingKeys).toEqual(['PAYMENT_GATEWAY']);
    expect(configError.message).toContain('PAYMENT_GATEWAY');
    expect(configError.message).not.toContain(unknown);
  });

  // T168 (review finding SEC-1): a stand-in confirms whatever it is told, so it is accepted only
  // where NODE_ENV says development or test, and refused in every other mode, not only the one
  // named `production`. The enum admits one other mode today; the rule is written as "not the two".
  const modesOutsideDevelopmentAndTest = ['production'];

  it('refuses the payment stand-in in every mode but development and test, naming PAYMENT_GATEWAY (T146, T168, R-HONEST-1)', () => {
    for (const nodeEnv of modesOutsideDevelopmentAndTest) {
      let failure: unknown;
      try {
        loadConfig({ ...validEnv, NODE_ENV: nodeEnv });
      } catch (error: unknown) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ConfigError);
      // Beside the other stand-ins' keys (T153), which such a configuration also refuses.
      expect((failure as ConfigError).offendingKeys).toContain('PAYMENT_GATEWAY');
      expect((failure as ConfigError).message).toMatch(/PAYMENT_GATEWAY \(the stand-in gateway/);
    }

    for (const nodeEnv of ['development', 'test']) {
      expect(loadConfig({ ...validEnv, NODE_ENV: nodeEnv }).PAYMENT_GATEWAY).toBe('fake');
    }
  });

  // T153 (FR-056): the video, push and messaging stand-ins are refused as the payment one is
  // (T146), each on its own key, in every mode but development and test (T168). While every key's
  // only member is `fake`, such a configuration also carries PAYMENT_GATEWAY's refusal, so each case
  // asserts its key is among the offending ones; development and test accept every stand-in.
  // T001 (Phase 1) adds the sign-in and email selectors to the same rule (contracts/ports.md).
  it.each([
    'VIDEO_PROVIDER',
    'PUSH_PROVIDER',
    'SMS_PROVIDER',
    'SIGN_IN_PROVIDER',
    'EMAIL_PROVIDER',
  ])(
    'refuses %s=fake in every mode but development and test, naming the key (T153, T168, T001)',
    (key) => {
      for (const nodeEnv of modesOutsideDevelopmentAndTest) {
        for (const value of [{ [key]: 'fake' }, {}]) {
          let failure: unknown;
          try {
            loadConfig({ ...validEnv, NODE_ENV: nodeEnv, ...value });
          } catch (error: unknown) {
            failure = error;
          }
          expect(failure).toBeInstanceOf(ConfigError);
          expect((failure as ConfigError).offendingKeys).toContain(key);
          expect((failure as ConfigError).message).toMatch(new RegExp(`${key} \\(the stand-in`));
        }
      }

      for (const nodeEnv of ['development', 'test']) {
        const config = loadConfig({ ...validEnv, NODE_ENV: nodeEnv, [key]: 'fake' });
        expect(
          config[
            key as
              | 'VIDEO_PROVIDER'
              | 'PUSH_PROVIDER'
              | 'SMS_PROVIDER'
              | 'SIGN_IN_PROVIDER'
              | 'EMAIL_PROVIDER'
          ],
        ).toBe('fake');
      }
    },
  );

  // T168 (review finding SEC-1): a configuration copied onto a server without NODE_ENV used to
  // default to development, where every stand-in is accepted. There is no default now.
  it('refuses a configuration without NODE_ENV, naming it, and one naming a mode it does not know', () => {
    let failure: unknown;
    try {
      loadConfig(without(validEnv, 'NODE_ENV'));
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConfigError);
    expect((failure as ConfigError).offendingKeys).toEqual(['NODE_ENV']);
    expect((failure as ConfigError).message).toMatch(/NODE_ENV/);

    expect(() => loadConfig({ ...validEnv, NODE_ENV: '' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'staging' })).not.toThrow(/staging/);
  });
});

describe('loadConfig (T015, FR-039)', () => {
  it('parses a valid environment', () => {
    const config = loadConfig(validEnv);

    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(3000);
    expect(config.DATABASE_URL).toBe(validEnv['DATABASE_URL']);
    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.PAYMENT_GATEWAY).toBe('fake');
  });

  it('passes with every provider variable unset, so the suite needs no credential (FR-054)', () => {
    const config = loadConfig(
      without(
        validEnv,
        'PAYMENT_GATEWAY_API_KEY',
        'PAYMENT_GATEWAY_WEBHOOK_SECRET',
        'DAILY_API_KEY',
        'DAILY_WEBHOOK_SECRET',
        'SMS_PROVIDER_KEY',
        'EXPO_ACCESS_TOKEN',
        'S3_ACCESS_KEY_ID',
        'SENTRY_DSN',
        'PUBLIC_WEBHOOK_ORIGIN',
        'GOOGLE_CLIENT_IDS',
        'APPLE_CLIENT_ID',
        'APPLE_TEAM_ID',
        'APPLE_KEY_ID',
        'APPLE_PRIVATE_KEY',
      ),
    );

    expect(config.PAYMENT_GATEWAY_API_KEY).toBeUndefined();
    expect(config.DAILY_WEBHOOK_SECRET).toBeUndefined();
    expect(config.GOOGLE_CLIENT_IDS).toBeUndefined();
    expect(config.APPLE_PRIVATE_KEY).toBeUndefined();
  });

  it('applies the declared defaults when a defaulted value is absent', () => {
    // NODE_ENV has no default (T168): it is in `validEnv` and stays.
    const config = loadConfig(
      without(validEnv, 'PORT', 'LOG_LEVEL', 'STORAGE_DRIVER', 'STORAGE_LOCAL_ROOT'),
    );

    expect(config.NODE_ENV).toBe('test');
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.STORAGE_LOCAL_ROOT).toBe('.storage');
  });

  it('treats an empty value as unset, as a copied .env.example leaves it', () => {
    const config = loadConfig({ ...validEnv, SENTRY_DSN: '', DAILY_API_KEY: '' });

    expect(config.SENTRY_DSN).toBeUndefined();
    expect(config.DAILY_API_KEY).toBeUndefined();
  });

  it('requires ENCRYPTION_KEY in every environment, development included, naming it', () => {
    for (const nodeEnv of ['development', 'test', 'production']) {
      const env = without({ ...validEnv, NODE_ENV: nodeEnv }, 'ENCRYPTION_KEY');

      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow(/ENCRYPTION_KEY/);
    }
  });

  it('refuses an ENCRYPTION_KEY that is not 32 bytes of base64, naming it', () => {
    const shortKey = Buffer.alloc(16).toString('base64');

    expect(() => loadConfig({ ...validEnv, ENCRYPTION_KEY: shortKey })).toThrow(/ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...validEnv, ENCRYPTION_KEY: 'not base64!' })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  // T155: the previous key, held only while a rotation runs.
  it('accepts no ENCRYPTION_KEY_PREVIOUS, or an empty one, as no rotation running', () => {
    expect(loadConfig(validEnv).ENCRYPTION_KEY_PREVIOUS).toBeUndefined();
    expect(
      loadConfig({ ...validEnv, ENCRYPTION_KEY_PREVIOUS: '' }).ENCRYPTION_KEY_PREVIOUS,
    ).toBeUndefined();
  });

  it('carries an ENCRYPTION_KEY_PREVIOUS of 32 bytes of base64 beside ENCRYPTION_KEY', () => {
    const previous = Buffer.alloc(32, 9).toString('base64');
    const config = loadConfig({ ...validEnv, ENCRYPTION_KEY_PREVIOUS: previous });

    expect(config.ENCRYPTION_KEY_PREVIOUS).toBe(previous);
    expect(config.ENCRYPTION_KEY).toBe(thirtyTwoBytesBase64);
  });

  it('refuses an ENCRYPTION_KEY_PREVIOUS that is not 32 bytes of base64, naming it', () => {
    const shortKey = Buffer.alloc(16).toString('base64');

    expect(() => loadConfig({ ...validEnv, ENCRYPTION_KEY_PREVIOUS: shortKey })).toThrow(
      /ENCRYPTION_KEY_PREVIOUS/,
    );
    expect(() => loadConfig({ ...validEnv, ENCRYPTION_KEY_PREVIOUS: 'not base64!' })).toThrow(
      /ENCRYPTION_KEY_PREVIOUS/,
    );
  });

  it('refuses an ENCRYPTION_KEY_PREVIOUS that shares the key id of ENCRYPTION_KEY, echoing neither', () => {
    const current = validEnv['ENCRYPTION_KEY'] ?? '';
    // A key id is one byte, so a few thousand candidate keys hold one that shares it.
    const shared = [...Array(4096).keys()]
      .map((counter) => {
        const key = Buffer.alloc(32);
        key.writeUInt32BE(counter + 1);
        return key.toString('base64');
      })
      .find((key) => columnKeyId(key) === columnKeyId(current));
    let message = '';
    try {
      loadConfig({ ...validEnv, ENCRYPTION_KEY_PREVIOUS: shared ?? current });
    } catch (error: unknown) {
      message = String(error);
    }

    expect(shared).toBeDefined();
    expect(message).toMatch(/ENCRYPTION_KEY_PREVIOUS/);
    expect(message).toMatch(/key id/);
    expect(message).not.toContain(current);
    expect(message).not.toContain(shared);
    expect(() => loadConfig({ ...validEnv, ENCRYPTION_KEY_PREVIOUS: current })).toThrow(/key id/);
  });

  it('refuses a malformed PORT, naming it', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('refuses a missing runtime DATABASE_URL, naming it', () => {
    expect(() => loadConfig(without(validEnv, 'DATABASE_URL'))).toThrow(/DATABASE_URL/);
  });

  it('never carries the owner connection string into the runtime (research R-5)', () => {
    const config = loadConfig(validEnv);

    expect(config).not.toHaveProperty('DATABASE_URL_OWNER');
    expect(JSON.stringify(config)).not.toContain('ijazah_owner');
  });

  it('starts without DATABASE_URL_OWNER, which only db:migrate and the pipeline carry', () => {
    expect(() => loadConfig(without(validEnv, 'DATABASE_URL_OWNER'))).not.toThrow();
  });

  describe('the runtime URL never carries the owner role (research R-5)', () => {
    const ownerUrl = validEnv['DATABASE_URL_OWNER'] as string;

    it('refuses a DATABASE_URL whose username is the owner username, naming DATABASE_URL only', () => {
      const env = {
        ...validEnv,
        DATABASE_URL: 'postgresql://ijazah_owner:other@db.internal:5432/ijazah',
      };

      let message = '';
      try {
        loadConfig(env);
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toMatch(/DATABASE_URL \(/);
      expect(message).not.toMatch(/DATABASE_URL_OWNER/);
      expect(message).not.toContain('ijazah_owner');
      expect(message).not.toContain('other');
    });

    it('refuses a DATABASE_URL identical to DATABASE_URL_OWNER', () => {
      expect(() => loadConfig({ ...validEnv, DATABASE_URL: ownerUrl })).toThrow(/DATABASE_URL/);
    });

    it('accepts two URLs with different usernames', () => {
      expect(() => loadConfig(validEnv)).not.toThrow();
    });

    it('accepts any application URL when the owner URL is absent', () => {
      expect(() =>
        loadConfig({ ...without(validEnv, 'DATABASE_URL_OWNER'), DATABASE_URL: ownerUrl }),
      ).not.toThrow();
    });

    // A malformed string must surface as ConfigError, never as a raw TypeError/URIError whose crash
    // output would print the credential-bearing input (FR-039, R-SEC-2).
    function failure(env: Record<string, string>): ConfigError {
      try {
        loadConfig(env);
      } catch (error: unknown) {
        if (error instanceof ConfigError) return error;
        throw error;
      }
      throw new Error('expected loadConfig to throw');
    }

    it('reports an unparseable DATABASE_URL as ConfigError naming the key, not the value', () => {
      const error = failure({ ...validEnv, DATABASE_URL: 'garbage' });
      expect(error.offendingKeys).toEqual(['DATABASE_URL']);
      expect(error.message).not.toContain('garbage');
    });

    it('reports an unparseable DATABASE_URL_OWNER as ConfigError naming only that key', () => {
      const error = failure({ ...validEnv, DATABASE_URL_OWNER: 'garbage' });
      expect(error.offendingKeys).toEqual(['DATABASE_URL_OWNER']);
      expect(error.message).not.toContain('garbage');
    });

    it('survives a username that is not valid percent-encoding', () => {
      const badUser = 'postgresql://%zz:secret@localhost:5432/ijazah';
      expect(() => loadConfig({ ...validEnv, DATABASE_URL: badUser })).not.toThrow(URIError);
      let message = '';
      try {
        loadConfig({ ...validEnv, DATABASE_URL: badUser });
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toContain('secret');
    });
  });

  it('requires every S3 value when the storage driver is s3 (FR-055)', () => {
    const s3Env = { ...validEnv, STORAGE_DRIVER: 's3', S3_BUCKET: 'ijazah' };

    expect(() => loadConfig(s3Env)).toThrow(/S3_ENDPOINT/);
    expect(() => loadConfig(s3Env)).toThrow(/S3_REGION/);
    expect(() => loadConfig(s3Env)).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => loadConfig(s3Env)).toThrow(/S3_SECRET_ACCESS_KEY/);
    expect(() => loadConfig(s3Env)).not.toThrow(/S3_BUCKET/);
  });

  it('accepts API_PUBLIC_ORIGIN only as a bare origin (T095)', () => {
    expect(
      loadConfig({ ...validEnv, API_PUBLIC_ORIGIN: 'http://localhost:3000' }).API_PUBLIC_ORIGIN,
    ).toBe('http://localhost:3000');
    expect(() => loadConfig({ ...validEnv, API_PUBLIC_ORIGIN: 'http://localhost:3000/' })).toThrow(
      /API_PUBLIC_ORIGIN/,
    );
  });

  it('accepts PUBLIC_WEBHOOK_ORIGIN only as a bare origin', () => {
    expect(
      loadConfig({ ...validEnv, PUBLIC_WEBHOOK_ORIGIN: 'https://x.example' }).PUBLIC_WEBHOOK_ORIGIN,
    ).toBe('https://x.example');
    expect(() => loadConfig({ ...validEnv, PUBLIC_WEBHOOK_ORIGIN: 'https://x.example/' })).toThrow(
      /PUBLIC_WEBHOOK_ORIGIN/,
    );
    expect(() => loadConfig({ ...validEnv, PUBLIC_WEBHOOK_ORIGIN: 'x.example' })).toThrow(
      /PUBLIC_WEBHOOK_ORIGIN/,
    );
  });

  it('accepts ADMIN_PANEL_ORIGIN only as a bare origin, and leaves it unset by default (T066)', () => {
    expect(loadConfig(validEnv).ADMIN_PANEL_ORIGIN).toBeUndefined();
    expect(
      loadConfig({ ...validEnv, ADMIN_PANEL_ORIGIN: 'https://admin.example' }).ADMIN_PANEL_ORIGIN,
    ).toBe('https://admin.example');
    expect(() =>
      loadConfig({ ...validEnv, ADMIN_PANEL_ORIGIN: 'https://admin.example/set-password' }),
    ).toThrow(/ADMIN_PANEL_ORIGIN/);
  });

  it('limits a request body to 1 MiB by default, and refuses a limit that is not a positive integer (T150)', () => {
    expect(loadConfig(validEnv).MAX_REQUEST_BODY_BYTES).toBe(1_048_576);
    expect(loadConfig({ ...validEnv, MAX_REQUEST_BODY_BYTES: '2048' }).MAX_REQUEST_BODY_BYTES).toBe(
      2048,
    );
    for (const value of ['0', '-1', '1.5', 'one megabyte']) {
      expect(() => loadConfig({ ...validEnv, MAX_REQUEST_BODY_BYTES: value })).toThrow(
        /MAX_REQUEST_BODY_BYTES/,
      );
    }
  });

  // T171 (FR-052): how many deliveries the worker runs at once, a positive integer, four unless set.
  it('runs four deliveries at once by default, and refuses a concurrency that is not a positive integer (T171)', () => {
    expect(loadConfig(validEnv).QUEUE_CONCURRENCY).toBe(4);
    expect(loadConfig({ ...validEnv, QUEUE_CONCURRENCY: '8' }).QUEUE_CONCURRENCY).toBe(8);
    expect(loadConfig({ ...validEnv, QUEUE_CONCURRENCY: '' }).QUEUE_CONCURRENCY).toBe(4);
    for (const value of ['0', '-1', '1.5', 'four-workers']) {
      expect(() => loadConfig({ ...validEnv, QUEUE_CONCURRENCY: value })).toThrow(
        /QUEUE_CONCURRENCY/,
      );
    }
    expect(() => loadConfig({ ...validEnv, QUEUE_CONCURRENCY: 'four-workers' })).not.toThrow(
      /four-workers/,
    );
  });

  // T172 (R-DB-8, review finding SC-5): the pool's size and the session's two timeouts, each a
  // positive integer with a default, so no connection runs a statement or idles in a transaction
  // without a limit.
  it.each([
    ['DATABASE_POOL_MAX', 10],
    ['DATABASE_STATEMENT_TIMEOUT_MS', 30_000],
    ['DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS', 60_000],
  ] as const)(
    '%s defaults to %i, takes a positive integer, and refuses anything else naming the key (T172)',
    (key, fallback) => {
      expect(loadConfig(validEnv)[key]).toBe(fallback);
      expect(loadConfig({ ...validEnv, [key]: '' })[key]).toBe(fallback);
      expect(loadConfig({ ...validEnv, [key]: '7' })[key]).toBe(7);
      for (const value of ['0', '-1', '1.5', 'ten-ish']) {
        expect(() => loadConfig({ ...validEnv, [key]: value })).toThrow(new RegExp(key));
      }
      expect(() => loadConfig({ ...validEnv, [key]: 'ten-ish' })).not.toThrow(/ten-ish/);
    },
  );

  it('reports every offending key at once, and never a value (R-SEC-2)', () => {
    const env = without({ ...validEnv, PORT: 'abc', REDIS_URL: 'mysql://nope' }, 'ENCRYPTION_KEY');

    let message = '';
    try {
      loadConfig(env);
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/ENCRYPTION_KEY/);
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/REDIS_URL/);
    expect(message).not.toContain('abc');
    expect(message).not.toContain('mysql://nope');
    expect(message).not.toContain(thirtyTwoBytesBase64);
  });
});

// T001 — the keys Phase 1 declares (specs/002-identity: FR-145, contracts/ports.md, contracts/kernel.md).
describe('the Phase 1 keys (T001)', () => {
  function failure(env: Record<string, string>): ConfigError {
    try {
      loadConfig(env);
    } catch (error: unknown) {
      if (error instanceof ConfigError) return error;
      throw error;
    }
    throw new Error('expected loadConfig to throw');
  }

  it('requires SUPPORT_EMAIL in every mode, naming it and never a value (FR-145)', () => {
    for (const nodeEnv of ['development', 'test', 'production']) {
      const error = failure(without({ ...validEnv, NODE_ENV: nodeEnv }, 'SUPPORT_EMAIL'));
      expect(error.offendingKeys).toContain('SUPPORT_EMAIL');
    }
    expect(failure({ ...validEnv, SUPPORT_EMAIL: '' }).offendingKeys).toContain('SUPPORT_EMAIL');
    const notAnAddress = 'help-desk-7f3e';
    const error = failure({ ...validEnv, SUPPORT_EMAIL: notAnAddress });
    expect(error.offendingKeys).toEqual(['SUPPORT_EMAIL']);
    expect(error.message).not.toContain(notAnAddress);
    expect(loadConfig(validEnv).SUPPORT_EMAIL).toBe('support@ijazah.invalid');
  });

  it('refuses a SUPPORT_EMAIL or EMAIL_FROM under a reserved domain outside development and test, naming the key and never the value (T023, PR #75 follow-up 3)', () => {
    const production = { ...validEnv, NODE_ENV: 'production' };
    const error = failure(production);
    expect(error.offendingKeys).toContain('SUPPORT_EMAIL');
    expect(error.offendingKeys).toContain('EMAIL_FROM');
    expect(error.message).not.toContain('ijazah.invalid');
    for (const reserved of [
      'help@ijazah.test',
      'help@ijazah.example',
      'help@ijazah.localhost',
      'help@example.com',
      'help@mail.example.net',
      'help@example.org',
    ]) {
      expect(failure({ ...production, SUPPORT_EMAIL: reserved }).offendingKeys).toContain(
        'SUPPORT_EMAIL',
      );
    }
    const real = {
      ...production,
      SUPPORT_EMAIL: 'help@ijazah.app',
      EMAIL_FROM: 'no-reply@ijazah.app',
    };
    const remaining = failure(real).offendingKeys;
    expect(remaining).not.toContain('SUPPORT_EMAIL');
    expect(remaining).not.toContain('EMAIL_FROM');
    // Development and test keep the placeholders, as they keep the stand-ins.
    expect(loadConfig(validEnv).SUPPORT_EMAIL).toBe('support@ijazah.invalid');
    expect(loadConfig({ ...validEnv, NODE_ENV: 'development' }).EMAIL_FROM).toBe(
      'no-reply@ijazah.invalid',
    );
  });

  it('selects the sign-in and email stand-ins by default, and records a reserved sender', () => {
    const config = loadConfig(validEnv);
    expect(config.SIGN_IN_PROVIDER).toBe('fake');
    expect(config.EMAIL_PROVIDER).toBe('fake');
    expect(config.EMAIL_FROM).toBe('no-reply@ijazah.invalid');
    expect(loadConfig({ ...validEnv, EMAIL_FROM: 'codes@ijazah.invalid' }).EMAIL_FROM).toBe(
      'codes@ijazah.invalid',
    );
    const notAnAddress = 'the-platform';
    const error = failure({ ...validEnv, EMAIL_FROM: notAnAddress });
    expect(error.offendingKeys).toEqual(['EMAIL_FROM']);
    expect(error.message).not.toContain(notAnAddress);
    expect(failure({ ...validEnv, SIGN_IN_PROVIDER: 'google' }).offendingKeys).toEqual([
      'SIGN_IN_PROVIDER',
    ]);
    expect(failure({ ...validEnv, EMAIL_PROVIDER: 'acme-mail' }).offendingKeys).toEqual([
      'EMAIL_PROVIDER',
    ]);
  });

  it('reads TRUSTED_PROXY as one header name, absent or empty as none (contracts/kernel.md)', () => {
    expect(loadConfig(validEnv).TRUSTED_PROXY).toBeUndefined();
    expect(loadConfig({ ...validEnv, TRUSTED_PROXY: '' }).TRUSTED_PROXY).toBeUndefined();
    expect(loadConfig({ ...validEnv, TRUSTED_PROXY: 'X-Forwarded-For' }).TRUSTED_PROXY).toBe(
      'X-Forwarded-For',
    );
    for (const value of ['X-Forwarded-For: 203.0.113.9', 'x forwarded for', '203.0.113.9']) {
      const error = failure({ ...validEnv, TRUSTED_PROXY: value });
      expect(error.offendingKeys).toEqual(['TRUSTED_PROXY']);
      expect(error.message).not.toContain('203.0.113.9');
    }
  });

  it('reads GOOGLE_CLIENT_IDS as a list of audiences and the Apple keys as they are', () => {
    const config = loadConfig({
      ...validEnv,
      GOOGLE_CLIENT_IDS: ' one.apps.example , two.apps.example,',
      APPLE_CLIENT_ID: 'com.example.ijazah',
      APPLE_TEAM_ID: 'TEAM',
      APPLE_KEY_ID: 'KEY',
      APPLE_PRIVATE_KEY: 'apple-key-material-7f3e',
    });
    expect(config.GOOGLE_CLIENT_IDS).toEqual(['one.apps.example', 'two.apps.example']);
    expect(config.APPLE_CLIENT_ID).toBe('com.example.ijazah');
    expect(config.APPLE_PRIVATE_KEY).toBe('apple-key-material-7f3e');
    expect(failure({ ...validEnv, GOOGLE_CLIENT_IDS: ' , ' }).offendingKeys).toEqual([
      'GOOGLE_CLIENT_IDS',
    ]);
  });

  it('classifies each new key once, so the test setup strips the provider ones and none else (T114)', () => {
    for (const key of [
      'GOOGLE_CLIENT_IDS',
      'APPLE_CLIENT_ID',
      'APPLE_TEAM_ID',
      'APPLE_KEY_ID',
      'APPLE_PRIVATE_KEY',
    ]) {
      expect(providerKeys).toContain(key);
      expect(platformKeys).not.toContain(key);
    }
    for (const key of [
      'SUPPORT_EMAIL',
      'SIGN_IN_PROVIDER',
      'EMAIL_PROVIDER',
      'EMAIL_FROM',
      'TRUSTED_PROXY',
    ]) {
      expect(platformKeys).toContain(key);
      expect(providerKeys).not.toContain(key);
    }
  });
});

describe('loadConfigOrExit (T015, FR-039)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with status 1 naming the offending key, and writes nothing else', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    loadConfigOrExit(without(validEnv, 'ENCRYPTION_KEY'));

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/ENCRYPTION_KEY/);
  });

  it('returns the configuration and touches neither exit nor stderr when valid', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(loadConfigOrExit(validEnv).PORT).toBe(3000);
    expect(exit).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});

// T093 — the two processes themselves (FR-039; contracts/kernel.md "Configuration"). Each entrypoint
// is started as it is in production, with a configuration missing `ENCRYPTION_KEY` and carrying a
// malformed `PORT`: it must exit 1 naming both keys, print neither value, and write nothing to
// standard output, so nothing was logged as listening or started before the refusal. Red until the
// entrypoints call `loadConfigOrExit` first (note under T015; batch K2).
describe('the entrypoints refuse to start on an invalid configuration (T093, FR-039)', () => {
  const malformedPort = 'not-a-port-7f3e';
  const invalidEnv: Record<string, string> = {
    ...without(validEnv, 'ENCRYPTION_KEY'),
    PORT: malformedPort,
  };
  // Only what the operating system needs to start Node; nothing from the developer's own shell.
  const system: Record<string, string> = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    const value = process.env[key];
    if (value !== undefined) system[key] = value;
  }

  it.each(['apps/api/src/main.ts', 'apps/api/src/worker.ts'])(
    '%s exits 1 naming the offending keys, before anything else',
    (entrypoint) => {
      const result = spawnSync(process.execPath, ['--import', 'tsx', entrypoint], {
        cwd: repositoryRoot,
        env: { ...system, ...invalidEnv },
        encoding: 'utf8',
        timeout: 60_000,
      });

      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toMatch(/ENCRYPTION_KEY/);
      expect(result.stderr).toMatch(/PORT/);
      expect(result.stderr).not.toContain(malformedPort);
      expect(result.stdout).toBe('');
    },
  );
});
