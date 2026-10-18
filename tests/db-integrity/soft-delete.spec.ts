// T053 (US2): soft deletion, each item through the path that holds it (FR-026, SC-004, ERD §0 and
// §15.10–11, data-model.md §4, ADR 0006).
//
// THROUGH THE DATABASE, as the application role (T049 harness): a soft-deleted user releases its
// phone number and email, so the person can sign up again. Held by the partial unique indexes of
// T066; the same values on two live users are still refused, which proves the indexes exist.
//
// THROUGH THE CLIENT extended by T148, connected as the application role: soft-deleted rows of
// users, sessions, enrollments and ijazahs are absent from reads, counts, aggregates and groups,
// and a soft-deleted enrollment is absent from reads, so nothing can review it (ADR 0006 D3). The
// T049 harness proves the role of a `pg` connection only, so the client's own `current_user` is
// compared with the role the harness proved (PR #41 review, n2). A hard delete through the client
// is refused by the extension with an error naming soft deletion, before the database's own
// refusal (n1), and an update matches no soft-deleted row.
//
// NOTHING IS LEFT BEHIND. The `pg` probe runs in the harness's rolled-back transaction. The client
// probes write inside one Prisma interactive transaction that always ends by throwing `ROLLBACK`,
// so Prisma rolls it back; the delete refusal writes nothing.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import {
  attempt,
  connectAsApplication,
  type Db,
  inRollback,
  insertStatement,
  makeUser,
  SQLSTATE,
} from './harness';

let db: Db;
let database: Database;

beforeAll(async () => {
  // The harness proves DATABASE_URL is the application role, never the owner, before anything runs.
  db = await connectAsApplication();
  database = openDatabase(process.env['DATABASE_URL'] ?? '', {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
  await db.end();
});

/** A unique stand-in phone number, E.164 shaped. Never a real person's. */
function phoneNumber(): string {
  return `+2011${String(Number.parseInt(randomUUID().slice(0, 8), 16) % 100_000_000).padStart(8, '0')}`;
}

function emailAddress(): string {
  return `probe-${randomUUID()}@example.invalid`;
}

describe('a soft-deleted user’s phone number and email, through the database (T053, T066)', () => {
  it('are refused to a second live user and reusable once the first is soft-deleted', async () => {
    await inRollback(db, async (tx) => {
      const phone = phoneNumber();
      const email = emailAddress();
      const first = await makeUser(tx, { phone, email });

      const again = await insertStatement(tx, 'users', {
        phone,
        email,
        gender: 'male',
        date_of_birth: '1990-01-01',
        display_name: 'Probe user',
        preferred_language: 'ar',
        timezone: 'Africa/Cairo',
        account_status: 'active',
      });
      expect(await attempt(tx, again.sql, again.params)).toBe(SQLSTATE.uniqueViolation);

      await tx.query('UPDATE users SET deleted_at = now() WHERE id = $1', [first]);
      expect(await attempt(tx, again.sql, again.params)).toBeNull();
    });
  });
});

const ROLLBACK = new Error('rolled back on purpose: the probe leaves no row behind');

/** Runs `probe` in one interactive transaction of the client, always rolled back. */
async function inClientRollback(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLBACK;
      },
      { timeout: 30_000 },
    );
  } catch (error: unknown) {
    if (error !== ROLLBACK) throw error;
  }
}

const DELETED_AT = '2026-10-08T00:00:00Z';

/** The columns of one live user, for the client's `create`; an email, since rule 32 (T009). */
function userData() {
  return {
    phone: phoneNumber(),
    email: emailAddress(),
    gender: 'male',
    dateOfBirth: '1990-01-01T00:00:00Z',
    displayName: 'Probe user',
    preferredLanguage: 'ar',
    timezone: 'Africa/Cairo',
    accountStatus: 'active',
  } as const;
}

function newUser(tx: Transaction): Promise<{ id: string }> {
  return tx.user.create({ data: userData(), select: { id: true } });
}

/** A teacher's subject, package and slot, then `count` enrollments of one student on them. */
async function newEnrollments(
  tx: Transaction,
  count: number,
): Promise<{ ids: string[]; studentId: string; teacherId: string; subjectId: string }> {
  const teacher = await newUser(tx);
  const student = await newUser(tx);
  const subject = await tx.subject.create({
    data: { nameAr: 'مادة', nameEn: 'Subject', isActive: true },
    select: { id: true },
  });
  const offer = await tx.package.create({
    data: {
      teacherUserId: teacher.id,
      subjectId: subject.id,
      sessionCount: 4,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true },
  });
  const slot = await tx.availabilitySlot.create({
    data: {
      teacherUserId: teacher.id,
      dayOfWeek: 0,
      startTimeLocal: '1970-01-01T09:00:00Z',
      durationMinutes: 60,
      timezone: 'Africa/Cairo',
      isActive: true,
    },
    select: { id: true },
  });
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const enrollment = await tx.enrollment.create({
      data: {
        studentUserId: student.id,
        teacherUserId: teacher.id,
        packageId: offer.id,
        slotId: slot.id,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: subject.id,
        snapshotSlotTimezone: 'Africa/Cairo',
        status: 'pending_payment',
        purchasedAt: '2026-10-04T07:00:00Z',
      },
      select: { id: true },
    });
    ids.push(enrollment.id);
  }
  return { ids, studentId: student.id, teacherId: teacher.id, subjectId: subject.id };
}

/** What every ordinary read of one table answers over a live row and a soft-deleted one. */
interface OrdinaryReads {
  findMany(): Promise<readonly { id: string }[]>;
  findFirst(): Promise<unknown>;
  findUnique(): Promise<unknown>;
  count(): Promise<number>;
  aggregate(): Promise<number>;
  groupBy(): Promise<number>;
}

async function expectOnlyLive(reads: OrdinaryReads, liveId: string): Promise<void> {
  expect((await reads.findMany()).map((row) => row.id)).toEqual([liveId]);
  expect(await reads.findFirst()).toBeNull();
  expect(await reads.findUnique()).toBeNull();
  expect(await reads.count()).toBe(1);
  expect(await reads.aggregate()).toBe(1);
  expect(await reads.groupBy()).toBe(1);
}

/**
 * The refusal is the extension's own error, read from the start of its message: Prisma's errors
 * start with the invocation and quote the surrounding source lines, so a pattern searched anywhere
 * in the message would match this file's own text (the database's 42501 refusal did).
 */
async function expectRefusedAsSoftDeletion(deletion: Promise<unknown>): Promise<void> {
  const error: unknown = await deletion.then(
    () => undefined,
    (refusal: unknown) => refusal,
  );
  expect(error).toBeInstanceOf(Error);
  const message = error instanceof Error ? error.message : '';
  expect(message.startsWith('Hard delete refused')).toBe(true);
  expect(message).toContain('soft deletion');
}

describe('soft-deleted rows, through the client extended by T148 (T053)', () => {
  it('connects as the application role the harness proved (PR #41 review, n2)', async () => {
    const [client] = await database.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
    const { rows } = await db.query<{ role: string }>('SELECT current_user AS role');
    expect(client?.role).toBeDefined();
    expect(client?.role).toBe(rows[0]?.role);
  });

  it('hides a soft-deleted user from reads, counts, aggregates and groups', async () => {
    await inClientRollback(async (tx) => {
      const live = await newUser(tx);
      const gone = await newUser(tx);
      await tx.user.update({ where: { id: gone.id }, data: { deletedAt: DELETED_AT } });
      const both = { id: { in: [live.id, gone.id] } };
      await expectOnlyLive(
        {
          findMany: () => tx.user.findMany({ where: both, select: { id: true } }),
          findFirst: () => tx.user.findFirst({ where: { id: gone.id } }),
          findUnique: () => tx.user.findUnique({ where: { id: gone.id } }),
          count: () => tx.user.count({ where: both }),
          aggregate: async () =>
            (await tx.user.aggregate({ where: both, _count: { id: true } }))._count.id,
          groupBy: async () =>
            (await tx.user.groupBy({ by: ['id'], where: both, _count: { id: true } })).length,
        },
        live.id,
      );
    });
  });

  it('hides a soft-deleted enrollment from reads, counts, aggregates and groups', async () => {
    await inClientRollback(async (tx) => {
      const {
        ids: [liveId = '', goneId = ''],
      } = await newEnrollments(tx, 2);
      await tx.enrollment.update({ where: { id: goneId }, data: { deletedAt: DELETED_AT } });
      const both = { id: { in: [liveId, goneId] } };
      await expectOnlyLive(
        {
          findMany: () => tx.enrollment.findMany({ where: both, select: { id: true } }),
          findFirst: () => tx.enrollment.findFirst({ where: { id: goneId } }),
          findUnique: () => tx.enrollment.findUnique({ where: { id: goneId } }),
          count: () => tx.enrollment.count({ where: both }),
          aggregate: async () =>
            (await tx.enrollment.aggregate({ where: both, _count: { id: true } }))._count.id,
          groupBy: async () =>
            (await tx.enrollment.groupBy({ by: ['id'], where: both, _count: { id: true } })).length,
        },
        liveId,
      );
    });
  });

  it('hides a soft-deleted enrollment from its student’s reads, so nothing can review it (ADR 0006)', async () => {
    await inClientRollback(async (tx) => {
      const {
        ids: [enrollmentId = ''],
        studentId,
      } = await newEnrollments(tx, 1);
      await tx.enrollment.update({ where: { id: enrollmentId }, data: { deletedAt: DELETED_AT } });
      expect(await tx.enrollment.findUnique({ where: { id: enrollmentId } })).toBeNull();
      expect(
        await tx.enrollment.findMany({ where: { studentUserId: studentId }, select: { id: true } }),
      ).toEqual([]);
    });
  });

  it('hides a soft-deleted session from reads, counts, aggregates and groups', async () => {
    await inClientRollback(async (tx) => {
      const {
        ids: [enrollmentId = ''],
        studentId,
        teacherId,
      } = await newEnrollments(tx, 1);
      const session = (sequenceNumber: number, startAt: string, endAt: string) =>
        tx.session.create({
          data: {
            enrollmentId,
            teacherUserId: teacherId,
            studentUserId: studentId,
            sequenceNumber,
            scheduledDateLocal: '2026-10-04T00:00:00Z',
            scheduledStartTimeLocal: '1970-01-01T09:00:00Z',
            timezone: 'Africa/Cairo',
            scheduledStartAt: startAt,
            scheduledEndAt: endAt,
            status: 'scheduled',
          },
          select: { id: true },
        });
      const live = await session(1, '2026-10-04T06:00:00Z', '2026-10-04T07:00:00Z');
      const gone = await session(2, '2026-10-11T06:00:00Z', '2026-10-11T07:00:00Z');
      await tx.session.update({ where: { id: gone.id }, data: { deletedAt: DELETED_AT } });
      const both = { id: { in: [live.id, gone.id] } };
      await expectOnlyLive(
        {
          findMany: () => tx.session.findMany({ where: both, select: { id: true } }),
          findFirst: () => tx.session.findFirst({ where: { id: gone.id } }),
          findUnique: () => tx.session.findUnique({ where: { id: gone.id } }),
          count: () => tx.session.count({ where: both }),
          aggregate: async () =>
            (await tx.session.aggregate({ where: both, _count: { id: true } }))._count.id,
          groupBy: async () =>
            (await tx.session.groupBy({ by: ['id'], where: both, _count: { id: true } })).length,
        },
        live.id,
      );
    });
  });

  it('hides a soft-deleted ijazah from reads, counts, aggregates and groups', async () => {
    await inClientRollback(async (tx) => {
      const {
        ids: [enrollmentId = ''],
        studentId,
        teacherId,
        subjectId,
      } = await newEnrollments(tx, 1);
      const ijazah = () =>
        tx.ijazah.create({
          data: {
            certificateNumber: randomUUID(),
            enrollmentId,
            studentUserId: studentId,
            teacherUserId: teacherId,
            subjectId,
            mode: 'generated',
            language: 'ar',
            certificateStorageKey: 'probe',
            paperCopyIntended: false,
            verificationTokenHash: randomUUID(),
            grantedAt: '2026-10-04T07:00:00Z',
          },
          select: { id: true },
        });
      const live = await ijazah();
      const gone = await ijazah();
      await tx.ijazah.update({ where: { id: gone.id }, data: { deletedAt: DELETED_AT } });
      const both = { id: { in: [live.id, gone.id] } };
      await expectOnlyLive(
        {
          findMany: () => tx.ijazah.findMany({ where: both, select: { id: true } }),
          findFirst: () => tx.ijazah.findFirst({ where: { id: gone.id } }),
          findUnique: () => tx.ijazah.findUnique({ where: { id: gone.id } }),
          count: () => tx.ijazah.count({ where: both }),
          aggregate: async () =>
            (await tx.ijazah.aggregate({ where: both, _count: { id: true } }))._count.id,
          groupBy: async () =>
            (await tx.ijazah.groupBy({ by: ['id'], where: both, _count: { id: true } })).length,
        },
        live.id,
      );
    });
  });

  it('matches no soft-deleted row on update', async () => {
    await inClientRollback(async (tx) => {
      const gone = await newUser(tx);
      await tx.user.update({ where: { id: gone.id }, data: { deletedAt: DELETED_AT } });
      await expect(
        tx.user.update({ where: { id: gone.id }, data: { displayName: 'Renamed' } }),
      ).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  // `id` is the only Prisma `@unique` a user carries: phone and email are unique through the
  // partial indexes of T066, raw SQL the schema language cannot state, so neither can be an
  // upsert's `where`. Matching no soft-deleted row, the upsert takes its `create` branch, and
  // that row may carry the deleted user's phone and email, which T066 released.
  it('creates a new row on upsert over a soft-deleted one, which stays as it was', async () => {
    await inClientRollback(async (tx) => {
      const deletedUser = userData();
      const gone = await tx.user.create({ data: deletedUser, select: { id: true } });
      await tx.user.update({ where: { id: gone.id }, data: { deletedAt: DELETED_AT } });

      const upserted = await tx.user.upsert({
        where: { id: gone.id },
        create: { ...userData(), phone: deletedUser.phone, displayName: 'Signed up again' },
        update: { displayName: 'Renamed' },
        select: { id: true, phone: true, displayName: true },
      });
      expect(upserted.id).not.toBe(gone.id);
      expect(upserted).toMatchObject({ phone: deletedUser.phone, displayName: 'Signed up again' });

      const [stored] = await tx.$queryRaw<{ display_name: string; deleted: boolean }[]>`
        SELECT display_name, deleted_at IS NOT NULL AS deleted FROM users WHERE id = ${gone.id}::uuid`;
      expect(stored).toEqual({ display_name: deletedUser.displayName, deleted: true });
    });
  });

  it('reads soft-deleted rows through the named opt-in includeDeleted only (data-model.md §4, PR #41 review n3)', async () => {
    try {
      await database.includeDeleted.$transaction(
        async (raw) => {
          const live = await raw.user.create({ data: userData(), select: { id: true } });
          const gone = await raw.user.create({ data: userData(), select: { id: true } });
          await raw.user.update({ where: { id: gone.id }, data: { deletedAt: DELETED_AT } });
          const both = { id: { in: [live.id, gone.id] } };
          expect(await raw.user.count({ where: both })).toBe(2);
          expect(await raw.user.findUnique({ where: { id: gone.id } })).not.toBeNull();
          throw ROLLBACK;
        },
        { timeout: 30_000 },
      );
    } catch (error: unknown) {
      if (error !== ROLLBACK) throw error;
    }
  });

  it('refuses a hard delete on each of the four tables, naming soft deletion (PR #41 review, n1)', async () => {
    const where = { id: randomUUID() };
    await expectRefusedAsSoftDeletion(database.user.delete({ where }));
    await expectRefusedAsSoftDeletion(database.user.deleteMany({ where }));
    await expectRefusedAsSoftDeletion(database.session.delete({ where }));
    await expectRefusedAsSoftDeletion(database.session.deleteMany({ where }));
    await expectRefusedAsSoftDeletion(database.enrollment.delete({ where }));
    await expectRefusedAsSoftDeletion(database.enrollment.deleteMany({ where }));
    await expectRefusedAsSoftDeletion(database.ijazah.delete({ where }));
    await expectRefusedAsSoftDeletion(database.ijazah.deleteMany({ where }));
  });
});
