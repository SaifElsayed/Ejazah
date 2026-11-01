// T124: the one gate every database spec passes through. Its whole effect on a run is proven end to
// end by tests/pipeline/database-spec-gate.spec.ts; these cases hold its rules one by one.
import { describe, expect, it, vi } from 'vitest';

import {
  DATABASE_SPECS_VARIABLE,
  DATABASE_TAG,
  databaseSpecsEnabled,
  databaseTag,
  DatabaseSpecsOff,
  specDatabaseUrl,
  whenDatabaseSpecs,
} from './spec-database.fixtures.js';

const URL = 'postgresql://ijazah_app:spec@127.0.0.1:1/ijazah';

describe('the variable', () => {
  it('is IJAZAH_DB_SPECS, and only the value 1 turns the database specs on', () => {
    expect(DATABASE_SPECS_VARIABLE).toBe('IJAZAH_DB_SPECS');
    expect(databaseSpecsEnabled({ IJAZAH_DB_SPECS: '1' })).toBe(true);
    for (const value of [undefined, '', '0', 'true', 'yes', ' 1']) {
      expect(databaseSpecsEnabled({ IJAZAH_DB_SPECS: value })).toBe(false);
    }
  });

  it('is the only thing that decides, never a database URL or its name', () => {
    expect(databaseSpecsEnabled({ DATABASE_URL: URL })).toBe(false);
    expect(databaseSpecsEnabled({ DATABASE_URL: URL.replace('ijazah', 'ijazah_integrity') })).toBe(
      false,
    );
  });
});

describe('the tag', () => {
  it('skips every spec carrying it unless the variable is on', () => {
    expect(DATABASE_TAG).toBe('database');
    expect(databaseTag({})).toMatchObject({ name: 'database', skip: true });
    expect(databaseTag({ IJAZAH_DB_SPECS: '1' })).toMatchObject({ name: 'database', skip: false });
  });
});

describe('the database URL a spec connects with', () => {
  it('is refused while the variable is off, even when the environment carries one', () => {
    expect(() => specDatabaseUrl('DATABASE_URL', { DATABASE_URL: URL })).toThrow(DatabaseSpecsOff);
    expect(() => specDatabaseUrl('DATABASE_URL_OWNER', { DATABASE_URL_OWNER: URL })).toThrow(
      /IJAZAH_DB_SPECS=1/,
    );
  });

  it("is the environment's once the variable is on", () => {
    expect(specDatabaseUrl('DATABASE_URL', { IJAZAH_DB_SPECS: '1', DATABASE_URL: URL })).toBe(URL);
  });

  it('is refused, naming it, when the variable is on and the environment lacks it (never .env)', () => {
    for (const value of [undefined, '']) {
      expect(() =>
        specDatabaseUrl('DATABASE_URL_OWNER', { IJAZAH_DB_SPECS: '1', DATABASE_URL_OWNER: value }),
      ).toThrow(/DATABASE_URL_OWNER is not set in the environment.*ijazah_integrity/s);
    }
  });
});

describe('a connection opened for a spec', () => {
  it('is not opened while the variable is off, and its stand-in refuses every use', () => {
    const open = vi.fn(() => ({ query: () => 'opened' }));
    const database = whenDatabaseSpecs(open, {});
    expect(open).not.toHaveBeenCalled();
    expect(() => database.query()).toThrow(DatabaseSpecsOff);
  });

  it('is opened once the variable is on', () => {
    const opened = { query: () => 'opened' };
    expect(whenDatabaseSpecs(() => opened, { IJAZAH_DB_SPECS: '1' })).toBe(opened);
  });
});
