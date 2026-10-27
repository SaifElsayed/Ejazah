// T067 — the administrator surface's `admins` namespace as it is served (admin-surface.md "`admins`";
// FR-173, FR-174). Every procedure is the administrator kind: one transaction, the action's audit
// entry written in it with the actor from the session, and nothing kept when the call is refused.
// A destructive action carries its mandatory reason into the entry (screens.md §24); the list is a
// read, audited under `admins.read` with the reader as its target, which no audit list shows
// (owner's decision 2026-10-21). What the actions do is `admins.service.spec.ts`'s.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { toErrorShape } from '../../surfaces/procedures.js';
import {
  type AdminWorld,
  buildAdmin,
  openSpecDatabase,
  uniqueEmail,
} from './__fixtures__/admin.js';
import {
  type AdminCaller,
  type AdminSurface,
  surfaceOf,
  verifiedToken,
} from './__fixtures__/surface.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let world: AdminWorld;
let surface: AdminSurface;
let actor: { readonly adminId: string; readonly email: string };
let caller: AdminCaller;
beforeEach(async () => {
  world = buildAdmin(database);
  surface = surfaceOf(world, database);
  const admin = await world.createAdministrator({ displayName: 'هالة سعيد' });
  actor = admin;
  caller = await surface.bearing(await verifiedToken(surface, world, admin));
});

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

describe('admins.add', () => {
  it('answers the new id, queues the invite and audits admin.add on the new administrator', async () => {
    const { adminId } = await caller.admins.add({ displayName: 'منى خليل', email: uniqueEmail() });
    expect(world.queued).toEqual([adminId]);
    const [entry] = await world.rows.auditEntriesOf(adminId);
    expect(entry).toMatchObject({
      adminId: actor.adminId,
      action: 'admin.add',
      targetType: 'admin',
    });
  });

  it('keeps nothing of a refused add: an address taken writes no entry', async () => {
    const taken = await world.createAdministrator();
    expect(await codeOf(caller.admins.add({ displayName: 'منى خليل', email: taken.email }))).toBe(
      'CONFLICT',
    );
    expect(world.queued).toEqual([]);
  });
});

describe('admins.disable and admins.resetMfa', () => {
  it('disable audits admin.disable with the reason and the standing before and after', async () => {
    const target = await world.createAdministrator();
    await caller.admins.disable({ adminId: target.adminId, reason: 'ترك العمل' });
    const [entry] = await world.rows.auditEntriesOf(target.adminId);
    expect(entry).toMatchObject({
      adminId: actor.adminId,
      action: 'admin.disable',
      targetType: 'admin',
      reason: 'ترك العمل',
      before: { isActive: true },
      after: { isActive: false },
    });
  });

  it('resetMfa audits admin.reset_mfa with the reason', async () => {
    const target = await world.createAdministrator();
    await caller.admins.resetMfa({ adminId: target.adminId, reason: 'فقد الهاتف' });
    const [entry] = await world.rows.auditEntriesOf(target.adminId);
    expect(entry).toMatchObject({
      adminId: actor.adminId,
      action: 'admin.reset_mfa',
      targetType: 'admin',
      reason: 'فقد الهاتف',
    });
  });

  it('refuses an empty reason before anything is written', async () => {
    const target = await world.createAdministrator();
    expect(await codeOf(caller.admins.disable({ adminId: target.adminId, reason: '   ' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect((await world.rows.administrator(target.adminId)).isActive).toBe(true);
    expect(await world.rows.auditEntriesOf(target.adminId)).toEqual([]);
  });

  it('keeps nothing of a refused action: disabling oneself writes no entry', async () => {
    expect(await codeOf(caller.admins.disable({ adminId: actor.adminId, reason: 'تجربة' }))).toBe(
      'FORBIDDEN',
    );
    const entries = await world.rows.auditEntriesOf(actor.adminId);
    expect(entries.map((entry) => entry.action)).not.toContain('admin.disable');
  });
});

describe('admins.recoveryCodes.regenerate and admins.list', () => {
  it('regenerate answers the new codes once and audits it on the caller’s own account', async () => {
    // The sign-in spent this step's code; the next one regenerates (T096).
    world.clock.advance(30);
    const { recoveryCodes } = await caller.admins.recoveryCodes.regenerate({
      code: await world.currentCode(actor.adminId),
    });
    expect(recoveryCodes).toHaveLength(10);
    const [entry] = await world.rows.auditEntriesOf(actor.adminId);
    expect(entry).toMatchObject({
      action: 'admin.regenerate_recovery_codes',
      targetId: actor.adminId,
    });
    expect(JSON.stringify(entry)).not.toContain(recoveryCodes[0]);
  });

  it('the procedure without a code always refuses, changes nothing and audits nothing (T096; R-API-9 keeps its contract)', async () => {
    const before = await world.rows.recoveryCodes(actor.adminId);
    expect(await codeOf(caller.admins.regenerateRecoveryCodes({}))).toBe('CODE_INVALID');
    expect(await world.rows.recoveryCodes(actor.adminId)).toEqual(before);
    const actions = (await world.rows.auditEntriesOf(actor.adminId)).map((entry) => entry.action);
    expect(actions).not.toContain('admin.regenerate_recovery_codes');
  });

  it('list answers the tab and is audited as admins.read naming the reader', async () => {
    const answer = await caller.admins.list({ tab: 'active', search: actor.email, page: 1 });
    expect(answer.rows).toEqual([expect.objectContaining({ adminId: actor.adminId, self: true })]);
    const [entry] = await world.rows.auditEntriesOf(actor.adminId);
    expect(entry).toMatchObject({
      action: 'admins.read',
      targetType: 'admin',
      targetId: actor.adminId,
    });
  });
});
