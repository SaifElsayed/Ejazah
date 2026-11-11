// T001 of specs/004-sessions/tasks.md — the sessions pass (ERD §15 rules 40 to 48;
// specs/004-sessions/data-model.md §2.1 to §2.12 and §6; migration `20261108120000_sessions_pass`),
// and rule 49 beside them (B39, the note under T036; migration `20261111120000_case_covered_by`).
//
// One describe per rule. Each probe first writes the rows the rule admits, so a refusal is the rule
// and not a broken row, then each forbidden one, expecting its SQLSTATE: 23514 for a check, 23505
// for a partial unique, 42501 for a revoked privilege, 23001 for a key update an append-only row's
// foreign key refuses. A catalogue case per rule holds its constraints by name, so a rule removed
// later fails here even if no probe happens to cross it. Every probe runs as the application role
// in a transaction that is rolled back.
//
// Observed red without each constraint (T001): before the migration, then with each rule's
// constraints dropped by the owner in a scratch run and restored from the migration's text.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  inRollback,
  insertRow,
  insertStatement,
  makeAdmin,
  makeEnrollment,
  makeSession,
  makeUser,
  type Db,
} from './harness';

let db: Db;

beforeAll(async () => {
  db = await connectAsApplication();
});

afterAll(async () => {
  await db?.end();
});

/** The SQLSTATE an insert of `values` into `table` is refused with, or null when accepted. */
async function tryInsert(table: string, values: Record<string, unknown>): Promise<string | null> {
  const { sql, params } = await insertStatement(db, table, values);
  return attempt(db, sql, params);
}

/** The SQLSTATE an update of one row is refused with, or null when accepted. */
function tryUpdate(
  table: string,
  id: string,
  values: Readonly<Record<string, unknown>>,
): Promise<string | null> {
  const columns = Object.keys(values);
  const set = columns.map((column, index) => `"${column}" = $${index + 2}`).join(', ');
  return attempt(db, `UPDATE "${table}" SET ${set} WHERE id = $1`, [id, ...Object.values(values)]);
}

/** The names of a table's constraints of one type (`c` check, `f` foreign key), in name order. */
async function constraintsOf(table: string, type: 'c' | 'f'): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT conname AS name FROM pg_constraint
      WHERE contype = $2 AND conrelid = $1::regclass ORDER BY conname`,
    [table, type],
  );
  return rows.map(({ name }) => name);
}

/** A table's indexes, by name, in name order. */
async function indexesOf(table: string): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT indexname AS name FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`,
    [table],
  );
  return rows.map(({ name }) => name);
}

/** The definition of one index, as the database prints it. */
async function indexDefinition(name: string): Promise<string | undefined> {
  const { rows } = await db.query<{ definition: string }>(
    `SELECT indexdef AS definition FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [name],
  );
  return rows[0]?.definition;
}

/** A weekly slot of `teacherId`'s, for a counter-proposal to name. */
function makeSlot(teacherId: string): Promise<string> {
  return insertRow(db, 'availability_slots', {
    teacher_user_id: teacherId,
    day_of_week: 2,
    start_time_local: '17:00:00',
    duration_minutes: 60,
    timezone: 'Africa/Cairo',
    is_active: true,
  });
}

/** An open compensation case on the enrollment, raised by the system. */
function makeCase(enrollmentId: string): Promise<string> {
  return insertRow(db, 'disputes', {
    enrollment_id: enrollmentId,
    kind: 'compensation_case',
    reason: 'teacher_ended',
    status: 'open',
  });
}

/** Every append-only foreign key is RESTRICT both ways (rule 21's pattern, `002:T135`). */
async function foreignKeyActions(
  table: string,
): Promise<{ name: string; onUpdate: string; onDelete: string }[]> {
  const { rows } = await db.query<{ name: string; onUpdate: string; onDelete: string }>(
    `SELECT conname AS name, confupdtype AS "onUpdate", confdeltype AS "onDelete"
       FROM pg_constraint
      WHERE contype = 'f' AND conrelid = $1::regclass
      ORDER BY conname`,
    [table],
  );
  return rows;
}

const OUTCOMES = ['done', 'student_no_show', 'teacher_no_show', 'both_no_show'] as const;

describe('ERD §15 rule 40: a frozen outcome only on a disputed session, an administrator’s settling with its instant (T001)', () => {
  it('admits a disputed session with or without its frozen outcome, each of the six outcomes', async () => {
    await inRollback(db, async () => {
      const { sessionId } = await makeSession(db);
      expect(await tryUpdate('sessions', sessionId, { status: 'disputed' })).toBeNull();
      for (const outcome of [...OUTCOMES, 'under_threshold', 'provider_outage']) {
        expect(
          await tryUpdate('sessions', sessionId, {
            status: 'disputed',
            outcome_under_dispute: outcome,
          }),
          outcome,
        ).toBeNull();
      }
    });
  });

  it('refuses a frozen outcome on a session not disputed, and a frozen outcome that is not an outcome', async () => {
    await inRollback(db, async () => {
      const { sessionId } = await makeSession(db);
      for (const status of ['scheduled', 'done', 'cancelled_by_admin']) {
        expect(
          await tryUpdate('sessions', sessionId, { status, outcome_under_dispute: 'done' }),
          status,
        ).toBe(SQLSTATE.checkViolation);
      }
      for (const outcome of ['scheduled', 'disputed', 'cancelled_by_agreement']) {
        expect(
          await tryUpdate('sessions', sessionId, {
            status: 'disputed',
            outcome_under_dispute: outcome,
          }),
          outcome,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('refuses an administrator without the instant, and the instant without an administrator', async () => {
    await inRollback(db, async () => {
      const { sessionId } = await makeSession(db);
      const admin = await makeAdmin(db);
      expect(
        await tryUpdate('sessions', sessionId, {
          settled_by_admin_id: admin,
          admin_settled_at: '2026-10-05T09:00:00Z',
        }),
      ).toBeNull();
      expect(
        await tryUpdate('sessions', sessionId, {
          settled_by_admin_id: admin,
          admin_settled_at: null,
        }),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryUpdate('sessions', sessionId, {
          settled_by_admin_id: null,
          admin_settled_at: '2026-10-05T09:00:00Z',
        }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('holds its checks by name', async () => {
    expect(await constraintsOf('sessions', 'c')).toEqual(
      expect.arrayContaining([
        'sessions_admin_settled_check',
        'sessions_outcome_under_dispute_check',
      ]),
    );
  });
});

describe('ERD §15 rule 41: a participant’s event names a participant and a connection, a room’s end neither (T001)', () => {
  async function eventRow(): Promise<(values: Record<string, unknown>) => Record<string, unknown>> {
    const { sessionId } = await makeSession(db);
    return (values) => ({
      session_id: sessionId,
      occurred_at: '2026-10-04T06:00:05Z',
      provider_event_id: `probe-video-event-${randomUUID()}`,
      ...values,
    });
  }

  it('admits a join and a departure with their participant and connection, and a room’s end with neither', async () => {
    await inRollback(db, async () => {
      const row = await eventRow();
      const user = await makeUser(db);
      for (const event_type of ['joined', 'left']) {
        expect(
          await tryInsert(
            'session_participant_events',
            row({ event_type, user_id: user, connection_ref: 'PA_probe' }),
          ),
          event_type,
        ).toBeNull();
      }
      expect(await tryInsert('session_participant_events', row({ event_type: 'room_ended' }))).toBe(
        null,
      );
    });
  });

  it('refuses a room’s end with a participant or a connection', async () => {
    await inRollback(db, async () => {
      const row = await eventRow();
      const user = await makeUser(db);
      expect(
        await tryInsert(
          'session_participant_events',
          row({ event_type: 'room_ended', user_id: user }),
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryInsert(
          'session_participant_events',
          row({ event_type: 'room_ended', connection_ref: 'PA_probe' }),
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('refuses a participant’s event without its participant or without its connection', async () => {
    await inRollback(db, async () => {
      const row = await eventRow();
      const user = await makeUser(db);
      for (const event_type of ['joined', 'left']) {
        expect(
          await tryInsert(
            'session_participant_events',
            row({ event_type, connection_ref: 'PA_probe' }),
          ),
          event_type,
        ).toBe(SQLSTATE.checkViolation);
        expect(
          await tryInsert('session_participant_events', row({ event_type, user_id: user })),
          event_type,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('holds its checks by name', async () => {
    expect(await constraintsOf('session_participant_events', 'c')).toEqual([
      'session_participant_events_connection_ref_check',
      'session_participant_events_user_id_check',
    ]);
  });
});

describe('ERD §15 rule 42: a remedy’s pending counter-proposal, its case and its windows (T001)', () => {
  /** A remedy offered on a fresh session, its slot's teacher's slot for a counter. */
  async function offered(values: Record<string, unknown> = {}): Promise<{
    remedyId: string;
    enrollmentId: string;
    slotId: string;
  }> {
    const { sessionId, enrollmentId, teacherId } = await makeSession(db);
    const slotId = await makeSlot(teacherId);
    const remedyId = await insertRow(db, 'session_remedies', {
      session_id: sessionId,
      kind: 'makeup',
      status: 'proposed',
      proposed_date: '2026-10-13',
      offered_at: '2026-10-07T07:00:00Z',
      choice_closes_at: '2026-10-14T07:00:00Z',
      snapshot_answer_window_hours: 72,
      snapshot_first_session_lead_hours: 24,
      ...values,
    });
    return { remedyId, enrollmentId, slotId };
  }

  function counter(slotId: string): Record<string, unknown> {
    return {
      counter_slot_id: slotId,
      counter_date: '2026-10-15',
      counter_start_time_local: '17:00:00',
      counter_timezone: 'Africa/Cairo',
      counter_proposed_at: '2026-10-08T07:00:00Z',
    };
  }

  const COUNTER_COLUMNS = [
    'counter_slot_id',
    'counter_date',
    'counter_start_time_local',
    'counter_timezone',
    'counter_proposed_at',
  ] as const;

  it('admits a pending counter-proposal with its five columns, and none on every other status', async () => {
    await inRollback(db, async () => {
      const { remedyId, slotId } = await offered();
      expect(
        await tryUpdate('session_remedies', remedyId, {
          status: 'counter_proposed',
          ...counter(slotId),
        }),
      ).toBeNull();
      const cleared = Object.fromEntries(COUNTER_COLUMNS.map((column) => [column, null]));
      for (const status of ['awaiting_choice', 'proposed', 'frozen', 'booked', 'lapsed']) {
        expect(await tryUpdate('session_remedies', remedyId, { status, ...cleared }), status).toBe(
          null,
        );
      }
    });
  });

  it('refuses a counter-proposal missing any one of its five columns, and any of them on another status', async () => {
    await inRollback(db, async () => {
      const { remedyId, slotId } = await offered();
      for (const column of COUNTER_COLUMNS) {
        expect(
          await tryUpdate('session_remedies', remedyId, {
            status: 'counter_proposed',
            ...counter(slotId),
            [column]: null,
          }),
          column,
        ).toBe(SQLSTATE.checkViolation);
      }
      for (const column of COUNTER_COLUMNS) {
        expect(
          await tryUpdate('session_remedies', remedyId, {
            status: 'proposed',
            [column]: counter(slotId)[column],
          }),
          column,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('a case exactly on a remedy handed to one: refused on a lapsed remedy, required on refund_case', async () => {
    await inRollback(db, async () => {
      const { remedyId, enrollmentId } = await offered();
      const caseId = await makeCase(enrollmentId);
      expect(
        await tryUpdate('session_remedies', remedyId, { status: 'refund_case', case_id: caseId }),
      ).toBeNull();
      expect(
        await tryUpdate('session_remedies', remedyId, { status: 'refund_case', case_id: null }),
      ).toBe(SQLSTATE.checkViolation);
      for (const status of ['lapsed', 'proposed', 'booked', 'frozen']) {
        expect(
          await tryUpdate('session_remedies', remedyId, { status, case_id: caseId }),
          status,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('refuses a choice window that does not close after the offer, and a snapshot out of range', async () => {
    await inRollback(db, async () => {
      const { remedyId } = await offered();
      expect(
        await tryUpdate('session_remedies', remedyId, { choice_closes_at: '2026-10-07T07:00:00Z' }),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryUpdate('session_remedies', remedyId, { choice_closes_at: '2026-10-06T07:00:00Z' }),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryUpdate('session_remedies', remedyId, { snapshot_answer_window_hours: 1 }),
      ).toBe(null);
      expect(
        await tryUpdate('session_remedies', remedyId, { snapshot_answer_window_hours: 0 }),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryUpdate('session_remedies', remedyId, { snapshot_first_session_lead_hours: 0 }),
      ).toBeNull();
      expect(
        await tryUpdate('session_remedies', remedyId, { snapshot_first_session_lead_hours: -1 }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('holds its checks by name, and the new foreign key’s plain index', async () => {
    expect(await constraintsOf('session_remedies', 'c')).toEqual([
      'session_remedies_answer_window_check',
      'session_remedies_case_check',
      'session_remedies_choice_window_check',
      'session_remedies_counter_check',
      'session_remedies_first_session_lead_check',
    ]);
    expect(await indexDefinition('session_remedies_counter_slot_id_idx')).toBe(
      'CREATE INDEX session_remedies_counter_slot_id_idx ON public.session_remedies USING btree (counter_slot_id)',
    );
  });
});

describe('ERD §15 rule 43: a session event says one thing per kind and is never rewritten (T001)', () => {
  /** A session, a case of its enrollment and a slot of its teacher: what an event row may name. */
  async function world(): Promise<{
    enrollmentId: string;
    sessionId: string;
    caseId: string;
    slotId: string;
  }> {
    const { sessionId, enrollmentId, teacherId } = await makeSession(db);
    return {
      enrollmentId,
      sessionId,
      caseId: await makeCase(enrollmentId),
      slotId: await makeSlot(teacherId),
    };
  }

  type World = Awaited<ReturnType<typeof world>>;

  /** The smallest row each kind admits. */
  function valid(on: World, kind: string): Record<string, unknown> {
    const base = {
      enrollment_id: on.enrollmentId,
      session_id: on.sessionId,
      kind,
      occurred_at: '2026-10-04T07:05:00Z',
    };
    switch (kind) {
      case 'counter_proposed':
        return {
          ...base,
          counter_slot_id: on.slotId,
          counter_date: '2026-10-15',
          counter_start_time_local: '17:00:00',
          counter_timezone: 'Africa/Cairo',
        };
      case 'dispute_revised':
        return {
          ...base,
          case_id: on.caseId,
          outcome_before: 'done',
          outcome_after: 'teacher_no_show',
        };
      case 'outcome_corrected':
        return { ...base, outcome_before: 'student_no_show', outcome_after: 'done' };
      case 'complaint_raised':
      case 'complaint_decided':
        return { ...base, session_id: null, case_id: on.caseId };
      case 'instants_reresolved':
        return { ...base, previous_start_at: '2026-10-04T06:00:00Z' };
      default:
        return base;
    }
  }

  const KINDS = [
    'settled',
    'cancellation_requested',
    'cancellation_accepted',
    'cancellation_declined',
    'cancellation_expired',
    'cancelled_by_admin',
    'remedy_offered',
    'counter_proposed',
    'counter_accepted',
    'counter_declined',
    'counter_withdrawn',
    'remedy_frozen',
    'makeup_booked',
    'remedy_handed_to_case',
    'remedy_lapsed',
    'dispute_raised',
    'dispute_resolved',
    'dispute_revised',
    'review_resolved',
    'outage_reclassified',
    'complaint_raised',
    'complaint_decided',
    'outcome_corrected',
    'instants_reresolved',
    'counter_booking_refused',
  ] as const;

  it('holds the twenty-five kinds, in data-model.md §2.4’s order', async () => {
    const { rows } = await db.query<{ label: string }>(
      `SELECT unnest(enum_range(NULL::session_event_kind))::text AS label`,
    );
    expect(rows.map(({ label }) => label)).toEqual(KINDS);
  });

  it('admits each kind’s smallest row, and a cancellation by an administrator with or without its case', async () => {
    await inRollback(db, async () => {
      const on = await world();
      for (const kind of KINDS) {
        expect(await tryInsert('session_events', valid(on, kind)), kind).toBeNull();
      }
      expect(
        await tryInsert('session_events', {
          ...valid(on, 'cancelled_by_admin'),
          case_id: on.caseId,
        }),
      ).toBeNull();
    });
  });

  it('the four counter columns exactly on a counter-proposal', async () => {
    await inRollback(db, async () => {
      const on = await world();
      const full = valid(on, 'counter_proposed');
      for (const column of [
        'counter_slot_id',
        'counter_date',
        'counter_start_time_local',
        'counter_timezone',
      ]) {
        expect(await tryInsert('session_events', { ...full, [column]: null }), column).toBe(
          SQLSTATE.checkViolation,
        );
        expect(
          await tryInsert('session_events', {
            ...valid(on, 'counter_declined'),
            [column]: full[column],
          }),
          column,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('a case only on the four kinds that name one, and always on a revision and a complaint', async () => {
    await inRollback(db, async () => {
      const on = await world();
      for (const kind of [
        'settled',
        'remedy_handed_to_case',
        'dispute_resolved',
        'outcome_corrected',
      ]) {
        expect(
          await tryInsert('session_events', { ...valid(on, kind), case_id: on.caseId }),
          kind,
        ).toBe(SQLSTATE.checkViolation);
      }
      for (const kind of ['dispute_revised', 'complaint_raised', 'complaint_decided']) {
        expect(await tryInsert('session_events', { ...valid(on, kind), case_id: null }), kind).toBe(
          SQLSTATE.checkViolation,
        );
      }
    });
  });

  it('no session exactly on the two complaint kinds', async () => {
    await inRollback(db, async () => {
      const on = await world();
      for (const kind of ['complaint_raised', 'complaint_decided']) {
        expect(
          await tryInsert('session_events', { ...valid(on, kind), session_id: on.sessionId }),
          kind,
        ).toBe(SQLSTATE.checkViolation);
      }
      for (const kind of [
        'settled',
        'cancelled_by_admin',
        'outcome_corrected',
        'instants_reresolved',
      ]) {
        expect(
          await tryInsert('session_events', { ...valid(on, kind), session_id: null }),
          kind,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('both outcomes exactly on a revision and a correction, each one of the four outcomes', async () => {
    await inRollback(db, async () => {
      const on = await world();
      for (const kind of ['dispute_revised', 'outcome_corrected']) {
        for (const before of OUTCOMES) {
          expect(
            await tryInsert('session_events', { ...valid(on, kind), outcome_before: before }),
            `${kind} ${before}`,
          ).toBeNull();
        }
        expect(
          await tryInsert('session_events', { ...valid(on, kind), outcome_before: null }),
          kind,
        ).toBe(SQLSTATE.checkViolation);
        expect(
          await tryInsert('session_events', { ...valid(on, kind), outcome_after: null }),
          kind,
        ).toBe(SQLSTATE.checkViolation);
        for (const outcome of ['under_threshold', 'provider_outage', 'disputed', 'scheduled']) {
          expect(
            await tryInsert('session_events', { ...valid(on, kind), outcome_after: outcome }),
            `${kind} ${outcome}`,
          ).toBe(SQLSTATE.checkViolation);
        }
      }
      expect(
        await tryInsert('session_events', {
          ...valid(on, 'dispute_resolved'),
          outcome_before: 'done',
          outcome_after: 'teacher_no_show',
        }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('a previous start exactly on a re-resolution', async () => {
    await inRollback(db, async () => {
      const on = await world();
      expect(
        await tryInsert('session_events', {
          ...valid(on, 'instants_reresolved'),
          previous_start_at: null,
        }),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryInsert('session_events', {
          ...valid(on, 'settled'),
          previous_start_at: '2026-10-04T06:00:00Z',
        }),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('a row is written, then UPDATE, DELETE and TRUNCATE are refused', async () => {
    await inRollback(db, async () => {
      const on = await world();
      const id = await insertRow(db, 'session_events', valid(on, 'settled'));
      expect(
        await attempt(db, 'UPDATE "session_events" SET "occurred_at" = now() WHERE id = $1', [id]),
      ).toBe(SQLSTATE.insufficientPrivilege);
      expect(await attempt(db, 'DELETE FROM "session_events" WHERE id = $1', [id])).toBe(
        SQLSTATE.insufficientPrivilege,
      );
      expect(await attempt(db, 'TRUNCATE "session_events"')).toBe(SQLSTATE.insufficientPrivilege);
    });
  });

  it.each([
    { column: 'enrollment_id', parent: 'enrollments' },
    { column: 'session_id', parent: 'sessions' },
    { column: 'case_id', parent: 'disputes' },
    { column: 'counter_slot_id', parent: 'availability_slots' },
  ])(
    '$column: an UPDATE of the key it references in $parent is refused',
    async ({ column, parent }) => {
      await inRollback(db, async () => {
        const on = await world();
        const row =
          column === 'counter_slot_id'
            ? valid(on, 'counter_proposed')
            : { ...valid(on, 'cancelled_by_admin'), case_id: on.caseId };
        await insertRow(db, 'session_events', row);
        expect(
          await attempt(db, `UPDATE "${parent}" SET id = $1 WHERE id = $2`, [
            randomUUID(),
            row[column],
          ]),
        ).toBe(SQLSTATE.restrictViolation);
      });
    },
  );

  it('holds its checks by name, its foreign keys RESTRICT both ways, and the plain index of each', async () => {
    expect(await constraintsOf('session_events', 'c')).toEqual([
      'session_events_case_check',
      'session_events_counter_check',
      'session_events_outcome_check',
      'session_events_previous_start_check',
      'session_events_session_check',
    ]);
    expect(await foreignKeyActions('session_events')).toEqual([
      { name: 'session_events_case_id_fkey', onUpdate: 'r', onDelete: 'r' },
      { name: 'session_events_counter_slot_id_fkey', onUpdate: 'r', onDelete: 'r' },
      { name: 'session_events_enrollment_id_fkey', onUpdate: 'r', onDelete: 'r' },
      { name: 'session_events_session_id_fkey', onUpdate: 'r', onDelete: 'r' },
    ]);
    expect(await indexesOf('session_events')).toEqual([
      'session_events_case_id_idx',
      'session_events_counter_slot_id_idx',
      'session_events_enrollment_id_idx',
      'session_events_pkey',
      'session_events_session_id_idx',
    ]);
  });
});

describe('ERD §15 rule 44: a video outage window ends after it starts and is never rewritten (T001)', () => {
  async function outage(values: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      starts_at: '2026-10-04T06:00:00Z',
      ends_at: '2026-10-04T07:00:00Z',
      reason: 'Probe outage',
      recorded_by_admin_id: await makeAdmin(db),
      ...values,
    };
  }

  it('admits a window that ends after it starts; refuses an empty or a reversed one', async () => {
    await inRollback(db, async () => {
      expect(await tryInsert('provider_outages', await outage({}))).toBeNull();
      expect(
        await tryInsert('provider_outages', await outage({ ends_at: '2026-10-04T06:00:00Z' })),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryInsert('provider_outages', await outage({ ends_at: '2026-10-04T05:00:00Z' })),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('a row is written, then UPDATE, DELETE and TRUNCATE are refused, and a key update of its administrator', async () => {
    await inRollback(db, async () => {
      const row = await outage({});
      const id = await insertRow(db, 'provider_outages', row);
      expect(
        await attempt(db, 'UPDATE "provider_outages" SET "reason" = $2 WHERE id = $1', [id, 'x']),
      ).toBe(SQLSTATE.insufficientPrivilege);
      expect(await attempt(db, 'DELETE FROM "provider_outages" WHERE id = $1', [id])).toBe(
        SQLSTATE.insufficientPrivilege,
      );
      expect(await attempt(db, 'TRUNCATE "provider_outages"')).toBe(SQLSTATE.insufficientPrivilege);
      expect(
        await attempt(db, 'UPDATE "admin_users" SET id = $1 WHERE id = $2', [
          randomUUID(),
          row['recorded_by_admin_id'],
        ]),
      ).toBe(SQLSTATE.restrictViolation);
    });
  });

  it('holds its check by name, its foreign key RESTRICT both ways, and its plain index', async () => {
    expect(await constraintsOf('provider_outages', 'c')).toEqual(['provider_outages_window_check']);
    expect(await foreignKeyActions('provider_outages')).toEqual([
      { name: 'provider_outages_recorded_by_admin_id_fkey', onUpdate: 'r', onDelete: 'r' },
    ]);
    expect(await indexesOf('provider_outages')).toEqual([
      'provider_outages_pkey',
      'provider_outages_recorded_by_admin_id_idx',
    ]);
  });
});

describe('ERD §15 rule 45: one pending cancellation request per session, answered with its instant, with a reason (T001)', () => {
  async function requestRow(): Promise<
    (values: Record<string, unknown>) => Record<string, unknown>
  > {
    const { sessionId, studentId } = await makeSession(db);
    return (values) => ({
      session_id: sessionId,
      requested_by_user_id: studentId,
      reason: 'Travelling',
      status: 'pending',
      ...values,
    });
  }

  it('refuses a second pending request on the session; admits one beside answered ones', async () => {
    await inRollback(db, async () => {
      const row = await requestRow();
      expect(await tryInsert('cancellation_requests', row({}))).toBeNull();
      expect(await tryInsert('cancellation_requests', row({}))).toBe(SQLSTATE.uniqueViolation);
      expect(await tryInsert('cancellation_requests', row({ status: 'expired' }))).toBeNull();
      expect(
        await tryInsert(
          'cancellation_requests',
          row({ status: 'declined', responded_at: '2026-10-03T07:00:00Z' }),
        ),
      ).toBeNull();
      const other = await requestRow();
      expect(await tryInsert('cancellation_requests', other({}))).toBeNull();
    });
  });

  it('an answer exactly on an accepted or declined request', async () => {
    await inRollback(db, async () => {
      const row = await requestRow();
      for (const status of ['accepted', 'declined']) {
        expect(await tryInsert('cancellation_requests', row({ status })), status).toBe(
          SQLSTATE.checkViolation,
        );
      }
      for (const status of ['pending', 'expired']) {
        expect(
          await tryInsert(
            'cancellation_requests',
            row({ status, responded_at: '2026-10-03T07:00:00Z' }),
          ),
          status,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  // `btrim` with one argument trims spaces, as rule 45 is written (ERD §15).
  it('refuses an empty reason, or one of spaces only', async () => {
    await inRollback(db, async () => {
      const row = await requestRow();
      for (const reason of ['', ' ', '   ']) {
        expect(
          await tryInsert('cancellation_requests', row({ reason, status: 'expired' })),
          JSON.stringify(reason),
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('holds its checks and its partial unique by name', async () => {
    expect(await constraintsOf('cancellation_requests', 'c')).toEqual([
      'cancellation_requests_reason_check',
      'cancellation_requests_responded_at_check',
    ]);
    expect(await indexDefinition('cancellation_requests_one_pending_key')).toBe(
      "CREATE UNIQUE INDEX cancellation_requests_one_pending_key ON public.cancellation_requests USING btree (session_id) WHERE (status = 'pending'::cancellation_request_status)",
    );
  });
});

describe('ERD §15 rule 46: a dispute, a case and a complaint (T001)', () => {
  /** A dispute row of the session's enrollment. */
  async function disputeRow(): Promise<{
    row: (values: Record<string, unknown>) => Record<string, unknown>;
    sessionId: string;
    studentId: string;
    admin: string;
  }> {
    const { sessionId, enrollmentId, studentId } = await makeSession(db);
    const admin = await makeAdmin(db);
    return {
      sessionId,
      studentId,
      admin,
      row: (values) => ({ enrollment_id: enrollmentId, reason: 'Probe reason', ...values }),
    };
  }

  it('one open session dispute per session; a closed one beside it', async () => {
    await inRollback(db, async () => {
      const { row, sessionId, studentId, admin } = await disputeRow();
      const dispute = row({
        kind: 'session_dispute',
        session_id: sessionId,
        raised_by_user_id: studentId,
        status: 'open',
      });
      expect(await tryInsert('disputes', dispute)).toBeNull();
      expect(await tryInsert('disputes', dispute)).toBe(SQLSTATE.uniqueViolation);
      expect(
        await tryInsert('disputes', {
          ...dispute,
          status: 'resolved',
          resolution: 'upheld',
          resolution_notes: 'Probe ruling',
          resolved_by_admin_id: admin,
          resolved_at: '2026-10-05T07:00:00Z',
        }),
      ).toBeNull();
    });
  });

  it('a session exactly on a session dispute', async () => {
    await inRollback(db, async () => {
      const { row, sessionId, studentId } = await disputeRow();
      expect(
        await tryInsert(
          'disputes',
          row({ kind: 'session_dispute', raised_by_user_id: studentId, status: 'open' }),
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryInsert(
          'disputes',
          row({ kind: 'compensation_case', session_id: sessionId, status: 'open' }),
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryInsert(
          'disputes',
          row({
            kind: 'absence_complaint',
            session_id: sessionId,
            raised_by_user_id: studentId,
            status: 'open',
          }),
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('a closing instant exactly on a closed row, with its notes and its administrator', async () => {
    await inRollback(db, async () => {
      const { row, admin } = await disputeRow();
      const closed = {
        kind: 'compensation_case',
        resolution_notes: 'Probe decision',
        resolved_by_admin_id: admin,
        resolved_at: '2026-10-05T07:00:00Z',
      };
      for (const status of ['resolved', 'dismissed']) {
        expect(await tryInsert('disputes', row({ ...closed, status })), status).toBeNull();
        expect(
          await tryInsert('disputes', row({ ...closed, status, resolved_at: null })),
          status,
        ).toBe(SQLSTATE.checkViolation);
        expect(
          await tryInsert('disputes', row({ ...closed, status, resolution_notes: null })),
          status,
        ).toBe(SQLSTATE.checkViolation);
        expect(
          await tryInsert('disputes', row({ ...closed, status, resolved_by_admin_id: null })),
          status,
        ).toBe(SQLSTATE.checkViolation);
      }
      expect(
        await tryInsert(
          'disputes',
          row({ kind: 'compensation_case', status: 'open', resolved_at: '2026-10-05T07:00:00Z' }),
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('one open complaint per enrollment, raised by its student; a closed one beside it', async () => {
    await inRollback(db, async () => {
      const { row, studentId, admin } = await disputeRow();
      const complaint = row({
        kind: 'absence_complaint',
        raised_by_user_id: studentId,
        status: 'open',
      });
      expect(await tryInsert('disputes', complaint)).toBeNull();
      expect(await tryInsert('disputes', complaint)).toBe(SQLSTATE.uniqueViolation);
      expect(
        await tryInsert('disputes', {
          ...complaint,
          status: 'resolved',
          resolution: 'enrollment_ended',
          resolution_notes: 'Probe decision',
          resolved_by_admin_id: admin,
          resolved_at: '2026-10-05T07:00:00Z',
        }),
      ).toBeNull();
      expect(await tryInsert('disputes', row({ kind: 'absence_complaint', status: 'open' }))).toBe(
        SQLSTATE.checkViolation,
      );
    });
  });

  it('an ended enrollment only as a complaint’s resolution', async () => {
    await inRollback(db, async () => {
      const { row, sessionId, studentId, admin } = await disputeRow();
      const closed = {
        status: 'resolved',
        resolution: 'enrollment_ended',
        resolution_notes: 'Probe decision',
        resolved_by_admin_id: admin,
        resolved_at: '2026-10-05T07:00:00Z',
      };
      expect(await tryInsert('disputes', row({ kind: 'compensation_case', ...closed }))).toBe(
        SQLSTATE.checkViolation,
      );
      expect(
        await tryInsert(
          'disputes',
          row({
            kind: 'session_dispute',
            session_id: sessionId,
            raised_by_user_id: studentId,
            ...closed,
          }),
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('holds its checks and its two partial uniques by name', async () => {
    expect(await constraintsOf('disputes', 'c')).toEqual([
      'disputes_closed_check',
      'disputes_complaint_raiser_check',
      // Rule 49's (B39, the note under T036), its own describe below.
      'disputes_covered_by_check',
      'disputes_enrollment_ended_check',
      'disputes_resolved_at_check',
      'disputes_session_check',
    ]);
    expect(await indexDefinition('disputes_one_open_per_session_key')).toBe(
      "CREATE UNIQUE INDEX disputes_one_open_per_session_key ON public.disputes USING btree (session_id) WHERE ((kind = 'session_dispute'::dispute_kind) AND (status = 'open'::dispute_status))",
    );
    expect(await indexDefinition('disputes_one_open_complaint_per_enrollment_key')).toBe(
      "CREATE UNIQUE INDEX disputes_one_open_complaint_per_enrollment_key ON public.disputes USING btree (enrollment_id) WHERE ((kind = 'absence_complaint'::dispute_kind) AND (status = 'open'::dispute_status))",
    );
  });
});

describe('ERD §15 rule 47: a chat attachment is a PDF or plain text, its three columns together (T001)', () => {
  async function messageRow(): Promise<
    (values: Record<string, unknown>) => Record<string, unknown>
  > {
    const { enrollmentId, studentId } = await makeEnrollment(db);
    return (values) => ({
      enrollment_id: enrollmentId,
      sender_user_id: studentId,
      sent_at: '2026-10-04T06:10:00Z',
      ...values,
    });
  }

  const attachment = {
    attachment_key: 'chat/probe',
    attachment_filename: 'notes.pdf',
    attachment_mime: 'application/pdf',
  };

  it('admits a PDF and a plain text file; refuses any other type, an image first', async () => {
    await inRollback(db, async () => {
      const row = await messageRow();
      for (const mime of ['application/pdf', 'text/plain']) {
        expect(
          await tryInsert('chat_messages', row({ ...attachment, attachment_mime: mime })),
          mime,
        ).toBe(null);
      }
      for (const mime of ['image/png', 'image/jpeg', 'application/msword', 'text/html', '']) {
        expect(
          await tryInsert('chat_messages', row({ ...attachment, attachment_mime: mime })),
          mime,
        ).toBe(SQLSTATE.checkViolation);
      }
    });
  });

  it('refuses an attachment missing one of its three columns, unless the row was purged', async () => {
    await inRollback(db, async () => {
      const row = await messageRow();
      for (const column of Object.keys(attachment)) {
        expect(
          await tryInsert('chat_messages', row({ body: 'Salam', ...attachment, [column]: null })),
          column,
        ).toBe(SQLSTATE.checkViolation);
        expect(
          await tryInsert(
            'chat_messages',
            row({ ...attachment, [column]: null, purged_at: '2026-11-04T06:10:00Z' }),
          ),
          column,
        ).toBeNull();
      }
    });
  });

  it('holds its checks by name', async () => {
    expect(await constraintsOf('chat_messages', 'c')).toEqual([
      'chat_messages_attachment_check',
      'chat_messages_attachment_mime_check',
      'chat_messages_body_or_attachment_check',
    ]);
  });
});

describe('ERD §15 rule 48: a hold’s release reason only on a released hold (T001)', () => {
  async function holdRow(): Promise<(values: Record<string, unknown>) => Record<string, unknown>> {
    const teacherId = await makeUser(db);
    const studentId = await makeUser(db);
    const subjectId = await insertRow(db, 'subjects', {
      name_ar: 'مادة',
      name_en: 'Subject',
      is_active: true,
    });
    const packageId = await insertRow(db, 'packages', {
      teacher_user_id: teacherId,
      subject_id: subjectId,
      session_count: 4,
      session_duration_minutes: 60,
      price_piasters: 100_000,
      is_active: true,
    });
    const slotId = await makeSlot(teacherId);
    return (values) => ({
      slot_id: slotId,
      student_user_id: studentId,
      package_id: packageId,
      session_count: 4,
      expires_at: '2026-10-04T07:15:00Z',
      ...values,
    });
  }

  it('admits an active hold with none, a released one with or without one; refuses a reason on an active hold', async () => {
    await inRollback(db, async () => {
      const row = await holdRow();
      expect(
        await tryInsert('slot_holds', row({ released_at: '2026-10-04T07:20:00Z' })),
      ).toBeNull();
      for (const reason of [
        'converted',
        'expired',
        'checkout_abandoned',
        'slot_unavailable',
        'admin',
        'teacher_suspended',
        'account_deleted',
      ]) {
        expect(
          await tryInsert(
            'slot_holds',
            row({ released_at: '2026-10-04T07:20:00Z', release_reason: reason }),
          ),
          reason,
        ).toBeNull();
      }
      expect(await tryInsert('slot_holds', row({ release_reason: 'expired' }))).toBe(
        SQLSTATE.checkViolation,
      );
      expect(await tryInsert('slot_holds', row({}))).toBeNull();
    });
  });

  it('holds its check by name', async () => {
    expect(await constraintsOf('slot_holds', 'c')).toEqual(
      expect.arrayContaining(['slot_holds_release_reason_check']),
    );
  });
});

describe('ERD §15 rule 49: a suspension case’s link to the case that owes its sessions (B39, the note under T036)', () => {
  /** A compensation case of a new enrollment, and its closing's columns. */
  async function caseRow(): Promise<{
    row: (values: Record<string, unknown>) => Record<string, unknown>;
    closed: Record<string, unknown>;
  }> {
    const { enrollmentId } = await makeEnrollment(db);
    const admin = await makeAdmin(db);
    return {
      row: (values) => ({ enrollment_id: enrollmentId, kind: 'compensation_case', ...values }),
      closed: {
        resolution_notes: 'Probe closing',
        resolved_by_admin_id: admin,
        resolved_at: '2026-10-05T07:00:00Z',
      },
    };
  }

  it('admits the link on a closed student_suspended case, resolved or dismissed; refuses it open, on another reason, or to itself', async () => {
    await inRollback(db, async () => {
      const { row, closed } = await caseRow();
      const owed = await insertRow(db, 'disputes', row({ reason: 'student_fault_confirmed', status: 'open' }));
      expect(
        await tryInsert(
          'disputes',
          row({ reason: 'student_suspended', status: 'dismissed', covered_by_case_id: owed, ...closed }),
        ),
      ).toBeNull();
      expect(
        await tryInsert(
          'disputes',
          row({
            reason: 'student_suspended',
            status: 'resolved',
            resolution: 'compensation_ordered',
            covered_by_case_id: owed,
            ...closed,
          }),
        ),
      ).toBeNull();
      expect(
        await tryInsert('disputes', row({ reason: 'student_suspended', status: 'dismissed', ...closed })),
      ).toBeNull();
      expect(
        await tryInsert(
          'disputes',
          row({ reason: 'student_suspended', status: 'open', covered_by_case_id: owed }),
        ),
      ).toBe(SQLSTATE.checkViolation);
      expect(
        await tryInsert(
          'disputes',
          row({ reason: 'student_banned', status: 'dismissed', covered_by_case_id: owed, ...closed }),
        ),
      ).toBe(SQLSTATE.checkViolation);
      const itself = randomUUID();
      expect(
        await tryInsert(
          'disputes',
          row({
            id: itself,
            reason: 'student_suspended',
            status: 'dismissed',
            covered_by_case_id: itself,
            ...closed,
          }),
        ),
      ).toBe(SQLSTATE.checkViolation);
    });
  });

  it('holds its check and its foreign key by name', async () => {
    expect(await constraintsOf('disputes', 'c')).toEqual(
      expect.arrayContaining(['disputes_covered_by_check']),
    );
    expect(await constraintsOf('disputes', 'f')).toEqual(
      expect.arrayContaining(['disputes_covered_by_case_id_fkey']),
    );
  });
});
