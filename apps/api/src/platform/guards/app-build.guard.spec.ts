// R3 (002:T184; SRS DEC-99, DEC-109, §3.14 «Minimum app build admitted»; ARCHITECTURE §7.3) — the
// build floor. The phone sends its build number in `x-app-build`; a call with none is admitted (the
// panel, and builds before T184); a header that is not a whole number of 1 to 10 digits is the
// client's unreadable input, 400; a number below `min_app_build` is `UPDATE_REQUIRED`, 426. The
// floor is read only when a number came, as every setting is read (a failed read is the internal
// error, never 426), and held 60 s in the process as the limiter's default is. A refusal's first
// line per client address per hold is logged, `{ build, floor, reason }`, and every refusal is
// marked logged, so the surface's one-place refusal log writes nothing more.
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { mapError } from '../errors/error-filter.js';
import { isRefusalLogged } from '../errors/logged-refusal.js';
import { createLogger } from '../logging/logger.js';
import { SettingError, type SettingsReader } from '../settings/settings-reader.js';
import {
  admitAppBuild,
  APP_BUILD_FLOOR_HOLD_MS,
  APP_BUILD_HEADER,
  APP_BUILD_REFUSALS_LOGGED_MAX,
  AppBuildGate,
  readAppBuild,
  requireAdmittedBuild,
} from './app-build.guard.js';

/** A settings reader holding `min_app_build` at `floor`, counting its reads; `floor` may change. */
function floorAt(floor: number): { floor: number; reads: number; settings: SettingsReader } {
  const store: { floor: number; reads: number; settings: SettingsReader } = {
    floor,
    reads: 0,
    settings: {
      read: async (key, schema) => {
        store.reads += 1;
        if (key !== 'min_app_build') throw new SettingError(key, 'missing');
        return schema.parse(store.floor);
      },
    },
  };
  return store;
}

/** A logger writing into `lines`, each parsed. */
function capture(bindings: Record<string, string> = {}) {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const log = createLogger({
    level: 'info',
    destination: {
      write: (line: string) => {
        raw.push(line);
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  }).child(bindings);
  return { log, lines, raw };
}

/** A record's own fields: without pino's and the bindings'. */
function fieldsOf(line: Record<string, unknown>): Record<string, unknown> {
  const own = { ...line };
  for (const key of ['level', 'time', 'pid', 'hostname', 'msg', 'clientAddress']) delete own[key];
  return own;
}

async function refusalOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('the build was expected to be refused');
}

const address = '203.0.113.7';

describe('the header (002:T184)', () => {
  it('is x-app-build', () => {
    expect(APP_BUILD_HEADER).toBe('x-app-build');
  });

  it('reads an absent header as no build', () => {
    expect(readAppBuild({})).toBeNull();
  });

  it.each([
    ['0', 0],
    ['42', 42],
    ['007', 7],
    ['1234567890', 1_234_567_890],
  ])('reads %j as the build %i', (value, build) => {
    expect(readAppBuild({ [APP_BUILD_HEADER]: value })).toBe(build);
  });

  it.each(['', '-1', '1.5', 'abc', '12345678901', '+1', ' 12', '1e3', '0x1F', '12, 13'])(
    'reads %j as invalid',
    (value) => {
      expect(readAppBuild({ [APP_BUILD_HEADER]: value })).toBe('invalid');
    },
  );

  it('reads more than one value as invalid', () => {
    expect(readAppBuild({ [APP_BUILD_HEADER]: ['12', '13'] })).toBe('invalid');
  });
});

describe('the floor (002:T184)', () => {
  it('admits no build without reading the floor, even when the read would fail', async () => {
    const failing: SettingsReader = {
      read: async (key) => {
        throw new SettingError(key, 'missing');
      },
    };
    const { log } = capture();
    await expect(
      new AppBuildGate({ settings: failing }).admit(null, { log, clientAddress: address }),
    ).resolves.toBeUndefined();
  });

  it('admits a build equal to the floor, and one above it', async () => {
    const store = floorAt(100);
    const gate = new AppBuildGate({ settings: store.settings });
    const { log } = capture();
    await expect(gate.admit(100, { log, clientAddress: address })).resolves.toBeUndefined();
    await expect(gate.admit(101, { log, clientAddress: address })).resolves.toBeUndefined();
  });

  it('refuses a build below the floor UPDATE_REQUIRED, 426 in the one shape', async () => {
    const gate = new AppBuildGate({ settings: floorAt(100).settings });
    const { log } = capture();
    const error = await refusalOf(gate.admit(99, { log, clientAddress: address }));
    expect(error).toBeInstanceOf(DomainError);
    expect(mapError(error)).toEqual({
      status: 426,
      body: { code: 'UPDATE_REQUIRED', message: 'Update the app to continue.' },
      unexpected: false,
    });
  });

  it('admits every build at floor 0', async () => {
    const gate = new AppBuildGate({ settings: floorAt(0).settings });
    const { log } = capture();
    for (const build of [0, 1, 9_999_999_999]) {
      await expect(gate.admit(build, { log, clientAddress: address })).resolves.toBeUndefined();
    }
  });

  it('refuses an invalid header VALIDATION_FAILED, 400, without reading the floor', async () => {
    const store = floorAt(0);
    const gate = new AppBuildGate({ settings: store.settings });
    const { log } = capture();
    const error = await refusalOf(gate.admit('invalid', { log, clientAddress: address }));
    expect(mapError(error)).toEqual({
      status: 400,
      body: { code: 'VALIDATION_FAILED', message: 'The request is not valid.' },
      unexpected: false,
    });
    expect(store.reads).toBe(0);
  });

  it('answers a failed read as the internal error, never 426, and holds nothing', async () => {
    let reads = 0;
    const failing: SettingsReader = {
      read: async (key) => {
        reads += 1;
        throw new SettingError(key, 'missing');
      },
    };
    const gate = new AppBuildGate({ settings: failing, monotonicNow: () => 0 });
    const { log } = capture();
    const error = await refusalOf(gate.admit(1, { log, clientAddress: address }));
    expect(error).toBeInstanceOf(SettingError);
    expect(mapError(error).status).toBe(500);
    expect(mapError(error).body.code).toBe('INTERNAL');
    await refusalOf(gate.admit(1, { log, clientAddress: address }));
    expect(reads).toBe(2);
  });
});

describe('the hold (002:T184; the limiter’s default, rate-limit.guard.ts)', () => {
  it('is 60 s', () => {
    expect(APP_BUILD_FLOOR_HOLD_MS).toBe(60_000);
  });

  it('does not see a changed floor within 60 s, and sees it at 60 s', async () => {
    let now = 0;
    const store = floorAt(10);
    const gate = new AppBuildGate({ settings: store.settings, monotonicNow: () => now });
    const { log } = capture();
    await gate.admit(15, { log, clientAddress: address });
    store.floor = 20;
    now = APP_BUILD_FLOOR_HOLD_MS - 1;
    await expect(gate.admit(15, { log, clientAddress: address })).resolves.toBeUndefined();
    expect(store.reads).toBe(1);
    now = APP_BUILD_FLOOR_HOLD_MS;
    const error = await refusalOf(gate.admit(15, { log, clientAddress: address }));
    expect(mapError(error).body.code).toBe('UPDATE_REQUIRED');
    expect(store.reads).toBe(2);
  });
});

describe('the refusal’s log (002:T184; the first per client address per hold)', () => {
  it('logs the first refusal of an address once: { build, floor, reason }, the address as its network', async () => {
    const gate = new AppBuildGate({ settings: floorAt(10).settings, monotonicNow: () => 0 });
    const { log, lines, raw } = capture({ clientAddress: address });
    const first = await refusalOf(gate.admit(5, { log, clientAddress: address }));
    expect(lines).toHaveLength(1);
    expect(fieldsOf(lines[0] as Record<string, unknown>)).toEqual({
      build: 5,
      floor: 10,
      reason: 'build_below_floor',
    });
    expect(lines[0]?.['level']).toBe('info');
    expect(raw.join('')).not.toContain(address);
    expect(isRefusalLogged(first)).toBe(true);
  });

  it('logs nothing for a later refusal of the same address in the hold, still marked logged', async () => {
    const gate = new AppBuildGate({ settings: floorAt(10).settings, monotonicNow: () => 0 });
    const { log, lines } = capture();
    await refusalOf(gate.admit(5, { log, clientAddress: address }));
    const later = await refusalOf(gate.admit(6, { log, clientAddress: address }));
    expect(lines).toHaveLength(1);
    expect(isRefusalLogged(later)).toBe(true);
  });

  it('logs the first refusal of another address, and the same address again after the hold', async () => {
    let now = 0;
    const gate = new AppBuildGate({ settings: floorAt(10).settings, monotonicNow: () => now });
    const { log, lines } = capture();
    await refusalOf(gate.admit(5, { log, clientAddress: address }));
    await refusalOf(gate.admit(5, { log, clientAddress: '198.51.100.9' }));
    expect(lines).toHaveLength(2);
    now = APP_BUILD_FLOOR_HOLD_MS;
    await refusalOf(gate.admit(5, { log, clientAddress: address }));
    expect(lines).toHaveLength(3);
  });

  it('logs no admitted build and no invalid header (the surface logs that one)', async () => {
    const gate = new AppBuildGate({ settings: floorAt(10).settings, monotonicNow: () => 0 });
    const { log, lines } = capture();
    await gate.admit(10, { log, clientAddress: address });
    const invalid = await refusalOf(gate.admit('invalid', { log, clientAddress: address }));
    expect(lines).toEqual([]);
    expect(isRefusalLogged(invalid)).toBe(false);
  });

  it('remembers at most APP_BUILD_REFUSALS_LOGGED_MAX addresses in a hold, then logs no new one', async () => {
    const gate = new AppBuildGate({ settings: floorAt(10).settings, monotonicNow: () => 0 });
    const { log, lines } = capture();
    for (let n = 0; n < APP_BUILD_REFUSALS_LOGGED_MAX; n += 1) {
      await refusalOf(gate.admit(5, { log, clientAddress: `a-${String(n)}` }));
    }
    expect(lines).toHaveLength(APP_BUILD_REFUSALS_LOGGED_MAX);
    await refusalOf(gate.admit(5, { log, clientAddress: 'one-more' }));
    expect(lines).toHaveLength(APP_BUILD_REFUSALS_LOGGED_MAX);
  });
});

describe('one gate per settings reader: what the kinds and the upload route share (002:T184)', () => {
  it('admitAppBuild holds the floor of one reader across calls', async () => {
    const store = floorAt(10);
    const { log } = capture();
    await admitAppBuild(10, { settings: store.settings, log, clientAddress: address });
    await admitAppBuild(11, { settings: store.settings, log, clientAddress: address });
    expect(store.reads).toBe(1);
    const error = await refusalOf(
      admitAppBuild(9, { settings: store.settings, log, clientAddress: address }),
    );
    expect(mapError(error).body.code).toBe('UPDATE_REQUIRED');
  });
});

describe('requireAdmittedBuild, the kinds’ middleware (002:T184)', () => {
  function call(appBuild: number | null | 'invalid', floor: number) {
    const { log } = capture();
    const next = vi.fn(async () => ({ ok: true }) as const);
    const ctx = {
      appBuild,
      services: { settings: floorAt(floor).settings },
      log,
      clientAddress: address,
    };
    return { run: () => requireAdmittedBuild({ ctx, next }), next };
  }

  it('goes on to the next middleware for an admitted build and for no header', async () => {
    for (const [build, floor] of [
      [null, 10],
      [10, 10],
    ] as const) {
      const { run, next } = call(build, floor);
      await expect(run()).resolves.toEqual({ ok: true });
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it('refuses before the next middleware: a build below the floor, an invalid header', async () => {
    for (const [build, code] of [
      [9, 'UPDATE_REQUIRED'],
      ['invalid', 'VALIDATION_FAILED'],
    ] as const) {
      const { run, next } = call(build, 10);
      expect(mapError(await refusalOf(run())).body.code).toBe(code);
      expect(next).not.toHaveBeenCalled();
    }
  });
});
