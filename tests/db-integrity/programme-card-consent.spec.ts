// T009 of specs/006-programme/tasks.md (B-P2; FR-713, R-510; the conflict check's Q-4 (a)) — the
// migration `20261123104538_programme_card_consent` on this database: `payments.card_consent_at`,
// the student's consent to save the card on a programme order paid by hand; ERD §15 rule 82.
//
// As ijazah-programme.spec.ts: each probe first writes the rows the rule admits, so a refusal is the
// rule and not a broken row, then each forbidden one, expecting its SQLSTATE; the catalogue cases
// hold the column and the check by name; every probe runs as the application role in a transaction
// that is rolled back.
//
// Observed red: every case against the database before the migration; the rule's refusals against a
// mutant of the migration without the check (the check dropped on this database, then re-added
// exactly as the migration writes it, the catalogue `cmp`-checked after).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  type Db,
  inRollback,
  insertStatement,
  makeEnrollment,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

const CONSENT = '2026-11-23T10:00:00Z';

/** An order of a fresh enrollment, its amount left to the harness (R-MONEY-6). */
async function tryOrder(
  probe: Db,
  values: Readonly<Record<string, unknown>>,
): Promise<string | null> {
  const { enrollmentId } = await makeEnrollment(probe);
  const { sql, params } = await insertStatement(probe, 'payments', {
    enrollment_id: enrollmentId,
    gateway: 'fake',
    gateway_order_id: `probe_${randomUUID()}`,
    currency: 'EGP',
    status: 'created',
    expires_at: '2026-11-23T10:10:00Z',
    ...values,
  });
  return attempt(probe, sql, params);
}

describe('the migration on ijazah_integrity_b: the catalogue (006:T009)', () => {
  it('adds payments.card_consent_at, a NULL-able instant with no default', async () => {
    const { rows } = await db.query<{ type: string; nullable: string; fallback: string | null }>(
      `SELECT udt_name AS type, is_nullable AS nullable, column_default AS fallback
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'card_consent_at'`,
    );
    expect(rows).toEqual([{ type: 'timestamptz', nullable: 'YES', fallback: null }]);
  });

  it('holds the check on payments named payments_card_consent_at_check', async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
        WHERE contype = 'c' AND conrelid = 'payments'::regclass
          AND conname = 'payments_card_consent_at_check'`,
    );
    expect(rows).toEqual([{ name: 'payments_card_consent_at_check' }]);
  });
});

describe('ERD §15 rule 82: a card consent only on a programme order paid by hand', () => {
  it('admits no consent on any order, and a consent on a manual rest_in_full or instalment', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryOrder(probe, {})).toBeNull();
      expect(await tryOrder(probe, { kind: 'assessment' })).toBeNull();
      expect(await tryOrder(probe, { kind: 'rest_in_full', card_consent_at: CONSENT })).toBeNull();
      expect(
        await tryOrder(probe, {
          kind: 'instalment',
          instalment_month: 1,
          card_consent_at: CONSENT,
        }),
      ).toBeNull();
    });
  });

  it('refuses a consent on a package order and on an assessment order', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryOrder(probe, { card_consent_at: CONSENT })).toBe(SQLSTATE.checkViolation);
      expect(await tryOrder(probe, { kind: 'assessment', card_consent_at: CONSENT })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('refuses a consent on an automatic charge, which uses the card already saved', async () => {
    await inRollback(db, async (probe) => {
      expect(
        await tryOrder(probe, {
          kind: 'instalment',
          instalment_month: 2,
          automatic: true,
          attempt: 0,
          card_consent_at: CONSENT,
        }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });
});
