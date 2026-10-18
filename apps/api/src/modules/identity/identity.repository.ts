// T155: the identity module's `_encrypted` columns, `teacher_profiles.payout_account_ref_encrypted`,
// `device_push_tokens.token_encrypted` and, since Phase 1 (T013),
// `auth_identities.provider_refresh_token_encrypted`, as the `reencrypt-columns` job reaches them
// (R-API-6: through the module that owns the table). Queries only; the cipher decides what is written.
//
// A page is rows holding a value, in id order, after the last row of the page before. A value is
// replaced only where the row still holds the one read, so a value written meanwhile is kept.
import type { EncryptedColumn, EncryptedValue } from '../../platform/crypto/encryption.js';
import type { Database } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'teacherProfile' | 'devicePushToken' | 'authIdentity'>;

const afterRow = (after: string | undefined) => (after === undefined ? {} : { id: { gt: after } });

export class IdentityRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** `teacher_profiles.payout_account_ref_encrypted`, set once payout is configured (ADR 0007 D3). */
  payoutAccountRefs(): EncryptedColumn {
    const profiles = this.#database.teacherProfile;
    return {
      column: 'teacher_profiles.payout_account_ref_encrypted',
      page: async (after, limit) => {
        const rows = await profiles.findMany({
          where: { payoutAccountRefEncrypted: { not: null }, ...afterRow(after) },
          orderBy: { id: 'asc' },
          take: limit,
          select: { id: true, payoutAccountRefEncrypted: true },
        });
        return rows.flatMap(({ id, payoutAccountRefEncrypted: value }): EncryptedValue[] =>
          value === null ? [] : [{ id, value }],
        );
      },
      replace: async (id, stored, next) => {
        const { count } = await profiles.updateMany({
          where: { id, payoutAccountRefEncrypted: { equals: Uint8Array.from(stored) } },
          data: { payoutAccountRefEncrypted: Uint8Array.from(next) },
        });
        return count === 1;
      },
    };
  }

  /**
   * `auth_identities.provider_refresh_token_encrypted`: Apple's refresh token, kept so deletion can
   * revoke it (ADR 0015 D3, R-DB-8); null for Google, so a row without one is not a row to rewrite.
   */
  providerRefreshTokens(): EncryptedColumn {
    const identities = this.#database.authIdentity;
    return {
      column: 'auth_identities.provider_refresh_token_encrypted',
      page: async (after, limit) => {
        const rows = await identities.findMany({
          where: { providerRefreshTokenEncrypted: { not: null }, ...afterRow(after) },
          orderBy: { id: 'asc' },
          take: limit,
          select: { id: true, providerRefreshTokenEncrypted: true },
        });
        return rows.flatMap(({ id, providerRefreshTokenEncrypted: value }): EncryptedValue[] =>
          value === null ? [] : [{ id, value }],
        );
      },
      replace: async (id, stored, next) => {
        const { count } = await identities.updateMany({
          where: { id, providerRefreshTokenEncrypted: { equals: Uint8Array.from(stored) } },
          data: { providerRefreshTokenEncrypted: Uint8Array.from(next) },
        });
        return count === 1;
      },
    };
  }

  /** `device_push_tokens.token_encrypted`. */
  pushTokens(): EncryptedColumn {
    const tokens = this.#database.devicePushToken;
    return {
      column: 'device_push_tokens.token_encrypted',
      page: async (after, limit) => {
        const rows = await tokens.findMany({
          where: afterRow(after),
          orderBy: { id: 'asc' },
          take: limit,
          select: { id: true, tokenEncrypted: true },
        });
        return rows.map(({ id, tokenEncrypted: value }) => ({ id, value }));
      },
      replace: async (id, stored, next) => {
        const { count } = await tokens.updateMany({
          where: { id, tokenEncrypted: { equals: Uint8Array.from(stored) } },
          data: { tokenEncrypted: Uint8Array.from(next) },
        });
        return count === 1;
      },
    };
  }
}
