// T113 — the kernel's view of settings: an interface, a typed failure, and the startup refusal
// (FR-034, R-MONEY-12, R-API-4).
//
// The kernel reads settings without importing `modules/admin`, so all it owns is the contract. A
// read that cannot be answered fails closed with `SettingError`, which the error filter answers as
// the internal error, so it is logged and reported rather than replaced by a constant. A process
// with no reader bound refuses to start.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mapError } from '../errors/error-filter.js';
import {
  requireSettingsReader,
  SettingError,
  type SettingsReader,
  SettingsReaderUnboundError,
} from './settings-reader.js';

const reader: SettingsReader = {
  read: async () => {
    throw new SettingError('idempotency_key_ttl_hours', 'missing');
  },
};

describe('the settings reader contract (T113)', () => {
  it('lets a process start only with a reader bound', () => {
    expect(requireSettingsReader(reader)).toBe(reader);
    expect(() => requireSettingsReader(undefined)).toThrow(SettingsReaderUnboundError);
    expect(() => requireSettingsReader(undefined)).toThrow(/FR-034/);
  });

  it('names the key and what is wrong with it, and nothing of a value', () => {
    const missing = new SettingError('idempotency_key_ttl_hours', 'missing');
    const invalid = new SettingError('slot_hold_ttl_minutes', 'invalid');
    expect(missing).toMatchObject({ key: 'idempotency_key_ttl_hours', problem: 'missing' });
    expect(missing.message).toContain('"idempotency_key_ttl_hours" is missing');
    expect(invalid.message).toContain('"slot_hold_ttl_minutes" is invalid');
  });

  it('fails closed: a setting that cannot be read is the internal error, never a default', async () => {
    const failure = await reader
      .read('idempotency_key_ttl_hours', z.number())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SettingError);
    expect(mapError(failure)).toMatchObject({ status: 500, unexpected: true });
  });
});
