// T075, identity half (FR-190 to FR-194, research R-114): payout setup and the two entries the
// payments module calls for a signed recipient event.
//
// `register` hands the details to the payment port outside any database transaction (B15 check,
// decision 5), then, keyed through the kernel's idempotency (FR-106), stores the gateway's recipient
// reference encrypted and bound to the profile's row with its SHA-256 lookup hash, sets
// `payout_configured_at` and clears `payout_verified_at` and the last rejection: the first setup and
// a replacement alike (FR-193). `markPayoutVerified` sets the instant and clears the rejection
// (FR-191); `markPayoutRejected` keeps the gateway's reason as plain text, cut to the contract's
// length, and leaves the account unverified. Each answers false for a hash no teacher holds and
// changes no row, so a verdict for an account a replacement retired changes nothing. `get` answers
// the four states. No raw account number reaches a column, a log line or an answer (FR-190): a
// sweep over every account the port was handed. The standing a replacement leaves is read through
// the real session resolution (T076, owner's decision 4 at B15's check).
import { PAYOUT_REJECTED_REASON_MAX_LENGTH } from '@ijazah/contracts';
import { z } from 'zod';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ColumnCipher, DecryptionError } from '../../platform/crypto/encryption.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  createAppCallerFactory,
  createAppRouter,
  teacherProcedure,
} from '../../surfaces/procedures.js';
import { createAccount, openSpecDatabase, SPEC_ENCRYPTION_KEY } from './__fixtures__/identity.js';
import {
  buildPayout,
  columnsContaining,
  createApprovedTeacher,
  type Payout,
  PayoutRows,
  specDetails,
  specKey,
} from './__fixtures__/payout.js';
import { appContextFor, payoutSurfaceOf } from './__fixtures__/payout-surface.js';
import { IdentityRepository } from './identity.repository.js';
import { markPayoutRejected, markPayoutVerified, payoutRefHash } from './payout.service.js';

const COLUMN = 'teacher_profiles.payout_account_ref_encrypted';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

let spec: Payout;
beforeEach(() => {
  spec = buildPayout(database);
});

const rows = () => new PayoutRows(database);
const cipher = new ColumnCipher(SPEC_ENCRYPTION_KEY);

/** The reference the port answered for its last registration. */
function lastRef(): string {
  const ref = spec.port.calls.at(-1)?.recipientRef;
  if (ref === undefined) throw new Error('the port registered no recipient');
  return ref;
}

async function register(userId: string, details = specDetails(), key = specKey()) {
  await spec.payout.register(userId, { details, idempotencyKey: key });
  return lastRef();
}

const verify = (refHash: string, at: Date) =>
  database.$transaction((tx) => markPayoutVerified(tx, refHash, at));
const reject = (refHash: string, reason: string | undefined) =>
  database.$transaction((tx) => markPayoutRejected(tx, refHash, reason));

describe('register', () => {
  it('first setup: asks the port before any transaction opens, then stores the reference encrypted, row-bound and hashed, configured and unverified', async () => {
    const userId = await createApprovedTeacher(database);
    const details = specDetails();
    await spec.payout.register(userId, { details, idempotencyKey: specKey() });

    expect(spec.port.calls).toEqual([{ teacherUserId: userId, details, recipientRef: lastRef() }]);
    expect(spec.events).toEqual(['port', 'transaction', 'committing']);

    const profile = await rows().profile(userId);
    expect(profile).toMatchObject({
      payoutAccountRefHash: payoutRefHash(lastRef()),
      payoutConfiguredAt: spec.clock.now(),
      payoutVerifiedAt: null,
      payoutRejectedReason: null,
    });
    const stored = profile?.payoutAccountRefEncrypted;
    if (profile == null || stored == null) throw new Error('no reference was stored');
    expect(cipher.decrypt(stored, COLUMN, profile.id)).toBe(lastRef());
    // Bound to its row: the same bytes read for another row are refused.
    expect(() => cipher.decrypt(stored, COLUMN, userId)).toThrow(DecryptionError);
    expect(Buffer.from(stored).includes(lastRef())).toBe(false);
  });

  it('the hash is the SHA-256 of the reference in lower-case hex', () => {
    expect(payoutRefHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('stores the value where the re-encryption job reads the column', async () => {
    const userId = await createApprovedTeacher(database);
    await register(userId);
    const profile = await rows().profile(userId);
    const column = new IdentityRepository(database).payoutAccountRefs();
    expect(column.column).toBe(COLUMN);
    const [read] = await column.page(idBefore(profile?.id ?? ''), 1);
    expect(read?.id).toBe(profile?.id);
    expect(cipher.decrypt(read?.value ?? new Uint8Array(), COLUMN, read?.id ?? '')).toBe(lastRef());
  });

  it('a replacement registers anew: the new reference and hash, a new configured instant, verified and the rejection cleared (FR-193)', async () => {
    const userId = await createApprovedTeacher(database);
    const first = await register(userId);
    expect(await verify(payoutRefHash(first), spec.clock.now())).toBe(true);
    spec.clock.advance(3600);

    const second = await register(userId);
    expect(second).not.toBe(first);
    const profile = await rows().profile(userId);
    expect(profile).toMatchObject({
      payoutAccountRefHash: payoutRefHash(second),
      payoutConfiguredAt: spec.clock.now(),
      payoutVerifiedAt: null,
      payoutRejectedReason: null,
    });
    expect(
      cipher.decrypt(
        profile?.payoutAccountRefEncrypted ?? new Uint8Array(),
        COLUMN,
        profile?.id ?? '',
      ),
    ).toBe(second);
    expect(await rows().holdersOf(payoutRefHash(first))).toBe(0);
  });

  it('a replacement after a rejection clears the reason', async () => {
    const userId = await createApprovedTeacher(database);
    const first = await register(userId);
    expect(await reject(payoutRefHash(first), 'Account holder name does not match')).toBe(true);
    await register(userId);
    await expect(spec.payout.get(userId)).resolves.toEqual({
      state: 'pending_verification',
      configuredAt: spec.clock.now().toISOString(),
    });
  });

  it('a retry with the same key is answered from the committed row; the port is asked again and its second recipient is not kept (Phase 2 note)', async () => {
    const userId = await createApprovedTeacher(database);
    const details = specDetails();
    const key = specKey();
    const first = await register(userId, details, key);
    const second = await register(userId, details, key);
    expect(second).not.toBe(first);
    expect(spec.port.calls).toHaveLength(2);
    expect((await rows().profile(userId))?.payoutAccountRefHash).toBe(payoutRefHash(first));
  });

  it('the same key with other details is refused CONFLICT and changes nothing', async () => {
    const userId = await createApprovedTeacher(database);
    const key = specKey();
    const first = await register(userId, specDetails(), key);
    await expect(register(userId, specDetails(), key)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await rows().profile(userId))?.payoutAccountRefHash).toBe(payoutRefHash(first));
  });

  it('a port failure opens no transaction and claims no key, so a retry with the same key registers', async () => {
    const userId = await createApprovedTeacher(database);
    const details = specDetails();
    const key = specKey();
    spec.port.failNext();
    await expect(register(userId, details, key)).rejects.toThrow('spec gateway: unreachable');
    expect(spec.events).toEqual(['port']);
    expect(await rows().profile(userId)).toMatchObject({
      payoutAccountRefEncrypted: null,
      payoutAccountRefHash: null,
      payoutConfiguredAt: null,
    });

    const ref = await register(userId, details, key);
    expect((await rows().profile(userId))?.payoutAccountRefHash).toBe(payoutRefHash(ref));
  });

  it('refuses a caller with no teacher profile FORBIDDEN, before the port is asked', async () => {
    const { userId } = await createAccount(database, { role: 'teacher' });
    await expect(register(userId)).rejects.toEqual(new DomainError('FORBIDDEN'));
    expect(spec.port.calls).toEqual([]);
  });
});

describe('markPayoutVerified and markPayoutRejected (the payments module’s entries)', () => {
  it('a verified verdict sets the instant and clears the last rejection (FR-191)', async () => {
    const userId = await createApprovedTeacher(database);
    const hash = payoutRefHash(await register(userId));
    expect(await reject(hash, 'Name mismatch')).toBe(true);
    const at = new Date('2026-10-26T10:00:00Z');
    expect(await verify(hash, at)).toBe(true);
    expect(await rows().profile(userId)).toMatchObject({
      payoutVerifiedAt: at,
      payoutRejectedReason: null,
    });
  });

  it('a second verified verdict for a verified account keeps the first instant and answers true', async () => {
    const userId = await createApprovedTeacher(database);
    const hash = payoutRefHash(await register(userId));
    const first = new Date('2026-10-26T10:00:00Z');
    expect(await verify(hash, first)).toBe(true);
    expect(await verify(hash, new Date('2026-10-27T10:00:00Z'))).toBe(true);
    expect((await rows().profile(userId))?.payoutVerifiedAt).toEqual(first);
  });

  it('a rejected verdict keeps the reason and leaves the account unverified, a verified one included', async () => {
    const userId = await createApprovedTeacher(database);
    const hash = payoutRefHash(await register(userId));
    expect(await verify(hash, new Date('2026-10-26T10:00:00Z'))).toBe(true);
    expect(await reject(hash, 'Account closed')).toBe(true);
    expect(await rows().profile(userId)).toMatchObject({
      payoutVerifiedAt: null,
      payoutRejectedReason: 'Account closed',
    });
  });

  it('keeps the reason as plain text: control characters become spaces, and a long one is cut to the contract’s length', async () => {
    const userId = await createApprovedTeacher(database);
    const hash = payoutRefHash(await register(userId));
    expect(await reject(hash, '  Bad\u0000account\nnumber\u0007 ')).toBe(true);
    expect((await rows().profile(userId))?.payoutRejectedReason).toBe('Bad account number');

    expect(await reject(hash, 'x'.repeat(PAYOUT_REJECTED_REASON_MAX_LENGTH + 50))).toBe(true);
    expect((await rows().profile(userId))?.payoutRejectedReason).toBe(
      'x'.repeat(PAYOUT_REJECTED_REASON_MAX_LENGTH),
    );

    // A cut never splits a character written as two UTF-16 units.
    const emoji = '😀'.repeat(PAYOUT_REJECTED_REASON_MAX_LENGTH);
    expect(await reject(hash, emoji)).toBe(true);
    const cut = (await rows().profile(userId))?.payoutRejectedReason ?? '';
    expect(cut.length).toBeLessThanOrEqual(PAYOUT_REJECTED_REASON_MAX_LENGTH);
    expect(cut).toBe('😀'.repeat(PAYOUT_REJECTED_REASON_MAX_LENGTH / 2));
  });

  it('a rejection the gateway gave no reason for is still a rejection, with no reason shown', async () => {
    const userId = await createApprovedTeacher(database);
    const hash = payoutRefHash(await register(userId));
    expect(await reject(hash, undefined)).toBe(true);
    await expect(spec.payout.get(userId)).resolves.toEqual({
      state: 'rejected',
      configuredAt: spec.clock.now().toISOString(),
    });
    expect(await reject(hash, ' \n ')).toBe(true);
    await expect(spec.payout.get(userId)).resolves.toEqual({
      state: 'rejected',
      configuredAt: spec.clock.now().toISOString(),
    });
  });

  it('answers false for a hash no teacher holds and changes no row', async () => {
    const userId = await createApprovedTeacher(database);
    await register(userId);
    const before = await rows().profile(userId);
    const unknown = payoutRefHash(`spec_rcp_unknown_${specKey()}`);
    expect(await verify(unknown, new Date())).toBe(false);
    expect(await reject(unknown, 'Name mismatch')).toBe(false);
    expect(await rows().holdersOf(unknown)).toBe(0);
    expect(await rows().profile(userId)).toEqual(before);
  });

  it('a verdict for the account a replacement retired answers false and leaves the new account pending', async () => {
    const userId = await createApprovedTeacher(database);
    const retired = payoutRefHash(await register(userId));
    await register(userId);
    const before = await rows().profile(userId);
    expect(await verify(retired, new Date())).toBe(false);
    expect(await reject(retired, 'Account closed')).toBe(false);
    expect(await rows().profile(userId)).toEqual(before);
    await expect(spec.payout.get(userId)).resolves.toMatchObject({ state: 'pending_verification' });
  });
});

describe('get', () => {
  it('answers the four states with their fields', async () => {
    const userId = await createApprovedTeacher(database);
    await expect(spec.payout.get(userId)).resolves.toEqual({ state: 'not_configured' });

    const hash = payoutRefHash(await register(userId));
    const configuredAt = spec.clock.now().toISOString();
    await expect(spec.payout.get(userId)).resolves.toEqual({
      state: 'pending_verification',
      configuredAt,
    });

    expect(await reject(hash, 'Name mismatch')).toBe(true);
    await expect(spec.payout.get(userId)).resolves.toEqual({
      state: 'rejected',
      configuredAt,
      rejectedReason: 'Name mismatch',
    });

    const at = new Date('2026-10-26T10:00:00Z');
    expect(await verify(hash, at)).toBe(true);
    await expect(spec.payout.get(userId)).resolves.toEqual({
      state: 'verified',
      configuredAt,
      verifiedAt: at.toISOString(),
    });
  });

  it('reads a verified instant as verified whatever else the row holds, as the standing does', async () => {
    const at = new Date('2026-10-01T08:00:00Z');
    const userId = await createApprovedTeacher(database, { payoutVerifiedAt: at });
    await expect(spec.payout.get(userId)).resolves.toEqual({
      state: 'verified',
      verifiedAt: at.toISOString(),
    });
  });
});

// The sweep reads every column of every table after six registrations: under a second alone,
// past the default five seconds under the full suite's parallel load (B15 integration).
describe('no raw account number anywhere (FR-190, R-DB-8, R-SEC-2)', { timeout: 15_000 }, () => {
  it('in no column, log line or answer, for a first setup, a retry, a replacement, a rejection and a failed registration', async () => {
    const userId = await createApprovedTeacher(database);
    const { accessToken } = await spec.sessions.issue(userId);
    const surface = payoutSurfaceOf(spec.payout, spec.sessions);
    const caller = await surface.bearing(accessToken);
    const answers: unknown[] = [];

    const key = specKey();
    const first = specDetails();
    answers.push(await caller.teacher.payout.register({ details: first, idempotencyKey: key }));
    answers.push(await caller.teacher.payout.register({ details: first, idempotencyKey: key }));
    answers.push(await caller.teacher.payout.get());
    const conflict = await caller.teacher.payout
      .register({ details: specDetails(), idempotencyKey: key })
      .catch((error: unknown) => error);
    answers.push(conflict);

    answers.push(
      await caller.teacher.payout.register({ details: specDetails(), idempotencyKey: specKey() }),
    );
    expect(await reject(payoutRefHash(lastRef()), 'Name mismatch')).toBe(true);
    answers.push(await caller.teacher.payout.get());

    spec.port.failNext();
    const failed = await caller.teacher.payout
      .register({ details: specDetails(), idempotencyKey: specKey() })
      .catch((error: unknown) => error);
    answers.push(failed);
    // The HTTP handler logs an unexpected failure's cause through the request's logger.
    surface.log.error({ err: (failed as { cause?: unknown }).cause ?? failed }, 'Unexpected error');

    const accounts = spec.port.accountNumbers();
    expect(accounts).toHaveLength(5);
    expect(await columnsContaining(accounts)).toEqual([]);
    // The sweep finds a value inside a longer one: the hash it stored, by a part of it.
    const stored = (await rows().profile(userId))?.payoutAccountRefHash ?? '';
    expect(await columnsContaining([stored.slice(8, 40)])).toContain(
      'teacher_profiles.payout_account_ref_hash',
    );
    const logged = surface.logs().join('\n');
    expect(logged).toContain('Unexpected error');
    const answered = answers.map((answer) => JSON.stringify(answer, errorFields)).join('\n');
    for (const account of accounts) {
      expect(logged).not.toContain(account);
      expect(answered).not.toContain(account);
    }
  });
});

describe('the standing a replacement leaves, as the session resolves it (T076, FR-192, FR-193)', () => {
  const publishing = createAppRouter({
    listPackages: teacherProcedure({
      admits: 'publishable',
      input: z.void(),
      output: z.string(),
    }).query(() => 'packages'),
  });
  const callPublishing = createAppCallerFactory(publishing);

  it("a verified teacher who registers a new account is refused by `admits: 'publishable'` until the gateway verifies it", async () => {
    const userId = await createApprovedTeacher(database);
    const hash = payoutRefHash(await register(userId));
    expect(await verify(hash, spec.clock.now())).toBe(true);
    const { accessToken } = await spec.sessions.issue(userId);
    const asTeacher = async () => {
      const session = await spec.sessions.resolveUserSession(accessToken);
      return callPublishing(appContextFor(session));
    };

    expect(await (await asTeacher()).listPackages()).toBe('packages');

    const replacement = payoutRefHash(await register(userId));
    await expect((await asTeacher()).listPackages()).rejects.toMatchObject({
      cause: expect.objectContaining({ code: 'FORBIDDEN' }),
    });

    expect(await verify(replacement, spec.clock.now())).toBe(true);
    expect(await (await asTeacher()).listPackages()).toBe('packages');
  });
});

/** An Error's own fields, which `JSON.stringify` would otherwise drop. */
function errorFields(_key: string, value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  return { ...value, name: value.name, message: value.message, cause: value.cause };
}

/** The UUID just before `id`, so a page after it starts at the row itself: no id lies between. */
function idBefore(id: string): string {
  const hex = (BigInt(`0x${id.replaceAll('-', '')}`) - 1n).toString(16).padStart(32, '0');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
