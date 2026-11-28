// R3 T183: the panel's build and its source maps (Q-5 (a), `r3\research\build-ops.md` §1). Only a
// build that holds `SENTRY_AUTH_TOKEN` writes maps, and then hidden ones (no `sourceMappingURL` in
// the bundle), which Sentry's plugin, the last one, uploads to the EU region's `ijazah-admin` project
// and deletes from `build/`, so the host never serves the panel's source. Without the token there is
// no plugin and no map at all.
//
// No case calls Sentry: the plugin is a recording stand-in.
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sentryBuild } from '../vite.config';

vi.mock('@sentry/vite-plugin', () => ({
  sentryVitePlugin: vi.fn(() => [{ name: 'sentry-stand-in' }]),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(sentryVitePlugin).mockClear();
});

describe('the panel’s build', () => {
  it('writes no source map and adds no plugin without SENTRY_AUTH_TOKEN', () => {
    expect(sentryBuild({})).toEqual({ plugins: [], sourcemap: false });
    expect(sentryBuild({ SENTRY_AUTH_TOKEN: '' })).toEqual({ plugins: [], sourcemap: false });
    expect(sentryVitePlugin).not.toHaveBeenCalled();
  });

  it('with the token, writes hidden maps that the plugin uploads to the EU project and deletes', () => {
    const build = sentryBuild({ SENTRY_AUTH_TOKEN: 'token-stand-in', SENTRY_ORG: 'org-stand-in' });
    expect(build.sourcemap).toBe('hidden');
    expect(build.plugins).toEqual([{ name: 'sentry-stand-in' }]);
    expect(sentryVitePlugin).toHaveBeenCalledWith({
      url: 'https://de.sentry.io/',
      org: 'org-stand-in',
      project: 'ijazah-admin',
      authToken: 'token-stand-in',
      telemetry: false,
      sourcemaps: { filesToDeleteAfterUpload: ['./build/**/*.map'] },
    });
  });

  it('puts Sentry’s plugin last among the plugins, and the maps in the build', async () => {
    vi.stubEnv('SENTRY_AUTH_TOKEN', 'token-stand-in');
    vi.resetModules();
    const { default: config } = await import('../vite.config');
    expect(config.plugins?.at(-1)).toEqual({ name: 'sentry-stand-in' });
    expect(config.build?.sourcemap).toBe('hidden');
  });
});
