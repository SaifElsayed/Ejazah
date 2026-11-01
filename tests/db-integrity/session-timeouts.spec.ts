// T172 (review finding SC-5): every session the process opens carries a statement timeout and an
// idle-in-transaction timeout, from the configuration, so a runaway query or a transaction left
// open by a stalled request cannot hold the database for ever (R-DB-8 companion: what the
// application role may do is bounded in time as well as in privilege).
//
// The client is opened exactly as main.ts and worker.ts open it, through `openDatabase` with the
// three configured values, as the application role (the harness proves the role first). The two
// settings are read back with SHOW on the client's own session, and a statement longer than the
// limit is cut by the server with SQLSTATE 57014. Nothing is written.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  type Database,
  openDatabase,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { connectAsApplication } from './harness';

/** Values that reduce to no larger unit, so SHOW answers them in milliseconds as given. */
const STATEMENT_TIMEOUT_MS = 12_345;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 23_457;

let database: Database;
let applicationRole: string;

beforeAll(async () => {
  // The harness proves DATABASE_URL is the application role, never the owner, before anything runs.
  const db = await connectAsApplication();
  const { rows } = await db.query<{ role: string }>('SELECT current_user AS role');
  applicationRole = rows[0]?.role ?? '';
  await db.end();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

describe('the session timeouts of the process’s client (T172)', () => {
  it('carries the configured statement timeout and idle-in-transaction timeout, as the application role', async () => {
    const [session] = await database.$queryRaw<
      { role: string; statement_timeout: string; idle_in_transaction_session_timeout: string }[]
    >`SELECT current_user AS role,
             current_setting('statement_timeout') AS statement_timeout,
             current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout`;
    expect(session?.role).toBe(applicationRole);
    expect(session?.statement_timeout).toBe(`${STATEMENT_TIMEOUT_MS}ms`);
    expect(session?.idle_in_transaction_session_timeout).toBe(
      `${IDLE_IN_TRANSACTION_TIMEOUT_MS}ms`,
    );
  });

  it('answers SHOW with the same values, so an operator reads what the process set', async () => {
    const [statement] = await database.$queryRaw<{ statement_timeout: string }[]>`SHOW statement_timeout`;
    const [idle] = await database.$queryRaw<
      { idle_in_transaction_session_timeout: string }[]
    >`SHOW idle_in_transaction_session_timeout`;
    expect(statement?.statement_timeout).toBe(`${STATEMENT_TIMEOUT_MS}ms`);
    expect(idle?.idle_in_transaction_session_timeout).toBe(`${IDLE_IN_TRANSACTION_TIMEOUT_MS}ms`);
  });

  it('cuts a statement that runs past the limit, with the server’s own cancellation', async () => {
    const short = openDatabase(process.env['DATABASE_URL'] ?? '', {
      poolMax: 1,
      statementTimeoutMs: 200,
      idleInTransactionTimeoutMs: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    });
    try {
      let failure: unknown;
      try {
        await short.$queryRaw`SELECT pg_sleep(2)`;
      } catch (error: unknown) {
        failure = error;
      }
      // 57014: query_canceled, the SQLSTATE statement_timeout raises.
      expect(JSON.stringify(failure)).toContain('57014');
    } finally {
      await closeDatabase(short);
    }
  });
});
