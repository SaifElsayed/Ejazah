// T005 of specs/005-certification (FR-620; R-405; app-surface.md, `account.pushToken.register` and
// `.remove`): the phone's push token, registered when the application starts and removed at
// sign-out, on the caller's own account.
//
// - Register: one row per token, found by the hash of its token (`token_hash`, unique); the token is
//   stored encrypted, bound to its row's id (R-DB-8), so the row's id is drawn first. A token already
//   held, by this account or another, moves to the caller with its platform and `last_seen_at`: a
//   phone signed into another account pushes to that account alone. The move is logged with both
//   accounts' ids, the row's id (`deviceId`) and `token_moved` (#145 r1 Minor 1; FR-626): the
//   other account stops receiving pushes on that device.
// - Remove: the caller's own row of the token; another account's row is never matched, and the
//   answer is the same whether or not a row went, so nothing tells whether a token is held.
//
// A token is never logged, echoed or stored in the clear (R-SEC-2, R-DB-7).
import type { PushTokenRegisterInput, PushTokenRemoveInput } from '@ijazah/contracts';

import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import { hashLookupToken } from '../../platform/crypto/hashing.js';
import type { Logger } from '../../platform/logging/logger.js';
import type { DeviceTokensRepository } from './push-tokens.repository.js';

/** The column the token is encrypted for, bound to its row's id (`encryption.ts`). */
export const PUSH_TOKEN_COLUMN = 'device_push_tokens.token_encrypted';

export interface PushTokenDependencies {
  readonly devices: Pick<DeviceTokensRepository, 'drawId' | 'upsertByHash' | 'removeOwn'>;
  readonly cipher: Pick<ColumnCipher, 'encrypt'>;
  readonly now?: () => Date;
  /** The move's info line (FR-626); none where the log handed in has no `info`. */
  readonly log?: Pick<Logger, 'info'>;
}

export class PushTokenService {
  readonly #devices: PushTokenDependencies['devices'];
  readonly #cipher: PushTokenDependencies['cipher'];
  readonly #now: () => Date;
  readonly #log: Pick<Logger, 'info'>;

  constructor({
    devices,
    cipher,
    now = () => new Date(),
    log = { info: () => undefined },
  }: PushTokenDependencies) {
    this.#devices = devices;
    this.#cipher = cipher;
    this.#now = now;
    this.#log = log;
  }

  async register(userId: string, { token, platform }: PushTokenRegisterInput): Promise<void> {
    const id = await this.#devices.drawId();
    const stored = await this.#devices.upsertByHash({
      id,
      userId,
      tokenHash: hashLookupToken(token),
      tokenEncrypted: this.#cipher.encrypt(token, PUSH_TOKEN_COLUMN, id),
      platform,
      lastSeenAt: this.#now(),
    });
    if (stored.previousUserId !== null && stored.previousUserId !== userId) {
      this.#log.info(
        {
          userId,
          previousUserId: stored.previousUserId,
          deviceId: stored.id,
          reason: 'token_moved',
        },
        'A push token another account held moved to the caller',
      );
    }
  }

  async remove(userId: string, { token }: PushTokenRemoveInput): Promise<void> {
    await this.#devices.removeOwn(userId, [hashLookupToken(token)]);
  }
}
