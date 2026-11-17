// T025: the identity module's `device_push_tokens` rows as the `purge-stale-push-tokens` sweep
// reaches them (R-API-6). Queries only; the sweep decides the window. The re-encryption job reaches
// the same table's `token_encrypted` through `identity.repository.ts` (T155).
//
// T005 of specs/005-certification (FR-620; R-405, R-406): the rows `account.pushToken.register` and
// `.remove` write, and the user's devices and language `deliver-notification` reads through identity's
// `PushRecipients` store (`DeviceTokensRepository`). A row is found by its token's hash, never by the
// token, which is stored only encrypted (R-DB-7, R-DB-8).
import type { Database } from '../../platform/db/prisma.repository.js';
import { drawRowId } from '../../platform/db/row-id.js';

type Client = Pick<Database, 'devicePushToken'>;

export class PushTokensRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** Deletes the tokens last seen before `staleBefore`; how many went. */
  async removeNotSeenSince(staleBefore: Date): Promise<number> {
    const { count } = await this.#database.devicePushToken.deleteMany({
      where: { lastSeenAt: { lt: staleBefore } },
    });
    return count;
  }
}

/** ERD §2, `device_push_tokens.platform`. */
export type DevicePlatform = 'ios' | 'android';

/** A device's row as the push reads it: the token still encrypted, bound to its row's id. */
export interface DeviceTokenRow {
  readonly id: string;
  readonly tokenEncrypted: Uint8Array;
  readonly platform: DevicePlatform;
}

/** A registration: the row's columns, its id drawn first so the encrypted token is bound to it. */
export interface DeviceTokenRegistration {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly tokenEncrypted: Uint8Array;
  readonly platform: DevicePlatform;
  readonly lastSeenAt: Date;
}

type DeviceClient = Pick<Database, 'devicePushToken' | 'user' | '$queryRaw'>;

export class DeviceTokensRepository {
  readonly #database: DeviceClient;

  constructor(database: DeviceClient) {
    this.#database = database;
  }

  /** A new row's id, drawn by the database (`row-id.ts`), so the token is encrypted bound to it. */
  drawId(): Promise<string> {
    return drawRowId(this.#database);
  }

  /**
   * One row per token, by its hash's unique: a new token is inserted; a token already held, by this
   * account or another, moves to `userId` with its platform and `last_seen_at`. The stored token is
   * kept, still bound to its own row. Prisma sends it as one `INSERT … ON CONFLICT` (its native
   * upsert: one unique field in `where`, the same value in `create`), so two registrations of one
   * token racing leave one row.
   */
  async upsertByHash(row: DeviceTokenRegistration): Promise<void> {
    await this.#database.devicePushToken.upsert({
      where: { tokenHash: row.tokenHash },
      create: {
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        tokenEncrypted: Uint8Array.from(row.tokenEncrypted),
        platform: row.platform,
        lastSeenAt: row.lastSeenAt,
      },
      update: { userId: row.userId, platform: row.platform, lastSeenAt: row.lastSeenAt },
    });
  }

  /** Deletes the rows of `userId` among `tokenHashes`; another account's row is never matched. */
  async removeOwn(userId: string, tokenHashes: readonly string[]): Promise<number> {
    if (tokenHashes.length === 0) return 0;
    const { count } = await this.#database.devicePushToken.deleteMany({
      where: { userId, tokenHash: { in: [...tokenHashes] } },
    });
    return count;
  }

  /** A live account's `preferred_language` and its devices, by id; null for a deleted or unknown one. */
  async recipientOf(userId: string): Promise<{
    readonly language: 'ar' | 'en';
    readonly devices: readonly DeviceTokenRow[];
  } | null> {
    const [user, devices] = await Promise.all([
      this.#database.user.findUnique({
        where: { id: userId },
        select: { preferredLanguage: true },
      }),
      this.#database.devicePushToken.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        select: { id: true, tokenEncrypted: true, platform: true },
      }),
    ]);
    if (user === null) return null;
    return { language: user.preferredLanguage, devices };
  }
}
