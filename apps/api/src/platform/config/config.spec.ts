import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig, loadConfigOrExit } from './config.module.js';
import { envKeys } from './env.schema.js';

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

  it('refuses the payment stand-in in production only, naming PAYMENT_GATEWAY (T146, R-HONEST-1)', () => {
    let failure: unknown;
    try {
      loadConfig({ ...validEnv, NODE_ENV: 'production' });
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConfigError);
    expect((failure as ConfigError).offendingKeys).toEqual(['PAYMENT_GATEWAY']);

    for (const nodeEnv of ['development', 'test']) {
      expect(loadConfig({ ...validEnv, NODE_ENV: nodeEnv }).PAYMENT_GATEWAY).toBe('fake');
    }
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
      ),
    );

    expect(config.PAYMENT_GATEWAY_API_KEY).toBeUndefined();
    expect(config.DAILY_WEBHOOK_SECRET).toBeUndefined();
  });

  it('applies the declared defaults when a defaulted value is absent', () => {
    const config = loadConfig(
      without(validEnv, 'NODE_ENV', 'PORT', 'LOG_LEVEL', 'STORAGE_DRIVER', 'STORAGE_LOCAL_ROOT'),
    );

    expect(config.NODE_ENV).toBe('development');
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
