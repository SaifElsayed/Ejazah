// T142 — the database refuses double booking, also under concurrency (FR-BOOK-5, FR-BOOK-9,
// FR-BOOK-12, ERD section 15.17-19, ADR 0010).
//
// TWO KINDS OF PROBE. A probe of what one transaction may write runs, like every other probe, as
// the application role inside a transaction that is rolled back. A probe of what two transactions
// may write together cannot: "exactly one commits" needs a real commit, and the second transaction
// cannot see the first one's parent rows (users, offers, enrollments) until they are committed. Those
// probes commit their fixtures through the application role too, and the rows are removed after the
// suite by a connection as the OWNER role, which is the only role that may delete a user, an
// enrollment or a session (T065). The owner connection runs no probe; it only deletes the rows this
// file recorded creating, so the suite needs `DATABASE_URL_OWNER` as well as `DATABASE_URL`.
//
// HOW A RACE IS STAGED. Transaction A writes and stays open. Transaction B writes the conflicting row
// and waits on A's lock; a third connection watches `pg_stat_activity` until B is seen waiting, so
// the race is decided by the database, not by timing. Then A commits and B's statement ends: with a
// unique violation (23505) on a hold, an exclusion violation (23P01) on a session.
//
// The exclusion constraints are DEFERRABLE INITIALLY IMMEDIATE (T141): an ordinary write is checked
// as it happens, and only `SET CONSTRAINTS ... DEFERRED` moves the check to the commit.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SQLSTATE,
  attempt,
  connectAsApplication,
  enrollmentValues,
  inRollback,
  insertRow,
  insertStatement,
  makeOffer,
  makeUser,
  type Db,
} from './harness';

type Offer = Awaited<ReturnType<typeof makeOffer>>;

/**
 * A UTC instant `minutes` after 09:00Z on the probe day, as an ISO string. Written as text rather
 * than computed with a date: only packages/time does datetime arithmetic (R-TIME-1), and an
 * instant on one fixed UTC day needs none.
 */
function at(minutes: number): string {
  const total = 9 * 60 + minutes;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `2026-10-04T${pad(Math.floor(total / 60))}:${pad(total % 60)}:00Z`;
}

/** The columns of one session of `enrollment`, from `start` to `end` minutes after 09:00Z. */
function sessionValues(
  enrollment: { enrollmentId: string; teacherId: string; studentId: string },
  sequenceNumber: number,
  start: number,
  end: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const startAt = at(start);
  return {
    enrollment_id: enrollment.enrollmentId,
    teacher_user_id: enrollment.teacherId,
    student_user_id: enrollment.studentId,
    sequence_number: sequenceNumber,
    scheduled_date_local: startAt.slice(0, 10),
    scheduled_start_time_local: startAt.slice(11, 19),
    timezone: 'UTC',
    scheduled_start_at: startAt,
    scheduled_end_at: at(end),
    status: 'scheduled',
    ...extra,
  };
}

/** The columns of one hold of `slotId` by `studentId`, active unless `extra` releases it. */
function holdValues(
  slotId: string,
  studentId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slot_id: slotId,
    student_user_id: studentId,
    // The database never compares a hold with the clock: a NULL `released_at` is what makes it active.
    expires_at: at(15),
    ...extra,
  };
}

/** One enrollment between `studentId` and the offer's teacher, written through `db`. */
async function enroll(
  db: Db,
  offer: Offer,
  studentId: string,
): Promise<{ enrollmentId: string; teacherId: string; studentId: string }> {
  const enrollmentId = await insertRow(db, 'enrollments', enrollmentValues(offer, studentId));
  return { enrollmentId, teacherId: offer.teacherId, studentId };
}

/** Resolves to null when `query` succeeds or to its SQLSTATE, so a pending refusal is never unhandled. */
function outcome(query: Promise<unknown>): Promise<string | null> {
  return query.then(
    () => null,
    (error: unknown) => {
      const code = (error as { code?: unknown }).code;
      if (typeof code !== 'string') throw error;
      return code;
    },
  );
}

describe('one transaction (T142)', () => {
  let db: Db;

  beforeAll(async () => {
    db = await connectAsApplication();
  });

  afterAll(async () => {
    await db?.end();
  });

  async function tryInsert(table: string, values: Record<string, unknown>): Promise<string | null> {
    const { sql, params } = await insertStatement(db, table, values);
    return attempt(db, sql, params);
  }

  it('an overlapping session is refused for the same teacher', async () => {
    await inRollback(db, async () => {
      const offer = await makeOffer(db);
      const first = await enroll(db, offer, await makeUser(db));
      const second = await enroll(db, offer, await makeUser(db));
      expect(await tryInsert('sessions', sessionValues(first, 1, 0, 60))).toBeNull();
      expect(await tryInsert('sessions', sessionValues(second, 1, 30, 90))).toBe(
        SQLSTATE.exclusionViolation,
      );
    });
  });

  it('an overlapping session is refused for the same student', async () => {
    await inRollback(db, async () => {
      const student = await makeUser(db);
      const first = await enroll(db, await makeOffer(db), student);
      const second = await enroll(db, await makeOffer(db), student);
      expect(await tryInsert('sessions', sessionValues(first, 1, 0, 60))).toBeNull();
      expect(await tryInsert('sessions', sessionValues(second, 1, 30, 90))).toBe(
        SQLSTATE.exclusionViolation,
      );
    });
  });

  it('back-to-back sessions are accepted, for one teacher and for one student', async () => {
    await inRollback(db, async () => {
      const offer = await makeOffer(db);
      const student = await makeUser(db);
      const sameBoth = await enroll(db, offer, student);
      const sameTeacher = await enroll(db, offer, await makeUser(db));
      const sameStudent = await enroll(db, await makeOffer(db), student);
      expect(await tryInsert('sessions', sessionValues(sameBoth, 1, 0, 60))).toBeNull();
      expect(await tryInsert('sessions', sessionValues(sameTeacher, 1, 60, 120))).toBeNull();
      expect(await tryInsert('sessions', sessionValues(sameStudent, 1, -60, 0))).toBeNull();
    });
  });

  it.each(['done', 'student_no_show', 'teacher_no_show', 'both_no_show'])(
    'a %s session blocks its time',
    async (status) => {
      await inRollback(db, async () => {
        const offer = await makeOffer(db);
        const held = await enroll(db, offer, await makeUser(db));
        const other = await enroll(db, offer, await makeUser(db));
        expect(await tryInsert('sessions', sessionValues(held, 1, 0, 60, { status }))).toBeNull();
        expect(await tryInsert('sessions', sessionValues(other, 1, 0, 60))).toBe(
          SQLSTATE.exclusionViolation,
        );
      });
    },
  );

  it.each([
    ['cancelled by agreement', { status: 'cancelled_by_agreement' }],
    ['cancelled by an administrator', { status: 'cancelled_by_admin' }],
    ['soft-deleted', { deleted_at: '2026-10-03T12:00:00Z' }],
  ])('a %s session does not block its time', async (_label, extra) => {
    await inRollback(db, async () => {
      const offer = await makeOffer(db);
      const freed = await enroll(db, offer, await makeUser(db));
      const other = await enroll(db, offer, await makeUser(db));
      expect(await tryInsert('sessions', sessionValues(freed, 1, 0, 60, extra))).toBeNull();
      expect(await tryInsert('sessions', sessionValues(other, 1, 0, 60))).toBeNull();
    });
  });

  it('an UPDATE that moves a session onto another is refused', async () => {
    await inRollback(db, async () => {
      const enrollment = await enroll(db, await makeOffer(db), await makeUser(db));
      await insertRow(db, 'sessions', sessionValues(enrollment, 1, 0, 60));
      const moved = await insertRow(db, 'sessions', sessionValues(enrollment, 2, 120, 180));
      expect(
        await attempt(
          db,
          'UPDATE "sessions" SET scheduled_start_at = $2, scheduled_end_at = $3 WHERE id = $1',
          [moved, at(30), at(90)],
        ),
      ).toBe(SQLSTATE.exclusionViolation);
    });
  });

  it('a released hold does not block its slot or its student', async () => {
    await inRollback(db, async () => {
      const offer = await makeOffer(db);
      const student = await makeUser(db);
      const released = { released_at: '2026-10-04T08:00:00Z' };
      expect(await tryInsert('slot_holds', holdValues(offer.slotId, student, released))).toBeNull();
      expect(await tryInsert('slot_holds', holdValues(offer.slotId, student))).toBeNull();
    });
  });
});

describe('two transactions (T142)', () => {
  // `setup` writes and commits the fixtures; `first` and `second` are the racing transactions;
  // `watcher` sees `second` waiting. All four are the application role.
  let setup: Db;
  let first: Db;
  let second: Db;
  let watcher: Db;
  const users: string[] = [];
  const subjects: string[] = [];

  beforeAll(async () => {
    const owner = process.env['DATABASE_URL_OWNER'];
    if (owner === undefined || owner === '') {
      throw new Error(
        'DATABASE_URL_OWNER is not set: these probes commit rows, and only the owner role can remove them',
      );
    }
    const connected = await Promise.allSettled([
      connectAsApplication(),
      connectAsApplication(),
      connectAsApplication(),
      connectAsApplication(),
    ]);
    const clients = connected.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const failed = connected.find((result) => result.status === 'rejected');
    if (failed !== undefined) {
      // End the ones that did connect, or they hold the process open.
      await Promise.all(clients.map((db) => db.end()));
      throw failed.reason;
    }
    [setup, first, second, watcher] = clients as [Db, Db, Db, Db];
  });

  afterAll(async () => {
    await Promise.all([setup, first, second, watcher].map((db) => db?.end()));
    if (users.length === 0 && subjects.length === 0) return;
    const owner = new pg.Client({ connectionString: process.env['DATABASE_URL_OWNER'] });
    await owner.connect();
    try {
      await owner.query('BEGIN');
      await owner.query(
        'DELETE FROM "sessions" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
        [users],
      );
      await owner.query('DELETE FROM "slot_holds" WHERE student_user_id = ANY($1)', [users]);
      await owner.query(
        'DELETE FROM "enrollments" WHERE teacher_user_id = ANY($1) OR student_user_id = ANY($1)',
        [users],
      );
      await owner.query('DELETE FROM "availability_slots" WHERE teacher_user_id = ANY($1)', [
        users,
      ]);
      await owner.query('DELETE FROM "packages" WHERE teacher_user_id = ANY($1)', [users]);
      await owner.query('DELETE FROM "subjects" WHERE id = ANY($1)', [subjects]);
      await owner.query('DELETE FROM "users" WHERE id = ANY($1)', [users]);
      await owner.query('COMMIT');
    } finally {
      await owner.end();
    }
  });

  /** A teacher's offer, committed and recorded for removal. */
  async function committedOffer(): Promise<Offer> {
    const offer = await makeOffer(setup);
    users.push(offer.teacherId);
    subjects.push(offer.subjectId);
    return offer;
  }

  /** A student, committed and recorded for removal. */
  async function committedStudent(): Promise<string> {
    const id = await makeUser(setup);
    users.push(id);
    return id;
  }

  /**
   * Resolves once the backend `pid` is waiting on a lock; fails after about two seconds, inside
   * vitest's five-second test timeout, so a missing guard is reported as "never waited" rather
   * than as a timeout. The watcher can read `wait_event_type` of `second` only because both are
   * the same role: PostgreSQL hides those columns of another role's session from a non-superuser,
   * so making either connection the owner would make every race fail here.
   */
  async function seenWaiting(pid: number): Promise<void> {
    for (let look = 0; look < 100; look += 1) {
      const { rows } = await watcher.query<{ waiting: boolean }>(
        `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
        [pid],
      );
      if (rows[0]?.waiting === true) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`backend ${String(pid)} never waited on a lock`);
  }

  /** The backend pid of `db`. */
  async function pidOf(db: Db): Promise<number> {
    const { rows } = await db.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const [row] = rows;
    if (row === undefined) throw new Error('could not read the backend pid');
    return row.pid;
  }

  /**
   * `first` writes `firstWrite` and stays open; `second` writes `secondWrite` and is seen waiting;
   * `first` commits. Returns how `second`'s write ended. Both transactions are closed on return.
   */
  async function race(
    firstWrite: (db: Db) => Promise<unknown>,
    secondWrite: (db: Db) => Promise<unknown>,
  ): Promise<string | null> {
    const secondPid = await pidOf(second);
    let firstCommitted = false;
    await first.query('BEGIN');
    await second.query('BEGIN');
    try {
      await firstWrite(first);
      const ended = outcome(secondWrite(second));
      await seenWaiting(secondPid);
      await first.query('COMMIT');
      firstCommitted = true;
      return await ended;
    } finally {
      // A ROLLBACK after a successful COMMIT only draws a "no transaction in progress" warning.
      if (!firstCommitted) await first.query('ROLLBACK');
      await second.query('ROLLBACK');
    }
  }

  async function insertWith(db: Db, table: string, values: Record<string, unknown>): Promise<void> {
    const { sql, params } = await insertStatement(db, table, values);
    await db.query(sql, params);
  }

  async function activeHolds(column: 'slot_id' | 'student_user_id', id: string): Promise<number> {
    const { rows } = await setup.query<{ count: string }>(
      `SELECT count(*) AS count FROM "slot_holds" WHERE ${column} = $1 AND released_at IS NULL`,
      [id],
    );
    return Number(rows[0]?.count);
  }

  it('two transactions holding the same slot: exactly one commits', async () => {
    const offer = await committedOffer();
    const [one, two] = [await committedStudent(), await committedStudent()];
    const refused = await race(
      (db) => insertWith(db, 'slot_holds', holdValues(offer.slotId, one)),
      (db) => insertWith(db, 'slot_holds', holdValues(offer.slotId, two)),
    );
    expect(refused).toBe(SQLSTATE.uniqueViolation);
    expect(await activeHolds('slot_id', offer.slotId)).toBe(1);
  });

  it('two transactions holding for the same student: exactly one commits', async () => {
    const [offerOne, offerTwo] = [await committedOffer(), await committedOffer()];
    const student = await committedStudent();
    const refused = await race(
      (db) => insertWith(db, 'slot_holds', holdValues(offerOne.slotId, student)),
      (db) => insertWith(db, 'slot_holds', holdValues(offerTwo.slotId, student)),
    );
    expect(refused).toBe(SQLSTATE.uniqueViolation);
    expect(await activeHolds('student_user_id', student)).toBe(1);
  });

  it('two transactions releasing the same expired hold and each holding the slot: exactly one hold results (ADR 0010 D3)', async () => {
    const offer = await committedOffer();
    const [expiredFor, one, two] = [
      await committedStudent(),
      await committedStudent(),
      await committedStudent(),
    ];
    const expired = await insertRow(
      setup,
      'slot_holds',
      holdValues(offer.slotId, expiredFor, { expires_at: '2026-10-04T08:00:00Z' }),
    );
    const release =
      'UPDATE "slot_holds" SET released_at = now() WHERE id = $1 AND released_at IS NULL';
    let secondReleased: number | null = null;
    const refused = await race(
      async (db) => {
        await db.query(release, [expired]);
        await insertWith(db, 'slot_holds', holdValues(offer.slotId, one));
      },
      async (db) => {
        secondReleased = (await db.query(release, [expired])).rowCount;
        await insertWith(db, 'slot_holds', holdValues(offer.slotId, two));
      },
    );
    expect(secondReleased).toBe(0);
    expect(refused).toBe(SQLSTATE.uniqueViolation);
    expect(await activeHolds('slot_id', offer.slotId)).toBe(1);
  });

  it('two transactions writing overlapping sessions for one teacher: exactly one commits', async () => {
    const offer = await committedOffer();
    const enrollmentOne = await enroll(setup, offer, await committedStudent());
    const enrollmentTwo = await enroll(setup, offer, await committedStudent());
    const refused = await race(
      (db) => insertWith(db, 'sessions', sessionValues(enrollmentOne, 1, 0, 60)),
      (db) => insertWith(db, 'sessions', sessionValues(enrollmentTwo, 1, 30, 90)),
    );
    expect(refused).toBe(SQLSTATE.exclusionViolation);
    const { rows } = await setup.query<{ count: string }>(
      'SELECT count(*) AS count FROM "sessions" WHERE teacher_user_id = $1',
      [offer.teacherId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('two transactions writing overlapping sessions for one student: exactly one commits', async () => {
    const student = await committedStudent();
    const enrollmentOne = await enroll(setup, await committedOffer(), student);
    const enrollmentTwo = await enroll(setup, await committedOffer(), student);
    const refused = await race(
      (db) => insertWith(db, 'sessions', sessionValues(enrollmentOne, 1, 0, 60)),
      (db) => insertWith(db, 'sessions', sessionValues(enrollmentTwo, 1, 30, 90)),
    );
    expect(refused).toBe(SQLSTATE.exclusionViolation);
    const { rows } = await setup.query<{ count: string }>(
      'SELECT count(*) AS count FROM "sessions" WHERE student_user_id = $1',
      [student],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('under SET CONSTRAINTS DEFERRED, a uniform shift of back-to-back sessions commits', async () => {
    const enrollment = await enroll(setup, await committedOffer(), await committedStudent());
    const early = await insertRow(setup, 'sessions', sessionValues(enrollment, 1, 0, 60));
    const late = await insertRow(setup, 'sessions', sessionValues(enrollment, 2, 60, 120));
    const shift =
      'UPDATE "sessions" SET scheduled_start_at = scheduled_start_at + interval \'1 hour\', ' +
      "scheduled_end_at = scheduled_end_at + interval '1 hour' WHERE id = $1";
    await first.query('BEGIN');
    try {
      await first.query('SET CONSTRAINTS ALL DEFERRED');
      // Moving the earlier one first lands it on the later one until the later one moves too.
      await first.query(shift, [early]);
      await first.query(shift, [late]);
      expect(await outcome(first.query('COMMIT'))).toBeNull();
    } finally {
      await first.query('ROLLBACK');
    }
  });

  it('under SET CONSTRAINTS DEFERRED, a true overlap is refused at commit', async () => {
    const enrollment = await enroll(setup, await committedOffer(), await committedStudent());
    await insertRow(setup, 'sessions', sessionValues(enrollment, 1, 0, 60));
    const moved = await insertRow(setup, 'sessions', sessionValues(enrollment, 2, 120, 180));
    await first.query('BEGIN');
    try {
      await first.query('SET CONSTRAINTS ALL DEFERRED');
      await first.query(
        'UPDATE "sessions" SET scheduled_start_at = $2, scheduled_end_at = $3 WHERE id = $1',
        [moved, at(30), at(90)],
      );
      expect(await outcome(first.query('COMMIT'))).toBe(SQLSTATE.exclusionViolation);
    } finally {
      await first.query('ROLLBACK');
    }
  });
});
