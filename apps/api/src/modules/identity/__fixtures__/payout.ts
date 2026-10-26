// B15 (T075, T077): what the payout specs share, and nothing a request ever runs. The service runs
// over the real database, the kernel's real idempotency and a recording payment port: a module may
// name no adapter (R-API-4), so the specs run over this one, as the sign-in specs run over theirs.
// The port records every account it was handed, so a spec can sweep the whole schema, the log lines
// and the answers for each of them (FR-190: never a raw account number). One shared list of events
// says in which order the port and the idempotent transaction were reached (B15 check, decision 5).
import { randomInt, randomUUID } from 'node:crypto';

import { config as readDotenv } from 'dotenv';
import pg from 'pg';

import type { Database, Transaction } from '../../../platform/db/prisma.repository.js';
import { IdempotencyRepository } from '../../../platform/idempotency/idempotency.repository.js';
import {
  IdempotencyService,
  type IdempotentRequest,
  type JsonValue,
} from '../../../platform/idempotency/idempotency.service.js';
import type { PaymentPort, PayoutDetails } from '../../../platform/ports/payment/payment.port.js';
import { PayoutService } from '../payout.service.js';
import { SessionService } from '../session.service.js';
import {
  createAccount,
  createTeacherProfile,
  SEEDED_SETTINGS,
  settingsOf,
  SpecClock,
  SPEC_ENCRYPTION_KEY,
} from './identity.js';

export { PayoutRows } from './payout-rows.repository.js';

/** One registration the port was asked for, and the reference it answered (none when it failed). */
export interface RecipientCall {
  readonly teacherUserId: string;
  readonly details: PayoutDetails;
  readonly recipientRef: string | undefined;
}

/** The payment port's recipient operation, recording every call; it fails once when told to. */
export class SpecPaymentPort implements Pick<PaymentPort, 'registerPayoutRecipient'> {
  readonly calls: RecipientCall[] = [];
  readonly #events: string[];
  #failing = false;

  constructor(events: string[]) {
    this.#events = events;
  }

  /** The next registration fails as an unreachable gateway would. */
  failNext(): void {
    this.#failing = true;
  }

  async registerPayoutRecipient(teacherUserId: string, details: PayoutDetails): Promise<string> {
    this.#events.push('port');
    if (this.#failing) {
      this.#failing = false;
      this.calls.push({ teacherUserId, details, recipientRef: undefined });
      throw new Error('spec gateway: unreachable');
    }
    const recipientRef = `spec_rcp_${randomUUID()}`;
    this.calls.push({ teacherUserId, details, recipientRef });
    return recipientRef;
  }

  /** Every account number the port was handed. */
  accountNumbers(): string[] {
    return this.calls.map(({ details }) => details.accountNumber);
  }
}

/** Provisional details (OPEN-11) carrying an account number no other spec uses. */
export function specDetails(overrides: Partial<PayoutDetails> = {}): PayoutDetails {
  const digits = Array.from({ length: 22 }, () => randomInt(10)).join('');
  return {
    holderName: 'Spec Teacher',
    method: 'bank_account',
    accountNumber: `EG${digits}`,
    ...overrides,
  };
}

/** A fresh idempotency key of the kernel's shape. */
export function specKey(): string {
  return randomUUID();
}

/** The payout service over the spec's database, port and clock, with the session service beside it. */
export function buildPayout(database: Database) {
  const clock = new SpecClock();
  const settings = settingsOf({ ...SEEDED_SETTINGS, idempotency_key_ttl_hours: 24 });
  const events: string[] = [];
  const port = new SpecPaymentPort(events);
  const kernel = new IdempotencyService<Transaction>({
    store: new IdempotencyRepository(database),
    settings,
    clock: clock.now,
  });
  const idempotency = {
    run<TResult extends JsonValue>(
      request: IdempotentRequest,
      effect: (tx: Transaction) => Promise<TResult>,
    ): Promise<TResult> {
      events.push('transaction');
      return kernel.run(request, async (tx) => {
        const outcome = await effect(tx);
        events.push('committing');
        return outcome;
      });
    },
  };
  const base = { database, settings, encryptionKey: SPEC_ENCRYPTION_KEY, now: clock.now };
  return {
    clock,
    events,
    port,
    payout: new PayoutService({ ...base, payment: port, idempotency }),
    sessions: new SessionService(base),
  };
}

export type Payout = ReturnType<typeof buildPayout>;

/** An approved teacher with a profile, at the payout standing given; their user id. */
export async function createApprovedTeacher(
  database: Database,
  payout: {
    readonly payoutVerifiedAt?: Date | null;
    readonly payoutConfiguredAt?: Date | null;
  } = {},
): Promise<string> {
  const { userId } = await createAccount(database, { role: 'teacher' });
  await createTeacherProfile(database, userId, {
    verificationStatus: 'approved',
    applicationStatus: 'approved',
    ...payout,
  });
  return userId;
}

function databaseUrl(): string {
  const fromDotenv: Record<string, string> = {};
  readDotenv({ processEnv: fromDotenv, quiet: true });
  const url = process.env['DATABASE_URL'] ?? fromDotenv['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('payout specs: DATABASE_URL is not set (quickstart §1)');
  }
  return url;
}

/**
 * Every (table, column) of the schema holding a value that contains one of `needles`, whatever the
 * column's type: its text form for every column, and its bytes for a `bytea` one. Wider than
 * `rowsNaming`, which compares a value whole: an account number inside a JSON outcome, a hash input
 * or a ciphertext would be found here.
 */
export async function columnsContaining(needles: readonly string[]): Promise<string[]> {
  const db = new pg.Client({ connectionString: databaseUrl() });
  await db.connect();
  try {
    const { rows: columns } = await db.query<{
      table_name: string;
      column_name: string;
      udt_name: string;
    }>(
      `SELECT c.table_name, c.column_name, c.udt_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`,
    );
    const patterns = needles.map((needle) => `%${needle}%`);
    const bytes = needles.map((needle) => Buffer.from(needle, 'utf8'));
    const found: string[] = [];
    for (const { table_name: table, column_name: column, udt_name: type } of columns) {
      const name = pg.escapeIdentifier(column);
      const asBytes =
        type === 'bytea'
          ? ` OR EXISTS (SELECT 1 FROM unnest($2::bytea[]) n WHERE position(n IN ${name}) > 0)`
          : '';
      const { rows } = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${pg.escapeIdentifier(table)}
          WHERE ${name}::text LIKE ANY($1::text[])${asBytes}`,
        type === 'bytea' ? [patterns, bytes] : [patterns],
      );
      if (rows[0] !== undefined && rows[0].n !== '0') found.push(`${table}.${column}`);
    }
    return found;
  } finally {
    await db.end();
  }
}
