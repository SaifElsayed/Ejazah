// T067 — the administrator surface's `audit` and `home` namespaces as they are served (admin-surface.md
// "`audit` and `home`"; FR-176, FR-181). Each is a read, audited like any administrative call under an
// action ending in `.read` with the reader as its target, since none has a single target (owner's
// decision 2026-10-21); what the lists answer is `audit-query.service.spec.ts`'s and
// `home.service.spec.ts`'s.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { type AdminWorld, buildAdmin, openSpecDatabase } from './__fixtures__/admin.js';
import { type AdminCaller, surfaceOf, verifiedToken } from './__fixtures__/surface.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let world: AdminWorld;
let actorId: string;
let caller: AdminCaller;
beforeEach(async () => {
  world = buildAdmin(database);
  const surface = surfaceOf(world, database);
  const admin = await world.createAdministrator();
  actorId = admin.adminId;
  caller = await surface.bearing(await verifiedToken(surface, world, admin));
});

describe('audit.list and audit.get', () => {
  it('answers a target’s entries, leaving out the reads, and is audited as audit.read naming the reader', async () => {
    world.clock.advance(30);
    await caller.admins.recoveryCodes.regenerate({ code: await world.currentCode(actorId) });
    const answer = await caller.audit.list({ targetId: actorId, page: 1 });
    expect(answer.rows.map((row) => row.action)).toEqual(['admin.regenerate_recovery_codes']);
    expect(answer.rows[0]).toMatchObject({ targetType: 'admin', targetName: 'Spec Administrator' });
    const entries = await world.rows.auditEntriesOf(actorId);
    expect(entries[0]).toMatchObject({
      action: 'audit.read',
      targetType: 'admin',
      targetId: actorId,
    });
  });

  it('refuses a date bound without its zone: a client sends a calendar day and a zone, never an instant', async () => {
    const thrown = await caller.audit.list({ from: '2026-10-01', page: 1 }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      caller.audit.list({
        from: '2026-10-01',
        to: '2026-10-21',
        timeZone: 'Africa/Cairo',
        page: 1,
      }),
    ).resolves.toMatchObject({ total: expect.any(Number) });
  });

  it('audit.get answers one entry with its snapshots, audited as audit.read', async () => {
    const target = await world.createAdministrator();
    await caller.admins.disable({ adminId: target.adminId, reason: 'ترك العمل' });
    const [listed] = (await caller.audit.list({ targetId: target.adminId, page: 1 })).rows;
    const entry = await caller.audit.get({ entryId: listed?.entryId ?? '' });
    expect(entry).toMatchObject({
      action: 'admin.disable',
      before: { isActive: true },
      after: { isActive: false },
    });
    const [own] = await world.rows.auditEntriesOf(actorId);
    expect(own).toMatchObject({ action: 'audit.read' });
  });
});

describe('home.summary', () => {
  it('answers the two queue cards and the latest actions, audited as home.read naming the reader', async () => {
    const summary = await caller.home.summary();
    expect(summary.queues).toEqual({
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    });
    expect(summary.latestActions.every((row) => !row.action.endsWith('.read'))).toBe(true);
    // 003:T109: the output keeps the payment mode.
    expect(summary.paymentMode).toBe('test');
    const [entry] = await world.rows.auditEntriesOf(actorId);
    expect(entry).toMatchObject({ action: 'home.read', targetType: 'admin', targetId: actorId });
  });
});
