// #145 Saif r2, nit 4 (the follow-up under T005 of specs/005-certification; B46's integration): the
// production wiring of the `token_moved` line. `createIdentityServices` hands the push-token service
// the process's logger only where it answers `info` (`infoLogOf`, `index.ts:221`), so a spec that
// builds `PushTokenService` itself cannot see that wiring dropped (mutant M1c). This one builds the
// services as `main.ts` does and moves a token between two accounts over the real table.
//
// The payout half of the same gap (`index.ts:215`, 004:T077) is held by
// `tests/db-integrity/kept-data.spec.ts`, which builds `createIdentityServices` the same way and
// asserts the registration's `payout_kept_match` line.
//
// Every token is made up (R-SEC-2).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { createColumnCipher } from '../../platform/crypto/encryption.js';
import { hashLookupToken } from '../../platform/crypto/hashing.js';
import { closeDatabase } from '../../platform/db/prisma.repository.js';
import { MemorySingleUseMarks } from '../../platform/redis/single-use-marks.fixtures.js';
import {
  createAccount,
  openSpecDatabase,
  SEEDED_SETTINGS,
  settingsOf,
  SPEC_ENCRYPTION_KEY,
  SpecEmail,
  SpecSignInPort,
  SpecStorage,
} from './__fixtures__/identity.js';
import {
  AccountConsequences,
  createIdentityServices,
  type IdentityServiceDependencies,
} from './index.js';

const database = openSpecDatabase();
afterAll(() => closeDatabase(database));

const unreachable = (): Promise<never> => Promise.reject(new Error('spec: not reached'));

/** The services as the composition builds them, over a logger that records its info lines. */
function composed(lines: Record<string, unknown>[]): ReturnType<typeof createIdentityServices> {
  return createIdentityServices({
    database,
    settings: settingsOf(SEEDED_SETTINGS),
    encryptionKey: SPEC_ENCRYPTION_KEY,
    cipher: createColumnCipher({ ENCRYPTION_KEY: SPEC_ENCRYPTION_KEY }),
    marks: new MemorySingleUseMarks(() => new Date()),
    signIn: new SpecSignInPort(),
    email: new SpecEmail(),
    storage: Object.assign(new SpecStorage(), {
      remove: unreachable,
    }) as unknown as IdentityServiceDependencies['storage'],
    log: {
      warn: () => undefined,
      info: (entry: object) => void lines.push(entry as Record<string, unknown>),
    },
    payment: { registerPayoutRecipient: unreachable },
    idempotency: {
      run: unreachable,
      runOn: unreachable,
    } as unknown as IdentityServiceDependencies['idempotency'],
    consequences: new AccountConsequences(),
    ongoingEnrollments: {
      anyOf: unreachable,
    } as unknown as IdentityServiceDependencies['ongoingEnrollments'],
    // 005:T031 (rule d): the two ports a teacher's deletion asks, never reached here.
    openIjazahRequests: {
      count: unreachable,
    } as unknown as IdentityServiceDependencies['openIjazahRequests'],
    openCases: { count: unreachable } as unknown as IdentityServiceDependencies['openCases'],
  });
}

describe('createIdentityServices: the push-token service it builds (#145 r2 nit 4)', () => {
  it('logs a token moved from another account with both ids, the row and token_moved, never the token', async () => {
    const lines: Record<string, unknown>[] = [];
    const { pushTokens } = composed(lines);
    const before = await createAccount(database);
    const caller = await createAccount(database);
    const token = `ExponentPushToken[spec-${randomUUID()}]`;

    await pushTokens.register(before.userId, { token, platform: 'android' });
    expect(lines).toEqual([]);
    await pushTokens.register(caller.userId, { token, platform: 'android' });

    expect(lines).toEqual([
      {
        userId: caller.userId,
        previousUserId: before.userId,
        deviceId: expect.any(String),
        reason: 'token_moved',
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(token);
    expect(JSON.stringify(lines)).not.toContain(hashLookupToken(token));
  });
});
