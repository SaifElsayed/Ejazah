// R3 T182 (Q-4 (a); the note under T182, (4)): the app's dynamic configuration is `app.json`'s
// with one addition. The Firebase file of the push set-up is never committed; EAS hands its path
// to the build as the file variable `GOOGLE_SERVICES_JSON`, and only then does the configuration
// name it (`android.googleServicesFile`). Without the variable the configuration is `app.json`'s
// as it stands, so a development run and a build without the file never point at a missing file.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ExpoConfig } from 'expo/config';

import app from '../../app.json';

type AppConfig = (context: { readonly config: ExpoConfig }) => ExpoConfig;

const VARIABLE = 'GOOGLE_SERVICES_JSON';
const FILE = '/home/expo/workingdir/build/google-services.json';

/** `app.json`'s configuration, as Expo hands it to the dynamic configuration. */
const staticConfig = (): ExpoConfig => JSON.parse(JSON.stringify(app.expo)) as ExpoConfig;

function load(): AppConfig {
  let loaded: AppConfig | undefined;
  jest.isolateModules(() => {
    loaded = require('../../app.config.js') as AppConfig;
  });
  if (loaded === undefined) throw new Error('not loaded');
  return loaded;
}

let before: string | undefined;

beforeEach(() => {
  before = process.env[VARIABLE];
  delete process.env[VARIABLE];
});

afterEach(() => {
  if (before === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = before;
});

describe('the app configuration', () => {
  it('is app.json’s as it stands, naming no Firebase file, without the variable', () => {
    const config = load()({ config: staticConfig() });
    expect(config).toEqual(staticConfig());
    expect(config.android?.googleServicesFile).toBeUndefined();
  });

  it('names no Firebase file when the variable is empty', () => {
    process.env[VARIABLE] = '';
    const config = load()({ config: staticConfig() });
    expect(config.android?.googleServicesFile).toBeUndefined();
  });

  it('names the file EAS hands over, and keeps the rest of app.json, with the variable', () => {
    process.env[VARIABLE] = FILE;
    const config = load()({ config: staticConfig() });
    expect(config.android?.googleServicesFile).toBe(FILE);
    const { googleServicesFile: _file, ...android } = config.android ?? {};
    expect({ ...config, android }).toEqual(staticConfig());
  });
});
