// T066 (FR-174, research R-110): the admins page's actions as the service performs them. Adding an
// administrator writes the row with no password, a secret bound to it, who invited and when, and
// queues `deliver-admin-invite` with the id alone; disabling one ends its sign-in and its sessions;
// neither the disabling nor the second-factor reset may be turned on oneself. The reset itself and
// the recovery codes are `admin-auth.service.spec.ts`'s. Over the real database.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  type AdminWorld,
  buildAdmin,
  inTransaction,
  openSpecDatabase,
  uniqueEmail,
} from './__fixtures__/admin.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let world: AdminWorld;
beforeEach(() => {
  world = buildAdmin(database);
});

async function refusal(work: Promise<unknown>): Promise<DomainError> {
  const error: unknown = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof DomainError)) throw new Error(`expected a DomainError, got ${String(error)}`);
  return error;
}

describe('add', () => {
  it('writes the administrator unenrolled, without a password, invited by the actor, and queues the invite', async () => {
    const actor = await world.createAdministrator();
    const email = uniqueEmail();
    const { adminId } = await inTransaction(database, (tx) =>
      world.admins.add(tx, actor.adminId, { displayName: 'Hala Saeed', email: ` ${email.toUpperCase()} ` }),
    );
    const row = await world.rows.administrator(adminId);
    expect(row).toMatchObject({
      email,
      displayName: 'Hala Saeed',
      passwordHash: null,
      passwordSetAt: null,
      mfaEnrolledAt: null,
      isActive: true,
      invitedByAdminId: actor.adminId,
      invitedAt: world.clock.now(),
    });
    // The secret is bound to the row: it decrypts under this id and is a base32 TOTP secret.
    expect(await world.storedSecret(adminId)).toMatch(/^[A-Z2-7]{32}$/);
    expect(world.queued).toEqual([adminId]);
  });

  it('answers CONFLICT on the email field for an address another administrator holds', async () => {
    const actor = await world.createAdministrator();
    const answer = await refusal(
      inTransaction(database, (tx) =>
        world.admins.add(tx, actor.adminId, { displayName: 'Twice', email: actor.email }),
      ),
    );
    expect(answer.code).toBe('CONFLICT');
    expect(answer.details).toEqual([{ path: 'email', code: 'taken' }]);
    expect(world.queued).toEqual([]);
  });
});

describe('disable', () => {
  it('ends the sign-in and every session, and keeps the row and its name', async () => {
    const actor = await world.createAdministrator();
    const target = await world.createAdministrator();
    const { sessionToken } = await world.auth.signIn(target.email, target.password);
    await inTransaction(database, (tx) => world.admins.disable(tx, actor.adminId, target.adminId));
    const row = await world.rows.administrator(target.adminId);
    expect(row.isActive).toBe(false);
    expect(row.disabledAt).toEqual(world.clock.now());
    expect(row.displayName).toBe('Spec Administrator');
    expect(await world.sessions.resolve(sessionToken)).toBeNull();
    expect((await refusal(world.auth.signIn(target.email, target.password))).code).toBe(
      'ADMIN_SIGN_IN_FAILED',
    );
  });

  it('refuses the administrator’s own account', async () => {
    const actor = await world.createAdministrator();
    const answer = await refusal(
      inTransaction(database, (tx) => world.admins.disable(tx, actor.adminId, actor.adminId)),
    );
    expect(answer.code).toBe('FORBIDDEN');
    expect((await world.rows.administrator(actor.adminId)).isActive).toBe(true);
  });

  it('answers CONFLICT for an administrator already disabled, and NOT_FOUND for none', async () => {
    const actor = await world.createAdministrator();
    const target = await world.createAdministrator({ isActive: false });
    expect(
      (
        await refusal(
          inTransaction(database, (tx) => world.admins.disable(tx, actor.adminId, target.adminId)),
        )
      ).code,
    ).toBe('CONFLICT');
    expect(
      (
        await refusal(
          inTransaction(database, (tx) =>
            world.admins.disable(tx, actor.adminId, '00000000-0000-7000-8000-000000000000'),
          ),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });
});

describe('resetMfa and regenerateRecoveryCodes', () => {
  it('answers NOT_FOUND for an administrator who does not exist', async () => {
    const actor = await world.createAdministrator();
    const answer = await refusal(
      inTransaction(database, (tx) =>
        world.admins.resetMfa(tx, actor.adminId, '00000000-0000-7000-8000-000000000000'),
      ),
    );
    expect(answer.code).toBe('NOT_FOUND');
  });

  it('refuses to regenerate the codes of an administrator not enrolled', async () => {
    const admin = await world.createAdministrator({ enrolled: false });
    const answer = await refusal(
      inTransaction(database, (tx) => world.admins.regenerateRecoveryCodes(tx, admin.adminId)),
    );
    expect(answer.code).toBe('MFA_SETUP_REQUIRED');
  });
});
