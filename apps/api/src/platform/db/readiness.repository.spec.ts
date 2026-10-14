// T110 — the readiness probe's one query (FR-051). No database is needed to prove the half that
// matters to the probe: when nothing answers, the check rejects, within the connection timeout,
// so the controller can answer 503 instead of hanging.
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, type Database, openDatabase } from './prisma.repository.js';
import { ReadinessRepository } from './readiness.repository.js';

let database: Database | undefined;

afterEach(async () => {
  if (database !== undefined) await closeDatabase(database);
  database = undefined;
});

describe('the readiness query (T110)', () => {
  it('rejects when the database cannot be reached', async () => {
    database = openDatabase('postgresql://ijazah_app:app@127.0.0.1:1/ijazah', {
      poolMax: 2,
      statementTimeoutMs: 30_000,
      idleInTransactionTimeoutMs: 60_000,
    });
    const started = performance.now();
    await expect(new ReadinessRepository(database).databaseReachable()).rejects.toThrow();
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
