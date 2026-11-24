// T052 — the admin's payments monitor over the real tables (FR-400, FR-401, R-220): the service with
// the store over the payments module's queries and the owners' entries (`createPaymentsMonitorService`),
// as `main.ts` binds it through the admin module, and the namespace as `admin.router.ts` mounts it.
//
//   - the list is newest first by the time-ordered id, in keyset pages, a cursor only while more
//     follow; the status filter and the search narrow it; the search matches an order reference
//     exactly and a student's name folded (R-203), only the matching student's orders;
//   - the detail carries the enrollment's package and progress, the order's events oldest first,
//     the outcomes that concern the order, and every paid order of the enrollment;
//   - NO MONITOR PROCEDURE WRITES BEYOND ITS AUDIT ENTRY (FR-401): each is called through the
//     administrator kind on the probe's transaction, and Postgres' own count of the rows that
//     transaction inserted, updated and deleted (`pg_stat_xact_user_tables`) does not move, while
//     the kind describes exactly the call's one entry.
//
// The `payments` table is shared with every other spec, so each probe searches by a token of its
// own, and writes its rows on one transaction it rolls back. The amounts' names are the payments
// module's and the monitor's alone (R-MONEY-6), so the orders are written by SQL, as
// `confirmation-world.ts` writes them, and their figures are `payments-monitor.service.spec.ts`'s.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPaymentsMonitorService,
  paymentsAdminRouter,
} from '../../apps/api/src/modules/payments/index.js';
import type { AuditRecord } from '../../apps/api/src/platform/audit/audit-writer.js';
import {
  closeDatabase,
  type Database,
  openDatabase,
  type Transaction,
} from '../../apps/api/src/platform/db/prisma.repository.js';
import { specDatabaseUrl } from '../../apps/api/src/platform/db/spec-database.fixtures.js';
import { DomainError } from '../../apps/api/src/platform/errors/domain-error.js';
import type { RateLimiter } from '../../apps/api/src/platform/guards/rate-limit.guard.js';
import { createLogger } from '../../apps/api/src/platform/logging/logger.js';
import {
  type AdminSurfaceServices,
  createAdminContext,
} from '../../apps/api/src/surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
} from '../../apps/api/src/surfaces/procedures.js';
import { unusedAdminServices } from '../../apps/api/src/surfaces/services.fixtures.js';
import { paymentsGetOutput, paymentsListOutput } from '../../packages/contracts/src/admin/index.js';
import { addMinutes, dateColumnOf, timeColumnOf } from '../../packages/time/src/index.js';

let database: Database;

beforeAll(() => {
  database = openDatabase(specDatabaseUrl('DATABASE_URL'), {
    poolMax: 2,
    statementTimeoutMs: 30_000,
    idleInTransactionTimeoutMs: 60_000,
  });
});

afterAll(async () => {
  await closeDatabase(database);
});

const ROLLED_BACK = Symbol('rolled back');

/** Runs `probe` on one transaction and rolls back whatever it wrote. */
async function rolledBack(probe: (tx: Transaction) => Promise<void>): Promise<void> {
  try {
    await database.$transaction(
      async (tx) => {
        await probe(tx);
        throw ROLLED_BACK;
      },
      { timeout: 30_000 },
    );
  } catch (thrown) {
    if (thrown !== ROLLED_BACK) throw thrown;
  }
}

const CAIRO = 'Africa/Cairo';
const NOW = new Date('2026-11-10T12:00:00Z');
const PAGE_SIZE = 2;

const monitor = createPaymentsMonitorService({
  settings: {
    read: async (key, schema) => {
      if (key !== 'admin_list_page_size') throw new Error(`unexpected setting ${key}`);
      return schema.parse(PAGE_SIZE);
    },
  },
  now: () => NOW,
});

/** A teacher, two students named after the probe's token, and orders in every state the monitor shows. */
async function world(tx: Transaction) {
  const token = randomUUID().slice(0, 8);
  async function person(displayName: string): Promise<string> {
    const { id } = await tx.user.create({
      data: {
        email: `probe-${randomUUID()}@example.invalid`,
        gender: 'female',
        dateOfBirth: new Date('2010-01-01T00:00:00Z'),
        displayName,
        preferredLanguage: 'ar',
        timezone: CAIRO,
        accountStatus: 'active',
      },
      select: { id: true },
    });
    return id;
  }
  const teacher = await person(`المعلمة ${token}`);
  await tx.teacherProfile.create({
    data: {
      userId: teacher,
      bio: 'Probe',
      qualificationSummary: 'Probe',
      verificationStatus: 'approved',
      payoutVerifiedAt: new Date('2026-10-01T00:00:00Z'),
    },
  });
  const subject = await tx.subject.create({
    data: { nameAr: 'تجويد', nameEn: 'Tajweed', isActive: true },
    select: { id: true, nameAr: true, nameEn: true },
  });
  const { id: packageId } = await tx.package.create({
    data: {
      teacherUserId: teacher,
      subjectId: subject.id,
      sessionCount: 4,
      sessionDurationMinutes: 60,
      pricePiasters: 100_000n,
      isActive: true,
    },
    select: { id: true },
  });
  const { id: slotId } = await tx.availabilitySlot.create({
    data: {
      teacherUserId: teacher,
      dayOfWeek: 2,
      startTimeLocal: new Date('1970-01-01T14:00:00Z'),
      durationMinutes: 60,
      timezone: CAIRO,
      isActive: true,
    },
    select: { id: true },
  });
  async function enrollment(
    student: string,
    status: 'pending_payment' | 'confirmed' | 'cancelled',
  ): Promise<string> {
    const { id } = await tx.enrollment.create({
      data: {
        studentUserId: student,
        teacherUserId: teacher,
        packageId,
        slotId,
        snapshotPricePiasters: 100_000n,
        snapshotSessionCount: 4,
        snapshotDurationMinutes: 60,
        snapshotSubjectId: subject.id,
        snapshotSlotTimezone: CAIRO,
        snapshotTrack: 'recitation',
        status,
        cancellationReason: status === 'cancelled' ? 'slot_unavailable' : null,
        confirmedAt: status === 'confirmed' ? new Date('2026-11-01T00:00:00Z') : null,
        purchasedAt: new Date('2026-11-01T00:00:00Z'),
        quotedFirstSessionLocalDate: new Date('2026-11-03T00:00:00Z'),
      },
      select: { id: true },
    });
    return id;
  }
  async function order(
    enrollmentId: string,
    status: 'created' | 'paid' | 'failed' | 'expired' | 'refunded',
  ): Promise<{ readonly id: string; readonly reference: string }> {
    const reference = `probe-order-${randomUUID()}`;
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                            status, expires_at, updated_at)
      VALUES (${enrollmentId}::uuid, 'fake', ${reference}, 100000, 'EGP',
              ${status}::payment_status, ${NOW}, now())
      RETURNING id::text AS id`;
    if (row === undefined) throw new Error('no order written');
    return { id: row.id, reference };
  }
  async function event(paymentId: string, type: 'paid' | 'failed', receivedAt: Date) {
    await tx.$executeRaw`
      INSERT INTO payment_events (payment_id, provider_event_id, event_type, signature_verified_at,
                                  payload_hash, received_at)
      VALUES (${paymentId}::uuid, ${`fake_evt_${randomUUID()}`}, ${type}::payment_event_type,
              ${receivedAt}, 'probe-hash', ${receivedAt})`;
  }
  async function session(enrollmentId: string, student: string, n: number, startsAt: string) {
    const start = new Date(startsAt);
    await tx.session.create({
      data: {
        enrollmentId,
        teacherUserId: teacher,
        studentUserId: student,
        sequenceNumber: n,
        scheduledDateLocal: dateColumnOf(startsAt.slice(0, 10)),
        scheduledStartTimeLocal: timeColumnOf(startsAt.slice(11, 19)),
        timezone: CAIRO,
        scheduledStartAt: start,
        scheduledEndAt: new Date(addMinutes(start, 60)),
        status: n === 1 ? 'done' : 'scheduled',
      },
    });
  }

  const yusra = await person(`يُسْرى-${token}`);
  const huda = await person(`هدى-${token}`);
  // Yusra's enrollment: a failed order, a Retry paid, then a second payment (a compensation case).
  const yusras = await enrollment(yusra, 'confirmed');
  const failed = await order(yusras, 'failed');
  const paid = await order(yusras, 'paid');
  const second = await order(yusras, 'paid');
  await event(failed.id, 'failed', new Date('2026-11-01T10:01:00Z'));
  await event(paid.id, 'paid', new Date('2026-11-01T10:06:00Z'));
  await event(second.id, 'paid', new Date('2026-11-01T11:00:00Z'));
  await tx.enrollmentEvent.createMany({
    data: [
      {
        enrollmentId: yusras,
        kind: 'order_failed',
        paymentId: failed.id,
        occurredAt: new Date('2026-11-01T10:01:00Z'),
      },
      {
        enrollmentId: yusras,
        kind: 'confirmed',
        paymentId: paid.id,
        occurredAt: new Date('2026-11-01T10:06:00Z'),
      },
    ],
  });
  await session(yusras, yusra, 1, '2026-11-03T12:00:00.000Z');
  await session(yusras, yusra, 2, '2026-11-17T12:00:00.000Z');
  // T024 of specs/004-sessions (GAP-8): Yusra's holds, oldest first: one released before its reason
  // was recorded, one expired, and the one Pay converted.
  const holds: string[] = [];
  for (const [placed, released, releaseReason] of [
    ['2026-11-01T09:00:00Z', '2026-11-01T09:46:00Z', null],
    ['2026-11-01T09:50:00Z', '2026-11-01T10:36:00Z', 'expired'],
    ['2026-11-01T10:00:00Z', '2026-11-01T10:06:00Z', 'converted'],
  ] as const) {
    const { id } = await tx.slotHold.create({
      data: {
        slotId,
        studentUserId: yusra,
        packageId,
        sessionCount: 4,
        enrollmentId: yusras,
        createdAt: new Date(placed),
        expiresAt: new Date(addMinutes(new Date(placed), 45)),
        releasedAt: new Date(released),
        releaseReason,
      },
      select: { id: true },
    });
    holds.push(id);
  }
  // Huda's: paid, then refused at confirmation (`slot_unavailable`).
  const hudas = await enrollment(huda, 'cancelled');
  const refused = await order(hudas, 'paid');
  const created = await order(await enrollment(huda, 'pending_payment'), 'created');
  return { token, subject, yusras, failed, paid, second, refused, created, holds };
}

describe('payments.list over the real tables', () => {
  it('pages a student’s orders newest first, keyset by id, a cursor only while more follow', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const first = await monitor.list(tx, { search: `يسرى-${w.token}` });
      expect(first.items.map(({ paymentId }) => paymentId)).toEqual([w.second.id, w.paid.id]);
      expect(first.nextCursor).toBe(w.paid.id);
      const rest = await monitor.list(tx, {
        search: `يسرى-${w.token}`,
        ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
      });
      expect(rest.items.map(({ paymentId }) => paymentId)).toEqual([w.failed.id]);
      expect(rest).not.toHaveProperty('nextCursor');
      expect(first.items[0]).toMatchObject({
        gatewayOrderId: w.second.reference,
        student: { displayName: `يُسْرى-${w.token}` },
        status: 'paid',
        enrollmentCancelled: false,
      });
    });
  });

  it('folds the typed name as the stored one (R-203), and matches no other student', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const huda = await monitor.list(tx, { search: `هدى-${w.token.toUpperCase()}` });
      expect(huda.items.map(({ paymentId }) => paymentId)).toEqual([w.created.id, w.refused.id]);
    });
  });

  it('filters by status, and says a paid order’s enrollment was cancelled', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const paid = await monitor.list(tx, { status: 'paid', search: `هدى-${w.token}` });
      expect(paid.items).toEqual([
        expect.objectContaining({ paymentId: w.refused.id, enrollmentCancelled: true }),
      ]);
      const failed = await monitor.list(tx, { status: 'failed', search: `يسرى-${w.token}` });
      expect(failed.items.map(({ paymentId }) => paymentId)).toEqual([w.failed.id]);
    });
  });

  it('matches an order reference exactly, and a part of one matches nothing', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const exact = await monitor.list(tx, { search: w.refused.reference });
      expect(exact.items.map(({ paymentId }) => paymentId)).toEqual([w.refused.id]);
      const part = await monitor.list(tx, { search: w.refused.reference.slice(0, -1) });
      expect(part.items).toEqual([]);
    });
  });

  // B42, T047 (the note under T047, Q6 (a)): `/payments?enrollment=`, the link from `/sessions`
  // and `/cases`, lists that enrollment's orders alone, newest first, in keyset pages.
  it('lists one enrollment’s orders alone when asked by its id, in keyset pages', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const first = await monitor.list(tx, { enrollmentId: w.yusras });
      expect(first.items.map(({ paymentId }) => paymentId)).toEqual([w.second.id, w.paid.id]);
      expect(first.nextCursor).toBe(w.paid.id);
      const rest = await monitor.list(tx, {
        enrollmentId: w.yusras,
        ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
      });
      expect(rest.items.map(({ paymentId }) => paymentId)).toEqual([w.failed.id]);
      expect(rest).not.toHaveProperty('nextCursor');
      const failedOnly = await monitor.list(tx, { enrollmentId: w.yusras, status: 'failed' });
      expect(failedOnly.items.map(({ paymentId }) => paymentId)).toEqual([w.failed.id]);
      // Another enrollment's id answers its own orders, never Yusra's.
      const hudas = await monitor.list(tx, {
        enrollmentId: (await tx.payment.findUniqueOrThrow({ where: { id: w.refused.id } }))
          .enrollmentId,
      });
      expect(hudas.items.map(({ paymentId }) => paymentId)).toEqual([w.refused.id]);
    });
  });
});

describe('payments.get over the real tables', () => {
  it('answers the enrollment’s package and progress, the events, this order’s outcomes and every paid order', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const detail = await monitor.get(tx, w.paid.id);
      expect(detail).toMatchObject({
        paymentId: w.paid.id,
        gatewayOrderId: w.paid.reference,
        status: 'paid',
        currency: 'EGP',
        student: { displayName: `يُسْرى-${w.token}` },
        enrollment: {
          enrollmentId: w.yusras,
          summary: { subject: w.subject, track: 'recitation', sessionCount: 4 },
          teacher: { displayName: `المعلمة ${w.token}` },
          status: 'confirmed',
          completed: 1,
          total: 4,
        },
        events: [{ eventType: 'paid', receivedAt: '2026-11-01T10:06:00.000Z' }],
        outcomes: [{ kind: 'confirmed', occurredAt: '2026-11-01T10:06:00.000Z' }],
      });
      expect(detail.paidOrders.map(({ paymentId }) => paymentId)).toEqual([w.paid.id, w.second.id]);
      const failed = await monitor.get(tx, w.failed.id);
      expect(failed.outcomes).toEqual([
        { kind: 'order_failed', occurredAt: '2026-11-01T10:01:00.000Z' },
      ]);
      expect(failed.events).toEqual([
        { eventType: 'failed', receivedAt: '2026-11-01T10:01:00.000Z' },
      ]);
    });
  });

  it('lists the enrollment’s holds oldest first, a release reason only where recorded (T024, GAP-8)', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const detail = await monitor.get(tx, w.paid.id);
      expect(detail.enrollment?.holds).toEqual([
        {
          holdId: w.holds[0],
          placedAt: '2026-11-01T09:00:00.000Z',
          expiresAt: '2026-11-01T09:45:00.000Z',
          releasedAt: '2026-11-01T09:46:00.000Z',
        },
        {
          holdId: w.holds[1],
          placedAt: '2026-11-01T09:50:00.000Z',
          expiresAt: '2026-11-01T10:35:00.000Z',
          releasedAt: '2026-11-01T10:36:00.000Z',
          releaseReason: 'expired',
        },
        {
          holdId: w.holds[2],
          placedAt: '2026-11-01T10:00:00.000Z',
          expiresAt: '2026-11-01T10:45:00.000Z',
          releasedAt: '2026-11-01T10:06:00.000Z',
          releaseReason: 'converted',
        },
      ]);
      // Huda's refused enrollment has no hold of its own here: an empty list, never absent.
      expect((await monitor.get(tx, w.refused.id)).enrollment?.holds).toEqual([]);
    });
  });

  // B42, T047 (the follow-up under T047): Phase 3's outcomes reach the timeline. An enrollment
  // cancelled by the administration and then restored reads both, never «cancelled» alone, and its
  // completion follows; each passes the contract's parse, as the procedure's output does.
  it('answers Phase 3’s restored and completed outcomes beside the cancellation, oldest first', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      await tx.enrollmentEvent.createMany({
        data: [
          {
            enrollmentId: w.yusras,
            kind: 'cancelled',
            cancellationReason: 'admin',
            occurredAt: new Date('2026-11-05T10:00:00Z'),
          },
          {
            enrollmentId: w.yusras,
            kind: 'restored',
            occurredAt: new Date('2026-11-06T10:00:00Z'),
          },
          {
            enrollmentId: w.yusras,
            kind: 'completed',
            occurredAt: new Date('2026-11-09T10:00:00Z'),
          },
        ],
      });
      const detail = await monitor.get(tx, w.paid.id);
      const expected = [
        { kind: 'confirmed', occurredAt: '2026-11-01T10:06:00.000Z' },
        { kind: 'cancelled', cancellationReason: 'admin', occurredAt: '2026-11-05T10:00:00.000Z' },
        { kind: 'restored', occurredAt: '2026-11-06T10:00:00.000Z' },
        { kind: 'completed', occurredAt: '2026-11-09T10:00:00.000Z' },
      ];
      expect(detail.outcomes).toEqual(expected);
      expect(paymentsGetOutput.parse(detail).outcomes).toEqual(expected);
    });
  });

  it('answers NOT_FOUND for an id no order holds', async () => {
    await rolledBack(async (tx) => {
      await expect(monitor.get(tx, randomUUID())).rejects.toEqual(new DomainError('NOT_FOUND'));
    });
  });
});

// 006:T018 (the follow-up carried from T014, option (d), the owner's «موافق» of 2026-11-24): an
// automatic order with no gateway id (its intention unanswered, or refused before it was sent; ERD §15
// rule 72) is listed with `''` beside every other order of its page, read by `payments.get` with `''`,
// and never matched by a search; each order carries its kind, month, automatic and decline, and the
// whole answer passes the contract's parse. Example: a 1,000 EGP automatic month.
describe("the programme's orders over the real tables (006:T018)", () => {
  async function automatic(
    tx: Transaction,
    enrollmentId: string,
    month: number,
    status: 'expired' | 'failed',
  ): Promise<string> {
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO payments (enrollment_id, gateway, gateway_order_id, gross_piasters, currency,
                            status, expires_at, updated_at, kind, instalment_month, automatic,
                            attempt, decline_kind)
      VALUES (${enrollmentId}::uuid, 'fake', NULL, 100000, 'EGP', ${status}::payment_status,
              ${NOW}, now(), 'instalment', ${month}, true, 0,
              ${status === 'failed' ? 'hard' : null}::decline_kind)
      RETURNING id::text AS id`;
    if (row === undefined) throw new Error('no order written');
    return row.id;
  }

  it('lists a page holding an order with no gateway id whole, and reads it with an empty reference', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const hudas = (await tx.payment.findUniqueOrThrow({ where: { id: w.created.id } }))
        .enrollmentId;
      const unanswered = await automatic(tx, hudas, 2, 'expired');
      const refused = await automatic(tx, hudas, 3, 'failed');
      const page = await monitor.list(tx, { enrollmentId: hudas });
      expect(page.items.map(({ paymentId }) => paymentId)).toEqual([refused, unanswered]);
      const rest = await monitor.list(tx, {
        enrollmentId: hudas,
        ...(page.nextCursor === undefined ? {} : { cursor: page.nextCursor }),
      });
      expect(rest.items.map(({ paymentId }) => paymentId)).toEqual([w.created.id]);
      expect(page.items[0]).toMatchObject({
        gatewayOrderId: '',
        kind: 'instalment',
        instalmentMonth: 3,
        automatic: true,
        declineKind: 'hard',
        status: 'failed',
      });
      expect(page.items[1]).toMatchObject({ gatewayOrderId: '', instalmentMonth: 2 });
      expect(page.items[1]).not.toHaveProperty('declineKind');
      expect(rest.items[0]).toMatchObject({ kind: 'package', automatic: false });
      // A name search lists it too; no reference search matches it.
      const named = await monitor.list(tx, { search: `هدى-${w.token}` });
      expect(named.items.map(({ paymentId }) => paymentId)).toContain(unanswered);
      const byReference = await monitor.list(tx, { search: w.created.reference });
      expect(byReference.items.map(({ paymentId }) => paymentId)).toEqual([w.created.id]);
      const detail = await monitor.get(tx, unanswered);
      expect(detail).toMatchObject({
        paymentId: unanswered,
        gatewayOrderId: '',
        kind: 'instalment',
        instalmentMonth: 2,
        automatic: true,
        status: 'expired',
      });
      expect(paymentsGetOutput.parse(detail).gatewayOrderId).toBe('');
      expect(paymentsListOutput.parse(page).items).toHaveLength(2);
    });
  });
});

describe('no monitor procedure writes beyond its audit entry (FR-401)', () => {
  const log = createLogger({ level: 'info', destination: { write: () => undefined } });
  const callerFor = createAdminCallerFactory(createAdminRouter({ payments: paymentsAdminRouter }));
  const ADMIN = randomUUID();

  /** Rows the transaction inserted, updated and deleted so far, every table summed. */
  async function writesOf(tx: Transaction): Promise<bigint> {
    const [row] = await tx.$queryRaw<{ writes: bigint }[]>`
      SELECT COALESCE(SUM(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint AS writes
      FROM pg_stat_xact_user_tables`;
    return row?.writes ?? 0n;
  }

  it('payments.list and payments.get write no row, and each describes exactly its one entry', async () => {
    await rolledBack(async (tx) => {
      const w = await world(tx);
      const written: AuditRecord[] = [];
      const services = new Proxy(unusedAdminServices, {
        get: (target, name, receiver) =>
          name === 'payments' ? monitor : Reflect.get(target, name, receiver),
      }) as AdminSurfaceServices;
      const caller = callerFor(
        createAdminContext({
          session: { adminId: ADMIN, sessionId: ADMIN, mfaVerified: true },
          log,
          administration: {
            // The call runs on the probe's transaction, so its writes are counted there.
            transactions: { run: (work) => work(tx) },
            auditWriter: {
              write: async (_tx, record) => {
                written.push(record);
              },
            },
          },
          services,
          // Every administrator call is counted by the signed-in default since T062 (FR-470).
          rateLimiter: { check: async () => undefined } as unknown as RateLimiter,
          clientAddress: '203.0.113.9',
        }),
      );
      const before = await writesOf(tx);
      await caller.payments.list({ search: `يسرى-${w.token}` });
      await caller.payments.list({ status: 'paid', search: w.refused.reference });
      await caller.payments.get({ paymentId: w.paid.id });
      expect(await writesOf(tx)).toBe(before);
      expect(written).toEqual([
        { adminId: ADMIN, action: 'payments.listed', targetType: 'admin', targetId: ADMIN },
        { adminId: ADMIN, action: 'payments.listed', targetType: 'admin', targetId: ADMIN },
        { adminId: ADMIN, action: 'payments.viewed', targetType: 'payment', targetId: w.paid.id },
      ]);
    });
  });
});
