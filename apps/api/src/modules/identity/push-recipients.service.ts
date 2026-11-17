// T005 of specs/005-certification (FR-620, FR-621; R-405, R-406): identity's `PushRecipients`, the
// store `deliver-notification` declares (`apps/api/src/jobs/deliver-notification.ts`; the review
// session's answer Q-E1-1 (b), 2026-11-17) and `worker.ts` hands in. Identity decrypts the tokens of
// its own table, so the job never holds the cipher or reads `device_push_tokens` (R-API-6).
//
// - `targetsOf`: the user's tokens decrypted, each with its platform, and the user's
//   `preferred_language`; null for a deleted or unknown user, whose rows the soft-delete filter hides.
// - `removeStale`: ⚠️ automatic and final. Deletes the user's rows of the tokens the provider no
//   longer accepts, matched by `token_hash`; the device registers again when the application next
//   starts. Another account's row is never matched.
//
// The types are the job's shapes, written here, since identity names neither the push port nor a job
// (`api/no-push-outside-job`, R-API-15); `worker.ts`'s binding checks they match. A token is never
// logged (R-SEC-2).
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import { hashLookupToken } from '../../platform/crypto/hashing.js';
import type { DeviceTokensRepository } from './push-tokens.repository.js';
import { PUSH_TOKEN_COLUMN } from './push-tokens.service.js';

/** A device the provider can reach: the token decrypted, and its platform. */
export interface PushRecipientTarget {
  readonly token: string;
  readonly platform: 'ios' | 'android';
}

/** A user's devices and language. */
export interface PushRecipientDevices {
  readonly language: 'ar' | 'en';
  readonly targets: readonly PushRecipientTarget[];
}

export interface PushRecipientsDependencies {
  readonly devices: Pick<DeviceTokensRepository, 'recipientOf' | 'removeOwn'>;
  readonly cipher: Pick<ColumnCipher, 'decrypt'>;
}

export class PushRecipientsService {
  readonly #devices: PushRecipientsDependencies['devices'];
  readonly #cipher: PushRecipientsDependencies['cipher'];

  constructor({ devices, cipher }: PushRecipientsDependencies) {
    this.#devices = devices;
    this.#cipher = cipher;
  }

  async targetsOf(userId: string): Promise<PushRecipientDevices | null> {
    const recipient = await this.#devices.recipientOf(userId);
    if (recipient === null) return null;
    return {
      language: recipient.language,
      targets: recipient.devices.map(({ id, tokenEncrypted, platform }) => ({
        token: this.#cipher.decrypt(tokenEncrypted, PUSH_TOKEN_COLUMN, id),
        platform,
      })),
    };
  }

  async removeStale(userId: string, tokens: readonly string[]): Promise<void> {
    await this.#devices.removeOwn(
      userId,
      tokens.map((token) => hashLookupToken(token)),
    );
  }
}
