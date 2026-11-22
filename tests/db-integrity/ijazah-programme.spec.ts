// T001 of specs/006-programme/tasks.md (B-P1; ADR 0024; data-model.md, R-501, R-502, R-503, R-507,
// R-510, R-513; the note under T001, Q-2 (a)) — the migration `20261122110318_ijazah_programme` on
// this database: the order's kind and the automatic charge's columns on `payments`, the NULL-able
// gateway id, the programme package's shape on `packages`, `sessions.programme_month`, and the three
// tables `programmes`, `programme_requests` and `programme_cards`; ERD §15 rules 70 to 81.
//
// As payments-teacher-share.spec.ts: each probe first writes the rows the rule admits, so a refusal
// is the rule and not a broken row, then each forbidden one, expecting its SQLSTATE; the catalogue
// cases hold each check and index by name, one case each; every probe runs as the application role
// in a transaction that is rolled back.
//
// Observed red: every case against the database before the migration; each rule's case against a
// mutant of the migration without that check or index (the check dropped on this database, then
// re-added exactly as the migration writes it, the catalogue `cmp`-checked after).
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
  makeAdmin,
  makeEnrollment,
  makeSession,
  makeSubject,
  makeUser,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

/** One row written under a savepoint: null when accepted, or its SQLSTATE. No `RETURNING id`: two of
 * the tables are keyed by their enrollment. */
async function tryRow(
  probe: Db,
  table: string,
  values: Readonly<Record<string, unknown>>,
): Promise<string | null> {
  const { sql, params } = await insertStatement(probe, table, values);
  return attempt(probe, sql.replace(/ RETURNING id$/, ''), params);
}

/** An order of a fresh enrollment, its amount left to the harness (R-MONEY-6). */
async function tryOrder(probe: Db, values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const { enrollmentId } = await makeEnrollment(probe);
  return tryRow(probe, 'payments', {
    enrollment_id: enrollmentId,
    gateway: 'fake',
    gateway_order_id: `probe_${randomUUID()}`,
    currency: 'EGP',
    status: 'created',
    expires_at: '2026-11-22T10:00:00Z',
    ...values,
  });
}

/** A package of a fresh teacher and subject, in the shape given. */
async function tryPackage(probe: Db, values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const teacherId = await makeUser(probe);
  const subjectId = await makeSubject(probe);
  return tryRow(probe, 'packages', {
    teacher_user_id: teacherId,
    subject_id: subjectId,
    is_active: true,
    ...values,
  });
}

const RECITATION = { session_count: 4, session_duration_minutes: 60, price_piasters: 100_000 };
const PRICES = { price_30_piasters: 15_000, price_45_piasters: 20_000, price_60_piasters: 25_000 };
const NO_OLD = { session_count: null, session_duration_minutes: null, price_piasters: null };
const PROGRAMME_PACKAGE = { track: 'ijazah_track', is_programme: true, ...NO_OLD, ...PRICES };

/** A programme of a fresh enrollment, in the state and columns given. */
async function tryProgramme(probe: Db, values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const { enrollmentId } = await makeEnrollment(probe);
  return tryRow(probe, 'programmes', { enrollment_id: enrollmentId, ...values });
}

const OFFERED = { offered_at: '2026-11-22T09:00:00Z', month_count: 10 };

/** A programme item of a fresh enrollment, by its teacher. */
async function tryRequest(probe: Db, values: Readonly<Record<string, unknown>>): Promise<string | null> {
  const { enrollmentId, teacherId } = await makeEnrollment(probe);
  return tryRow(probe, 'programme_requests', {
    enrollment_id: enrollmentId,
    teacher_user_id: teacherId,
    ...values,
  });
}

const CHECKS: readonly (readonly [table: string, name: string])[] = [
  ['payments', 'payments_instalment_month_check'],
  ['payments', 'payments_attempt_check'],
  ['payments', 'payments_gateway_order_id_check'],
  ['packages', 'packages_programme_shape_check'],
  ['packages', 'packages_programme_prices_positive_check'],
  ['sessions', 'sessions_programme_month_check'],
  ['programmes', 'programmes_offered_at_check'],
  ['programmes', 'programmes_paused_at_check'],
  ['programmes', 'programmes_closed_at_check'],
  ['programmes', 'programmes_months_paid_check'],
  ['programmes', 'programmes_retries_done_check'],
  ['programmes', 'programmes_offer_words_check'],
  ['programme_requests', 'programme_requests_reason_check'],
  ['programme_requests', 'programme_requests_extended_check'],
  ['programme_requests', 'programme_requests_decided_check'],
];

const INDEXES: readonly (readonly [name: string, definition: string])[] = [
  [
    'payments_gateway_order_id_key',
    'CREATE UNIQUE INDEX payments_gateway_order_id_key ON public.payments USING btree (gateway_order_id)',
  ],
  [
    'payments_enrollment_id_kind_instalment_month_idx',
    'CREATE INDEX payments_enrollment_id_kind_instalment_month_idx ON public.payments USING btree (enrollment_id, kind, instalment_month)',
  ],
  [
    'programmes_state_next_due_at_idx',
    'CREATE INDEX programmes_state_next_due_at_idx ON public.programmes USING btree (state, next_due_at)',
  ],
  [
    'programme_requests_one_open_key',
    "CREATE UNIQUE INDEX programme_requests_one_open_key ON public.programme_requests USING btree (enrollment_id, kind) WHERE (status = 'open'::programme_request_status)",
  ],
  [
    'programme_requests_status_created_at_idx',
    'CREATE INDEX programme_requests_status_created_at_idx ON public.programme_requests USING btree (status, created_at)',
  ],
  [
    'programme_requests_enrollment_id_idx',
    'CREATE INDEX programme_requests_enrollment_id_idx ON public.programme_requests USING btree (enrollment_id)',
  ],
  [
    'programme_requests_teacher_user_id_idx',
    'CREATE INDEX programme_requests_teacher_user_id_idx ON public.programme_requests USING btree (teacher_user_id)',
  ],
  [
    'programme_requests_decided_by_admin_id_idx',
    'CREATE INDEX programme_requests_decided_by_admin_id_idx ON public.programme_requests USING btree (decided_by_admin_id)',
  ],
];

const ENUMS: readonly (readonly [name: string, labels: readonly string[]])[] = [
  ['order_kind', ['package', 'assessment', 'rest_in_full', 'instalment']],
  ['decline_kind', ['soft', 'hard']],
  ['programme_state', ['awaiting_offer', 'offered', 'active', 'paused', 'closed']],
  ['programme_plan', ['in_full', 'monthly']],
  ['programme_request_kind', ['stop', 'refusal', 'no_offer', 'pay_blocked']],
  ['programme_request_status', ['open', 'approved', 'declined', 'withdrawn', 'extended']],
];

/** The labels each existing enum ends with (each added at its end, ERD changelog row 65). */
const ADDED: readonly (readonly [name: string, labels: readonly string[]])[] = [
  ['cancellation_reason', ['offer_declined', 'offer_lapsed', 'assessment_refused', 'programme_stopped']],
  ['share_release_milestone', ['assessment', 'programme_stopped']],
  [
    'enrollment_event_kind',
    ['programme_offered', 'programme_paused', 'programme_resumed', 'programme_reopened'],
  ],
  ['payment_event_type', ['card_saved']],
];

async function labelsOf(name: string): Promise<string[]> {
  const { rows } = await db.query<{ label: string }>(
    `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = $1 ORDER BY e.enumsortorder`,
    [name],
  );
  return rows.map(({ label }) => label);
}

describe('the migration on ijazah_integrity_b: the catalogue (006:T001)', () => {
  it.each(ENUMS)('creates the enum %s with its members in order', async (name, labels) => {
    expect(await labelsOf(name)).toEqual(labels);
  });

  it.each(ADDED)('adds the members of %s at its end', async (name, labels) => {
    expect((await labelsOf(name)).slice(-labels.length)).toEqual(labels);
  });

  it.each(CHECKS)('holds the check on %s named %s', async (table, name) => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
        WHERE contype = 'c' AND conrelid = $1::regclass AND conname = $2`,
      [table, name],
    );
    expect(rows).toEqual([{ name }]);
  });

  it.each(INDEXES)('holds the index %s as written', async (name, definition) => {
    const { rows } = await db.query<{ definition: string }>(
      `SELECT indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      [name],
    );
    expect(rows).toEqual([{ definition }]);
  });

  it('makes the gateway id and the three old package columns NULL-able, and adds the new columns', async () => {
    const { rows } = await db.query<{ column: string; type: string; nullable: string; fallback: string | null }>(
      `SELECT table_name || '.' || column_name AS column, udt_name AS type, is_nullable AS nullable,
              column_default AS fallback
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('payments', 'gateway_order_id'), ('payments', 'kind'), ('payments', 'instalment_month'),
            ('payments', 'attempt'), ('payments', 'automatic'), ('payments', 'decline_kind'),
            ('payments', 'confirmed_at'), ('packages', 'session_count'),
            ('packages', 'session_duration_minutes'), ('packages', 'price_piasters'),
            ('packages', 'is_programme'), ('packages', 'price_30_piasters'),
            ('packages', 'price_45_piasters'), ('packages', 'price_60_piasters'),
            ('sessions', 'programme_month'))
        ORDER BY 1`,
    );
    expect(rows).toEqual([
      { column: 'packages.is_programme', type: 'bool', nullable: 'NO', fallback: 'false' },
      { column: 'packages.price_30_piasters', type: 'int8', nullable: 'YES', fallback: null },
      { column: 'packages.price_45_piasters', type: 'int8', nullable: 'YES', fallback: null },
      { column: 'packages.price_60_piasters', type: 'int8', nullable: 'YES', fallback: null },
      { column: 'packages.price_piasters', type: 'int8', nullable: 'YES', fallback: null },
      { column: 'packages.session_count', type: 'int4', nullable: 'YES', fallback: null },
      { column: 'packages.session_duration_minutes', type: 'int4', nullable: 'YES', fallback: null },
      { column: 'payments.attempt', type: 'int2', nullable: 'YES', fallback: null },
      { column: 'payments.automatic', type: 'bool', nullable: 'NO', fallback: 'false' },
      { column: 'payments.confirmed_at', type: 'timestamptz', nullable: 'YES', fallback: null },
      { column: 'payments.decline_kind', type: 'decline_kind', nullable: 'YES', fallback: null },
      { column: 'payments.gateway_order_id', type: 'text', nullable: 'YES', fallback: null },
      { column: 'payments.instalment_month', type: 'int2', nullable: 'YES', fallback: null },
      { column: 'payments.kind', type: 'order_kind', nullable: 'NO', fallback: "'package'::order_kind" },
      { column: 'sessions.programme_month', type: 'int2', nullable: 'YES', fallback: null },
    ]);
  });
});

describe('no existing row is changed (P2 (a)): a row written as before reads the defaults', () => {
  it('an order written without the new columns is a package order, not automatic, with no month', async () => {
    await inRollback(db, async (probe) => {
      const { enrollmentId } = await makeEnrollment(probe);
      const { sql, params } = await insertStatement(probe, 'payments', {
        enrollment_id: enrollmentId,
        gateway: 'fake',
        gateway_order_id: `probe_${randomUUID()}`,
        currency: 'EGP',
        status: 'paid',
        expires_at: '2026-11-22T10:00:00Z',
      });
      const { rows } = await probe.query<{ id: string }>(sql, params);
      const { rows: read } = await probe.query(
        `SELECT kind, instalment_month, attempt, automatic, decline_kind, confirmed_at
           FROM payments WHERE id = $1`,
        [rows[0]?.id],
      );
      expect(read).toEqual([
        {
          kind: 'package',
          instalment_month: null,
          attempt: null,
          automatic: false,
          decline_kind: null,
          confirmed_at: null,
        },
      ]);
    });
  });

  it('a package written without the new columns is not a programme one and has no price', async () => {
    await inRollback(db, async (probe) => {
      const teacherId = await makeUser(probe);
      const subjectId = await makeSubject(probe);
      const { sql, params } = await insertStatement(probe, 'packages', {
        teacher_user_id: teacherId,
        subject_id: subjectId,
        track: 'ijazah_track',
        is_active: true,
        ...RECITATION,
      });
      const { rows } = await probe.query<{ id: string }>(sql, params);
      const { rows: read } = await probe.query(
        `SELECT is_programme, price_30_piasters, price_45_piasters, price_60_piasters
           FROM packages WHERE id = $1`,
        [rows[0]?.id],
      );
      expect(read).toEqual([
        { is_programme: false, price_30_piasters: null, price_45_piasters: null, price_60_piasters: null },
      ]);
    });
  });
});

describe('ERD §15 rule 70: the instalment month exactly on an instalment, 1 and up', () => {
  it('admits a package order without a month and an instalment with month 1', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryOrder(probe, {})).toBeNull();
      expect(await tryOrder(probe, { kind: 'instalment', instalment_month: 1 })).toBeNull();
      expect(await tryOrder(probe, { kind: 'rest_in_full' })).toBeNull();
    });
  });

  it('refuses an instalment without a month, a month on another kind, and a month 0', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryOrder(probe, { kind: 'instalment' })).toBe(SQLSTATE.checkViolation);
      expect(await tryOrder(probe, { kind: 'assessment', instalment_month: 1 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryOrder(probe, { kind: 'instalment', instalment_month: 0 })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 71: an automatic charge attempt from 0 to 4', () => {
  it('admits 0 and 4, and refuses -1 and 5', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryOrder(probe, { automatic: true, attempt: 0 })).toBeNull();
      expect(await tryOrder(probe, { automatic: true, attempt: 4 })).toBeNull();
      expect(await tryOrder(probe, { automatic: true, attempt: -1 })).toBe(SQLSTATE.checkViolation);
      expect(await tryOrder(probe, { automatic: true, attempt: 5 })).toBe(SQLSTATE.checkViolation);
    });
  });
});

describe('ERD §15 rule 72: no gateway id only on an automatic order unanswered or refused before the gateway', () => {
  const noId = { gateway_order_id: null };

  it('admits it on an automatic order created, expired, or failed with a hard decline', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryOrder(probe, { ...noId, automatic: true, status: 'created' })).toBeNull();
      expect(await tryOrder(probe, { ...noId, automatic: true, status: 'expired' })).toBeNull();
      expect(
        await tryOrder(probe, { ...noId, automatic: true, status: 'failed', decline_kind: 'hard' }),
      ).toBeNull();
    });
  });

  it('refuses it on a manual order, a paid one, a soft decline and a failure with no decline kind', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryOrder(probe, { ...noId, status: 'created' })).toBe(SQLSTATE.checkViolation);
      expect(await tryOrder(probe, { ...noId, automatic: true, status: 'paid' })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await tryOrder(probe, { ...noId, automatic: true, status: 'failed', decline_kind: 'soft' }),
      ).toBe(SQLSTATE.checkViolation);
      expect(await tryOrder(probe, { ...noId, automatic: true, status: 'failed' })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 14 kept: the gateway id unique where present', () => {
  it('admits two orders with no gateway id and refuses two with the same one', async () => {
    await inRollback(db, async (probe) => {
      const unanswered = { gateway_order_id: null, automatic: true, status: 'created' };
      expect(await tryOrder(probe, unanswered)).toBeNull();
      expect(await tryOrder(probe, unanswered)).toBeNull();
      const same = `probe_${randomUUID()}`;
      expect(await tryOrder(probe, { gateway_order_id: same })).toBeNull();
      expect(await tryOrder(probe, { gateway_order_id: same })).toBe(SQLSTATE.uniqueViolation);
    });
  });
});

describe('the index on (enrollment_id, kind, instalment_month) is not unique (FR-718)', () => {
  it('records a second paid order for a month already paid', async () => {
    await inRollback(db, async (probe) => {
      const { enrollmentId } = await makeEnrollment(probe);
      const month = (n: number) =>
        tryRow(probe, 'payments', {
          enrollment_id: enrollmentId,
          gateway: 'fake',
          gateway_order_id: `probe_${randomUUID()}_${String(n)}`,
          currency: 'EGP',
          status: 'paid',
          expires_at: '2026-11-22T10:00:00Z',
          kind: 'instalment',
          instalment_month: 2,
        });
      expect(await month(1)).toBeNull();
      expect(await month(2)).toBeNull();
    });
  });
});

describe('ERD §15 rule 73: a package is a programme one, its prices set, or else its old three set', () => {
  it('admits a recitation package, a pre-switch ijazah-track one and a programme one', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryPackage(probe, RECITATION)).toBeNull();
      expect(await tryPackage(probe, { ...RECITATION, track: 'ijazah_track' })).toBeNull();
      expect(await tryPackage(probe, PROGRAMME_PACKAGE)).toBeNull();
    });
  });

  it('refuses a programme package with an old column, a price missing or on the recitation track', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryPackage(probe, { ...PROGRAMME_PACKAGE, session_count: 4 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryPackage(probe, { ...PROGRAMME_PACKAGE, price_45_piasters: null })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryPackage(probe, { ...PROGRAMME_PACKAGE, track: 'recitation' })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('refuses another package with a price or with an old column missing', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryPackage(probe, { ...RECITATION, price_30_piasters: 15_000 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryPackage(probe, { ...RECITATION, session_count: null })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 74: the three prices above zero', () => {
  it('refuses a price of 0 or below on a programme package', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryPackage(probe, { ...PROGRAMME_PACKAGE, price_30_piasters: 0 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryPackage(probe, { ...PROGRAMME_PACKAGE, price_60_piasters: -1 })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 75: a session programme month 1 and up', () => {
  it('admits NULL and 1, and refuses 0', async () => {
    await inRollback(db, async (probe) => {
      const { sessionId } = await makeSession(probe);
      const set = (month: number | null) =>
        attempt(probe, 'UPDATE sessions SET programme_month = $1 WHERE id = $2', [month, sessionId]);
      expect(await set(null)).toBeNull();
      expect(await set(1)).toBeNull();
      expect(await set(0)).toBe(SQLSTATE.checkViolation);
    });
  });
});

describe('ERD §15 rule 76: a programme offered, active or paused has its offer time', () => {
  it('admits awaiting_offer without it and offered with it, and refuses offered or active without it', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryProgramme(probe, { state: 'awaiting_offer' })).toBeNull();
      expect(await tryProgramme(probe, { state: 'offered', ...OFFERED })).toBeNull();
      expect(await tryProgramme(probe, { state: 'offered' })).toBe(SQLSTATE.checkViolation);
      expect(await tryProgramme(probe, { state: 'active', month_count: 10 })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 77: paused_at exactly while paused', () => {
  it('admits paused with it, and refuses paused without it or awaiting_offer with it', async () => {
    await inRollback(db, async (probe) => {
      const at = '2026-11-22T09:30:00Z';
      expect(await tryProgramme(probe, { state: 'paused', ...OFFERED, paused_at: at })).toBeNull();
      expect(await tryProgramme(probe, { state: 'paused', ...OFFERED })).toBe(SQLSTATE.checkViolation);
      expect(await tryProgramme(probe, { state: 'awaiting_offer', paused_at: at })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 77: closed_at exactly once closed', () => {
  it('admits closed with it, and refuses closed without it or active with it', async () => {
    await inRollback(db, async (probe) => {
      const at = '2026-11-22T09:30:00Z';
      expect(await tryProgramme(probe, { state: 'closed', closed_at: at })).toBeNull();
      expect(await tryProgramme(probe, { state: 'closed' })).toBe(SQLSTATE.checkViolation);
      expect(await tryProgramme(probe, { state: 'active', ...OFFERED, closed_at: at })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 78: the paid months never above the month count', () => {
  it('admits all months paid, and refuses one more, a paid month before the count, and a count of 0', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryProgramme(probe, { state: 'active', ...OFFERED, months_paid: 10 })).toBeNull();
      expect(await tryProgramme(probe, { state: 'active', ...OFFERED, months_paid: 11 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryProgramme(probe, { state: 'awaiting_offer', months_paid: 1 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryProgramme(probe, { state: 'awaiting_offer', month_count: 0 })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 78: the retries from 0 to 4', () => {
  it('admits 4 and refuses 5 and -1', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryProgramme(probe, { state: 'active', ...OFFERED, retries_done: 4 })).toBeNull();
      expect(await tryProgramme(probe, { state: 'active', ...OFFERED, retries_done: 5 })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryProgramme(probe, { state: 'active', ...OFFERED, retries_done: -1 })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 78: the offer words 1 to 500 characters, not blank', () => {
  it('admits 500 characters, and refuses empty, blank and 501 in each of the three', async () => {
    await inRollback(db, async (probe) => {
      const offered = { state: 'offered', ...OFFERED };
      expect(
        await tryProgramme(probe, {
          ...offered,
          level: 'ا'.repeat(500),
          readiness: 'جاهز',
          expected_length: 'سنة',
        }),
      ).toBeNull();
      for (const column of ['level', 'readiness', 'expected_length']) {
        for (const words of ['', '   ', 'ا'.repeat(501)]) {
          expect(await tryProgramme(probe, { ...offered, [column]: words })).toBe(
            SQLSTATE.checkViolation,
          );
        }
      }
    });
  });
});

describe('a programme per enrollment, a card per programme (the primary keys)', () => {
  it('refuses a second programme and a second card for one enrollment, and lets the card go', async () => {
    await inRollback(db, async (probe) => {
      const { enrollmentId } = await makeEnrollment(probe);
      const programme = { enrollment_id: enrollmentId, state: 'awaiting_offer' };
      expect(await tryRow(probe, 'programmes', programme)).toBeNull();
      expect(await tryRow(probe, 'programmes', programme)).toBe(SQLSTATE.uniqueViolation);
      const card = {
        enrollment_id: enrollmentId,
        token_encrypted: Buffer.from('probe'),
        last4: '4242',
        brand: 'visa',
        consented_at: '2026-11-22T09:00:00Z',
      };
      expect(await tryRow(probe, 'programme_cards', card)).toBeNull();
      expect(await tryRow(probe, 'programme_cards', card)).toBe(SQLSTATE.uniqueViolation);
      // The close hook deletes the card row (R-510): the application role keeps DELETE.
      expect(
        await attempt(probe, 'DELETE FROM programme_cards WHERE enrollment_id = $1', [enrollmentId]),
      ).toBeNull();
    });
  });
});

describe('ERD §15 rule 79: one open item per enrollment and kind', () => {
  it('admits an open stop beside an approved one and an open refusal, and refuses a second open stop', async () => {
    await inRollback(db, async (probe) => {
      const { enrollmentId, teacherId } = await makeEnrollment(probe);
      const admin = await makeAdmin(probe);
      const item = (values: Readonly<Record<string, unknown>>) =>
        tryRow(probe, 'programme_requests', {
          enrollment_id: enrollmentId,
          teacher_user_id: teacherId,
          reason: 'سبب',
          ...values,
        });
      const decided = { decided_by_admin_id: admin, decided_at: '2026-11-22T09:00:00Z' };
      expect(await item({ kind: 'stop', status: 'approved', ...decided })).toBeNull();
      expect(await item({ kind: 'stop', status: 'open' })).toBeNull();
      expect(await item({ kind: 'refusal', status: 'open' })).toBeNull();
      expect(await item({ kind: 'stop', status: 'open' })).toBe(SQLSTATE.uniqueViolation);
    });
  });
});

describe('ERD §15 rule 80: the reason, given on a stop and a refusal, 1 to 500 characters', () => {
  it('admits a stop with 500 characters and a no_offer item with none', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryRequest(probe, { kind: 'stop', status: 'open', reason: 'ا'.repeat(500) })).toBeNull();
      expect(await tryRequest(probe, { kind: 'no_offer', status: 'open' })).toBeNull();
      expect(await tryRequest(probe, { kind: 'pay_blocked', status: 'open' })).toBeNull();
    });
  });

  it('refuses a stop or a refusal without a reason, and a reason empty, blank or of 501', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryRequest(probe, { kind: 'stop', status: 'open' })).toBe(SQLSTATE.checkViolation);
      expect(await tryRequest(probe, { kind: 'refusal', status: 'open' })).toBe(
        SQLSTATE.checkViolation,
      );
      for (const reason of ['', '   ', 'ا'.repeat(501)]) {
        expect(await tryRequest(probe, { kind: 'no_offer', status: 'open', reason })).toBe(
          SQLSTATE.checkViolation,
        );
      }
    });
  });
});

describe('ERD §15 rule 80: extended only on a no_offer or pay_blocked item', () => {
  it('admits it on both, and refuses it on a stop and a refusal', async () => {
    await inRollback(db, async (probe) => {
      expect(await tryRequest(probe, { kind: 'no_offer', status: 'extended' })).toBeNull();
      expect(await tryRequest(probe, { kind: 'pay_blocked', status: 'extended' })).toBeNull();
      expect(await tryRequest(probe, { kind: 'stop', status: 'extended', reason: 'سبب' })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryRequest(probe, { kind: 'refusal', status: 'extended', reason: 'سبب' })).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });
});

describe('ERD §15 rule 81: the deciding administrator and the instant together, on every decision', () => {
  it('admits an approval and a decline with both and an open item with neither', async () => {
    await inRollback(db, async (probe) => {
      const admin = await makeAdmin(probe);
      const decided = { decided_by_admin_id: admin, decided_at: '2026-11-22T09:00:00Z' };
      expect(await tryRequest(probe, { kind: 'no_offer', status: 'approved', ...decided })).toBeNull();
      expect(await tryRequest(probe, { kind: 'no_offer', status: 'declined', ...decided })).toBeNull();
      expect(await tryRequest(probe, { kind: 'no_offer', status: 'open' })).toBeNull();
    });
  });

  it('refuses an approval or a decline without them, and one of the two alone', async () => {
    await inRollback(db, async (probe) => {
      const admin = await makeAdmin(probe);
      expect(await tryRequest(probe, { kind: 'no_offer', status: 'approved' })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryRequest(probe, { kind: 'no_offer', status: 'declined' })).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await tryRequest(probe, { kind: 'no_offer', status: 'open', decided_by_admin_id: admin }),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryRequest(probe, { kind: 'no_offer', status: 'open', decided_at: '2026-11-22T09:00:00Z' }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });
});
