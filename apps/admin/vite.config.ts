import { sentryVitePlugin } from '@sentry/vite-plugin';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, type PluginOption } from 'vite';

// R3 T183 (Q-5 (a), `r3\research\build-ops.md` §1): source maps for the panel's crash reports. Only
// a build that holds `SENTRY_AUTH_TOKEN` (the panel's build on the host, never a development server
// or a test) writes them, hidden (no `sourceMappingURL` in the bundle), and Sentry's plugin, the
// last one, uploads them to the EU region's `ijazah-admin` project under `SENTRY_ORG` and deletes
// them from `build/`, so the host never serves the panel's source. Without the token there is no
// plugin and no map. The plugin's own telemetry to Sentry is off.
const SENTRY_URL = 'https://de.sentry.io/';
const SENTRY_PROJECT = 'ijazah-admin';
const BUILT_MAPS = './build/**/*.map';

export interface SentryBuild {
  readonly plugins: PluginOption[];
  readonly sourcemap: 'hidden' | false;
}

/** Sentry's part of the build, from the build machine's environment. */
export function sentryBuild(env: Readonly<Record<string, string | undefined>>): SentryBuild {
  const authToken = env['SENTRY_AUTH_TOKEN'];
  if (authToken === undefined || authToken === '') return { plugins: [], sourcemap: false };
  const org = env['SENTRY_ORG'];
  return {
    plugins: sentryVitePlugin({
      url: SENTRY_URL,
      ...(org === undefined || org === '' ? {} : { org }),
      project: SENTRY_PROJECT,
      authToken,
      telemetry: false,
      sourcemaps: { filesToDeleteAfterUpload: [BUILT_MAPS] },
    }),
    sourcemap: 'hidden',
  };
}

const sentry = sentryBuild(process.env);

export default defineConfig({
  plugins: [react(), ...sentry.plugins],
  // B8 (watch line under T018): `@ijazah/contracts` publishes its TypeScript source under the
  // `@ijazah/source` condition and its build under `dist/`, which nothing builds before the panel
  // does; naming the condition beside Vite's defaults resolves the source, as Vitest does.
  resolve: { conditions: ['@ijazah/source', ...defaultClientConditions] },
  server: { port: 5173 },
  // `tsc --build` owns `dist/` for this project's declarations and build info, and `vite build`
  // empties whatever directory it is given. The bundle therefore goes to `build/`, which
  // `.gitignore` already excludes, so the two outputs never fight over one directory.
  build: { outDir: 'build', sourcemap: sentry.sourcemap },
});
