// T113 — the admin module reads settings for the whole system (FR-034, R-MONEY-12, R-PROC-11).
//
// Every operational number is read from the `settings` table, through the kernel's
// `SettingsReader`, and never replaced by a constant: a key that is not there, or whose value does
// not match what the caller expects, throws `SettingError`. Nothing is cached, so a change made in
// the admin panel applies to the next read (SRS §3.14, prospective changes). The store is a fake
// here; the query is one `findUnique` in `settings.repository.ts`.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SettingError } from '../../platform/settings/settings-reader.js';
import { SettingsService, type StoredSettings } from './settings.service.js';

function storeOf(values: Record<string, unknown>) {
  const reads: string[] = [];
  const store: StoredSettings = {
    valueOf: async (key) => {
      reads.push(key);
      return Object.hasOwn(values, key) ? values[key] : undefined;
    },
  };
  return { store, reads, values };
}

const hours = z.number().int().positive();

describe('reading a setting (T113)', () => {
  it('answers the stored value, as the caller’s schema reads it', async () => {
    const { store } = storeOf({ idempotency_key_ttl_hours: 24 });
    await expect(new SettingsService(store).read('idempotency_key_ttl_hours', hours)).resolves.toBe(
      24,
    );
  });

  it('fails closed on a key that is not stored, naming the key', async () => {
    const { store } = storeOf({});
    const failure = await new SettingsService(store)
      .read('idempotency_key_ttl_hours', hours)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SettingError);
    expect(failure).toMatchObject({ key: 'idempotency_key_ttl_hours', problem: 'missing' });
  });

  it('fails closed on a value the schema refuses, and never echoes the value', async () => {
    const { store } = storeOf({ idempotency_key_ttl_hours: 'twenty-four' });
    const failure = await new SettingsService(store)
      .read('idempotency_key_ttl_hours', hours)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ key: 'idempotency_key_ttl_hours', problem: 'invalid' });
    expect(String((failure as Error).message)).not.toContain('twenty-four');
  });

  it('fails closed on a stored JSON null rather than reading it as no limit', async () => {
    const { store } = storeOf({ idempotency_key_ttl_hours: null });
    await expect(
      new SettingsService(store).read('idempotency_key_ttl_hours', hours),
    ).rejects.toMatchObject({ problem: 'invalid' });
  });

  it('reads the store every time, so a change applies to the next read', async () => {
    const { store, reads, values } = storeOf({ idempotency_key_ttl_hours: 24 });
    const settings = new SettingsService(store);
    await expect(settings.read('idempotency_key_ttl_hours', hours)).resolves.toBe(24);
    values['idempotency_key_ttl_hours'] = 48;
    await expect(settings.read('idempotency_key_ttl_hours', hours)).resolves.toBe(48);
    expect(reads).toEqual(['idempotency_key_ttl_hours', 'idempotency_key_ttl_hours']);
  });
});
