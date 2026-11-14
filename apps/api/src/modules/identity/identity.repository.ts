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

type AccountsClient = Pick<Database, 'user' | 'authIdentity' | 'teacherProfile'>;
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

  /** Of `documentIds`, those a teacher profile names as its identity document (T093). */
  async identityDocumentsAmong(documentIds: readonly string[]): Promise<ReadonlySet<string>> {
    const rows = await this.#database.teacherProfile.findMany({
      where: { identityDocumentId: { in: [...documentIds] } },
      select: { identityDocumentId: true },
    });
    return new Set(rows.flatMap(({ identityDocumentId }) => identityDocumentId ?? []));
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

// T082 (FR-141, ADR 0015 D3; B16 check, decision 1): an account's deletion. What the proof reads of
// the live caller; what the one transaction reads before it erases and the writes it makes, each
// on that transaction and each conditional on the row it moves, so of two deletions racing on one
// person exactly one erases (the second's update finds the row already deleted and answers false);
// and a deleted person's photo key, read and cleared past the soft-delete filter after the commit,
// cleared only where the row still holds the key whose file was removed.

type ErasureWriter = Pick<
  Transaction,
  'user' | 'authIdentity' | 'devicePushToken' | 'teacherProfile'
>;

/** What re-authentication reads of the live caller: the password hash and the provider identities. */
export interface DeletionProof {
  readonly passwordHash: string | null;
  readonly identities: readonly {
    readonly provider: 'google' | 'apple';
    readonly subject: string;
  }[];
}

/** The live caller's proof material, or null when the person is not there or already deleted. */
export async function readDeletionProof(
  database: Pick<Database, 'user'>,
  userId: string,
): Promise<DeletionProof | null> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
      authIdentities: { select: { provider: true, providerSubject: true } },
    },
  });
  if (user === null) return null;
  return {
    passwordHash: user.passwordHash,
    identities: user.authIdentities.map(({ provider, providerSubject }) => ({
      provider,
      subject: providerSubject,
    })),
  };
}

/** What the deletion keeps for the work after its commit, read before it erases. */
export interface ErasureSnapshot {
  readonly email: string | null;
  /** Apple's grants, still encrypted to their identity rows, for the revoke after the commit. */
  readonly grants: readonly {
    readonly identityId: string;
    readonly refreshTokenEncrypted: Uint8Array;
  }[];
}

/** The live person's address and Apple grants, on the deletion's transaction; null if not live. */
export async function readErasureSnapshot(
  tx: Pick<Transaction, 'user'>,
  userId: string,
): Promise<ErasureSnapshot | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      authIdentities: {
        where: { provider: 'apple', providerRefreshTokenEncrypted: { not: null } },
        select: { id: true, providerRefreshTokenEncrypted: true },
      },
    },
  });
  if (user === null) return null;
  return {
    email: user.email,
    grants: user.authIdentities.flatMap(({ id, providerRefreshTokenEncrypted }) =>
      providerRefreshTokenEncrypted === null
        ? []
        : [{ identityId: id, refreshTokenEncrypted: providerRefreshTokenEncrypted }],
    ),
  };
}

/** T097 (FR-155): what a banned person's deletion keeps of their sign-in identifiers. */
export interface BannedSignIn {
  readonly email: string | null;
  readonly identities: readonly {
    readonly provider: 'google' | 'apple';
    readonly subject: string;
  }[];
}

/**
 * The live person's address and provider identities when the account is banned, on the deletion's
 * transaction, read before they are erased; null for any other standing or a person not live.
 */
export async function readBannedSignIn(
  tx: Pick<Transaction, 'user'>,
  userId: string,
): Promise<BannedSignIn | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      accountStatus: true,
      email: true,
      authIdentities: { select: { provider: true, providerSubject: true } },
    },
  });
  if (user?.accountStatus !== 'banned') return null;
  return {
    email: user.email,
    identities: user.authIdentities.map(({ provider, providerSubject }) => ({
      provider,
      subject: providerSubject,
    })),
  };
}

/**
 * The one transaction's writes (ADR 0015 D3): the row soft-deleted with its personal fields erased,
 * the provider identities deleted outright, the push tokens removed, a teacher's bio and
 * qualification summary erased. False, and nothing written, when the row is already deleted. The
 * photo key stays until its file is gone (`clearDeletedPhotoKey`); the role row, the terms and every
 * history row stay.
 *
 * T076 of specs/004-sessions (FR-508; SRS FR-AUTH-14 as amended, DEC-67; the note under T076, N1):
 * one profile write per branch. A teacher never approved (`approved_at` NULL) loses the payout
 * columns; a teacher ever approved keeps them, the profile marked `kept_at`. `approved_at` is never
 * cleared (its one write, `application.repository.ts`), so «ever approved» is `approved_at IS NOT
 * NULL`, whatever the standing since.
 */
export async function eraseAccount(tx: ErasureWriter, userId: string, at: Date): Promise<boolean> {
  const { count } = await tx.user.updateMany({
    where: { id: userId, deletedAt: null },
    data: {
      deletedAt: at,
      displayName: null,
      email: null,
      phone: null,
      passwordHash: null,
      dateOfBirth: null,
      certificateName: null,
    },
  });
  if (count !== 1) return false;
  await tx.authIdentity.deleteMany({ where: { userId } });
  await tx.devicePushToken.deleteMany({ where: { userId } });
  const erased = { bio: '', qualificationSummary: '', photoKey: null };
  await tx.teacherProfile.updateMany({
    where: { userId, approvedAt: null },
    data: {
      ...erased,
      payoutAccountRefEncrypted: null,
      payoutAccountRefHash: null,
      payoutConfiguredAt: null,
      payoutVerifiedAt: null,
      payoutRejectedReason: null,
    },
  });
  await tx.teacherProfile.updateMany({
    where: { userId, approvedAt: { not: null } },
    data: { ...erased, keptAt: at },
  });
  return true;
}

/**
 * T076 (FR-508; the note under T076, N1): whether the person's teacher profile was ever approved
 * (`approved_at` set), on the caller's transaction; false for a person with no profile. The
 * verification module reads it on the deletion's transaction, after `eraseAccount` (R-121).
 */
export async function everApprovedTeacher(
  tx: Pick<Transaction, 'teacherProfile'>,
  userId: string,
): Promise<boolean> {
  const profile = await tx.teacherProfile.findUnique({
    where: { userId },
    select: { approvedAt: true },
  });
  return profile?.approvedAt != null;
}

/** A deleted person whose photo file is still to be removed. */
export interface HeldPhoto {
  readonly id: string;
  /** The deleted person, the row's own id (T004 of specs/004-sessions: a held owner waits). */
  readonly ownerUserId: string;
  readonly storageKey: string;
}

type DeletedClient = Pick<Database, 'includeDeleted'>;

/** Deleted people's photo keys, past the soft-delete filter (`database.includeDeleted`, R-API-6). */
export class DeletedPhotosRepository {
  readonly #database: DeletedClient;

  constructor(database: DeletedClient) {
    this.#database = database;
  }

  /** The deleted person's photo key while it is held; null otherwise. */
  async heldOf(userId: string): Promise<HeldPhoto | null> {
    const user = await this.#database.includeDeleted.user.findFirst({
      where: { id: userId, deletedAt: { not: null }, photoKey: { not: null } },
      select: { id: true, photoKey: true },
    });
    return user?.photoKey == null
      ? null
      : { id: user.id, ownerUserId: user.id, storageKey: user.photoKey };
  }

  /** A page of every deleted person still holding a photo key, in id order after `after`. */
  async heldPage(after: string | undefined, limit: number): Promise<HeldPhoto[]> {
    const users = await this.#database.includeDeleted.user.findMany({
      where: {
        deletedAt: { not: null },
        photoKey: { not: null },
        ...(after === undefined ? {} : { id: { gt: after } }),
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, photoKey: true },
    });
    return users.flatMap(({ id, photoKey }) =>
      photoKey === null ? [] : [{ id, ownerUserId: id, storageKey: photoKey }],
    );
  }

  /** Clears the key once its file is gone, only where the deleted row still holds it; whether it did. */
  async clear({ id, storageKey }: HeldPhoto): Promise<boolean> {
    const { count } = await this.#database.includeDeleted.user.updateMany({
      where: { id, deletedAt: { not: null }, photoKey: storageKey },
      data: { photoKey: null },
    });
    return count === 1;
  }
}

/**
 * T077 of specs/004-sessions (FR-509; SRS FR-ADMIN-21; the note under T077): a deleted teacher's
 * kept profile (`kept_at` set, only ever by `eraseAccount` for a teacher ever approved), as the
 * verification module's kept-data service and sweep read it on their transaction (R-121). The
 * payout reference's value never leaves this module: only whether one is kept.
 */
export interface KeptProfile {
  readonly profileId: string;
  readonly userId: string;
  readonly keptAt: Date;
  /** The erasure date an administrator set; null for none. */
  readonly eraseAt: Date | null;
  /** When the kept data was erased (now or by the daily job); null until then. */
  readonly erasedAt: Date | null;
  /** Whether the payout reference is still kept. */
  readonly payoutKept: boolean;
}

/** The person's kept profile, on the caller's transaction; null for anyone else (no lock). */
export async function keptProfileOf(
  tx: Pick<Transaction, 'teacherProfile'>,
  userId: string,
): Promise<KeptProfile | null> {
  const row = await tx.teacherProfile.findFirst({
    where: { userId, keptAt: { not: null } },
    select: {
      id: true,
      userId: true,
      keptAt: true,
      keptEraseAt: true,
      keptErasedAt: true,
      payoutAccountRefHash: true,
    },
  });
  if (row?.keptAt == null) return null;
  return {
    profileId: row.id,
    userId: row.userId,
    keptAt: row.keptAt,
    eraseAt: row.keptEraseAt,
    erasedAt: row.keptErasedAt,
    payoutKept: row.payoutAccountRefHash !== null,
  };
}

/**
 * Sets or clears the kept profile's erasure date, only while it is kept and not yet erased; whether
 * it did. The caller holds the profile's lock and has read it again under it.
 */
export async function setKeptEraseDate(
  tx: Pick<Transaction, 'teacherProfile'>,
  profileId: string,
  eraseAt: Date | null,
): Promise<boolean> {
  const { count } = await tx.teacherProfile.updateMany({
    where: { id: profileId, keptAt: { not: null }, keptErasedAt: null },
    data: { keptEraseAt: eraseAt },
  });
  return count === 1;
}

/**
 * The kept profile's erasure (final): the payout columns blanked and `kept_erased_at` set, only
 * while it is kept and not yet erased; whether it did. `kept_at` and `kept_erase_at` stay as the
 * record. Blanking the hash frees nothing new: its unique index binds `kept_at IS NULL` only.
 */
export async function eraseKeptProfile(
  tx: Pick<Transaction, 'teacherProfile'>,
  profileId: string,
  at: Date,
): Promise<boolean> {
  const { count } = await tx.teacherProfile.updateMany({
    where: { id: profileId, keptAt: { not: null }, keptErasedAt: null },
    data: {
      payoutAccountRefEncrypted: null,
      payoutAccountRefHash: null,
      payoutConfiguredAt: null,
      payoutVerifiedAt: null,
      payoutRejectedReason: null,
      keptErasedAt: at,
    },
  });
  return count === 1;
}

/**
 * A page of the kept profiles whose erasure date has passed at `now` and that are not yet erased, in
 * id order after `after` (the daily sweep's candidates, read with no lock).
 */
export async function keptProfilesDue(
  tx: Pick<Transaction, 'teacherProfile'>,
  now: Date,
  after: string | undefined,
  limit: number,
): Promise<{ readonly profileId: string; readonly userId: string }[]> {
  const rows = await tx.teacherProfile.findMany({
    where: {
      keptAt: { not: null },
      keptErasedAt: null,
      keptEraseAt: { lte: now },
      ...afterRow(after),
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true, userId: true },
  });
  return rows.map(({ id, userId }) => ({ profileId: id, userId }));
}
