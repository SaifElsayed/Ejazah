// T155: the identity module's `_encrypted` columns, `teacher_profiles.payout_account_ref_encrypted`,
// `device_push_tokens.token_encrypted` and, since Phase 1 (T013),
// `auth_identities.provider_refresh_token_encrypted`, as the `reencrypt-columns` job reaches them
// (R-API-6: through the module that owns the table). Queries only; the cipher decides what is written.
//
// A page is rows holding a value, in id order, after the last row of the page before. A value is
// replaced only where the row still holds the one read, so a value written meanwhile is kept.
import type { EncryptedColumn, EncryptedValue } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';

type Client = Pick<Database, 'teacherProfile' | 'devicePushToken' | 'authIdentity'>;

/** What the admin module's label renderer reads of a person at read time (T021, FR-181, R-108). */
export interface TargetPerson {
  readonly displayName: string | null;
  readonly role: 'student' | 'teacher' | null;
  /** The row is soft-deleted: the name is gone and the person reads under the role word. */
  readonly deleted: boolean;
}

/**
 * The person an audit target names, on the reading transaction: the display name while the row
 * is live, the role once it is deleted (the ordinary client hides a deleted row, so a role row
 * without its user is a deleted person; FR-141 keeps the role row). Null when no such person
 * ever existed.
 */
export async function readTargetPerson(
  tx: Pick<Transaction, 'user' | 'userRole'>,
  userId: string,
): Promise<TargetPerson | null> {
  const [user, role] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
    tx.userRole.findUnique({ where: { userId }, select: { role: true } }),
  ]);
  if (user !== null)
    return { displayName: user.displayName, role: role?.role ?? null, deleted: false };
  if (role !== null) return { displayName: null, role: role.role, deleted: true };
  return null;
}

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

// T047: the accounts the sign-in, onboarding and email services read and write (FR-120 to FR-129).
// An address is compared without its case: `users.email` is `citext`. A soft-deleted person is
// left out of every read by the client's extension, so an address or an identity of a deleted
// account matches nothing here (its identities are deleted with it, ADR 0015 D3).

type AccountsClient = Pick<Database, 'user' | 'authIdentity'>;
type AccountsWriter = Pick<Transaction, 'user' | 'authIdentity' | 'userRole' | 'termsAcceptance'>;

/** How an account signs in: a provider, or an email and a password (FR-123). */
export type SignInMethod = 'google' | 'apple' | 'email';

/** An account an address belongs to. */
export interface AccountByEmail {
  readonly userId: string;
  /** Null for a provider account. */
  readonly passwordHash: string | null;
  readonly method: SignInMethod;
}

/** What a landing reads of an account (FR-130, FR-137). */
export interface AccountStanding {
  readonly role: 'student' | 'teacher';
  readonly accountStatus: 'active' | 'suspended' | 'verification_required' | 'banned';
  readonly teacher?: {
    readonly verificationStatus:
      'pending' | 'approved' | 'rejected' | 'suspended' | 'banned' | 'revoked';
  };
}

/** What `onboarding.complete` writes (FR-125). */
export interface NewAccount {
  readonly email: string;
  readonly passwordHash: string | null;
  readonly displayName: string;
  readonly gender: 'male' | 'female';
  /** `YYYY-MM-DD`, written as a `date`. */
  readonly dateOfBirth: string;
  readonly timezone: string;
  readonly preferredLanguage: 'ar' | 'en';
  readonly role: 'student' | 'teacher';
  readonly termsVersion: string;
  readonly acceptedAt: Date;
  /** The provider identity, with Apple's grant already encrypted to `id`, its row. */
  readonly identity?: {
    readonly id: string;
    readonly provider: 'google' | 'apple';
    readonly subject: string;
    readonly grantEncrypted: Uint8Array | null;
  };
}

export class AccountsRepository {
  readonly #database: AccountsClient;

  constructor(database: AccountsClient) {
    this.#database = database;
  }

  /** The live person a provider identity belongs to, or null. */
  async findUserIdByIdentity(
    provider: 'google' | 'apple',
    subject: string,
  ): Promise<string | null> {
    const identity = await this.#database.authIdentity.findUnique({
      where: { provider_providerSubject: { provider, providerSubject: subject } },
      select: { userId: true },
    });
    if (identity === null) return null;
    const user = await this.#database.user.findUnique({
      where: { id: identity.userId },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /** The live account `email` belongs to, compared without case, and how it signs in. */
  async findByEmail(email: string): Promise<AccountByEmail | null> {
    const user = await this.#database.user.findFirst({
      where: { email },
      select: { id: true, passwordHash: true, authIdentities: { select: { provider: true } } },
    });
    if (user === null) return null;
    return {
      userId: user.id,
      passwordHash: user.passwordHash,
      method: user.passwordHash === null ? (user.authIdentities[0]?.provider ?? 'email') : 'email',
    };
  }

  /** The role and the standing a landing reads, inside `tx` when one is given. */
  async readStanding(
    userId: string,
    tx?: Pick<Transaction, 'user'>,
  ): Promise<AccountStanding | null> {
    const user = await (tx ?? this.#database).user.findUnique({
      where: { id: userId },
      select: {
        accountStatus: true,
        roles: { select: { role: true } },
        teacherProfile: { select: { verificationStatus: true } },
      },
    });
    const role = user?.roles[0]?.role;
    if (user === null || role === undefined) return null;
    return {
      role,
      accountStatus: user.accountStatus,
      ...(user.teacherProfile === null ? {} : { teacher: user.teacherProfile }),
    };
  }

  /** Writes the account, its identity, its one role and its terms acceptance; its id. */
  async create(tx: AccountsWriter, account: NewAccount): Promise<string> {
    const { id: userId } = await tx.user.create({
      data: {
        email: account.email,
        passwordHash: account.passwordHash,
        displayName: account.displayName,
        gender: account.gender,
        // A date-only ISO string is read as midnight UTC, the calendar date itself (R-TIME-6).
        dateOfBirth: new Date(account.dateOfBirth),
        timezone: account.timezone,
        preferredLanguage: account.preferredLanguage,
        accountStatus: 'active',
      },
      select: { id: true },
    });
    if (account.identity !== undefined) {
      await tx.authIdentity.create({
        data: {
          id: account.identity.id,
          userId,
          provider: account.identity.provider,
          providerSubject: account.identity.subject,
          providerRefreshTokenEncrypted:
            account.identity.grantEncrypted === null
              ? null
              : Uint8Array.from(account.identity.grantEncrypted),
        },
        select: { id: true },
      });
    }
    await tx.userRole.create({
      data: { userId, role: account.role, status: 'active' },
      select: { id: true },
    });
    await tx.termsAcceptance.create({
      data: { userId, termsVersion: account.termsVersion, acceptedAt: account.acceptedAt },
      select: { id: true },
    });
    return userId;
  }

  /** Sets the account's password hash. */
  async setPasswordHash(
    tx: Pick<Transaction, 'user'>,
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await tx.user.update({ where: { id: userId }, data: { passwordHash }, select: { id: true } });
  }
}
