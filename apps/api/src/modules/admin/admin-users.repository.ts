// T155: the admin module's `_encrypted` column, `admin_users.mfa_secret_encrypted`, as the
// `reencrypt-columns` job reaches it (R-API-6: through the module that owns the table). Queries
// only; the cipher decides what is written. T066 adds what sign-in, the second factor and the admins
// page read and write (research R-107): each change of state is conditional on the state it moves
// from, so a request that lost a race changes nothing and is told so by a false or a zero.
//
// A page is rows in id order, after the last row of the page before. A value is replaced only where
// the row still holds the one read, so a value written meanwhile is kept. T067 adds the admins
// page's list: one tab, a search over the name and the address as typed, ordered by name.
import type { Prisma } from '@prisma/client';

import type { EncryptedColumn } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { likeLiteral } from '../../platform/db/like-literal.js';

type Client = Pick<Database, 'adminUser'>;
type Writer = Pick<Transaction, 'adminUser'>;

/** The column the MFA secret is encrypted under, bound to the row's id (R-DB-8). */
export const MFA_SECRET_COLUMN = 'admin_users.mfa_secret_encrypted';

/** An administrator's display name at read time, for the audit pages (T021, FR-181); null if none. */
export async function readAdministratorName(
  tx: Pick<Transaction, 'adminUser'>,
  adminId: string,
): Promise<string | null> {
  const row = await tx.adminUser.findUnique({
    where: { id: adminId },
    select: { displayName: true },
  });
  return row?.displayName ?? null;
}

export class AdminUsersRepository {
  readonly #database: Client;

  constructor(database: Client) {
    this.#database = database;
  }

  /** `admin_users.mfa_secret_encrypted`: every administrator's MFA secret (NFR-SEC-6). */
  mfaSecrets(): EncryptedColumn {
    const admins = this.#database.adminUser;
    return {
      column: MFA_SECRET_COLUMN,
      page: async (after, limit) => {
        const rows = await admins.findMany({
          where: after === undefined ? {} : { id: { gt: after } },
          orderBy: { id: 'asc' },
          take: limit,
          select: { id: true, mfaSecretEncrypted: true },
        });
        return rows.map(({ id, mfaSecretEncrypted: value }) => ({ id, value }));
      },
      replace: async (id, stored, next) => {
        const { count } = await admins.updateMany({
          where: { id, mfaSecretEncrypted: { equals: Uint8Array.from(stored) } },
          data: { mfaSecretEncrypted: Uint8Array.from(next) },
        });
        return count === 1;
      },
    };
  }

  /** What sign-in and the second factor read of an administrator, by address or id; null if none. */
  async findByEmail(email: string): Promise<AdministratorRow | null> {
    return this.#find(this.#database, { email });
  }

  async findById(id: string, tx: Writer = this.#database): Promise<AdministratorRow | null> {
    return this.#find(tx, { id });
  }

  /** The columns sign-in, the second factor and the admins page's actions decide by. */
  #find(
    client: Writer,
    where: { readonly id: string } | { readonly email: string },
  ): Promise<AdministratorRow | null> {
    return client.adminUser.findUnique({
      where,
      select: {
        id: true,
        email: true,
        displayName: true,
        passwordHash: true,
        mfaSecretEncrypted: true,
        mfaEnrolledAt: true,
        mfaLastAcceptedStep: true,
        isActive: true,
        failedSignInCount: true,
        lockedUntilAt: true,
        invitedAt: true,
        passwordSetAt: true,
      },
    });
  }

  /** One page of the admins page's tab, by name, with who invited and the unused codes left. */
  page(
    tx: Writer,
    filter: AdministratorFilter,
    skip: number,
    take: number,
  ): Promise<AdministratorListRow[]> {
    return tx.adminUser.findMany({
      where: listWhere(filter),
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        displayName: true,
        email: true,
        mfaEnrolledAt: true,
        lastSignInAt: true,
        invitedAt: true,
        disabledAt: true,
        invitedBy: { select: { displayName: true } },
        _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
      },
    });
  }

  /** How many administrators the tab and the search admit. */
  count(tx: Writer, filter: AdministratorFilter): Promise<number> {
    return tx.adminUser.count({ where: listWhere(filter) });
  }

  /** Clears a lock that has run out, with its count (research R-107: an expired lock resets). */
  async clearExpiredLock(tx: Writer, id: string, now: Date): Promise<void> {
    await tx.adminUser.updateMany({
      where: { id, lockedUntilAt: { lte: now } },
      data: { failedSignInCount: 0, lockedUntilAt: null },
    });
  }

  /**
   * Counts one failure and, where the count reaches `attempts` with no lock standing, locks until
   * `lockUntil`. The increment is the database's, so failures arriving together are all counted.
   */
  async countFailure(tx: Writer, id: string, attempts: number, lockUntil: Date): Promise<void> {
    await tx.adminUser.updateMany({ where: { id }, data: { failedSignInCount: { increment: 1 } } });
    await tx.adminUser.updateMany({
      where: { id, failedSignInCount: { gte: attempts }, lockedUntilAt: null },
      data: { lockedUntilAt: lockUntil },
    });
  }

  /** A completed sign-in: the count cleared, the instant kept for the admins page. */
  async signedIn(tx: Writer, id: string, now: Date): Promise<void> {
    await tx.adminUser.updateMany({
      where: { id },
      data: { failedSignInCount: 0, lockedUntilAt: null, lastSignInAt: now },
    });
  }

  /** Records the TOTP step accepted, where the one read is still there; false if another took it. */
  async acceptStep(tx: Writer, id: string, read: bigint | null, step: bigint): Promise<boolean> {
    const { count } = await tx.adminUser.updateMany({
      where: { id, mfaLastAcceptedStep: read },
      data: { mfaLastAcceptedStep: step },
    });
    return count === 1;
  }

  /** Replaces the secret of an administrator not yet enrolled; false once enrolled. */
  async replaceUnenrolledSecret(tx: Writer, id: string, secret: Uint8Array): Promise<boolean> {
    const { count } = await tx.adminUser.updateMany({
      where: { id, mfaEnrolledAt: null },
      data: { mfaSecretEncrypted: Uint8Array.from(secret), mfaLastAcceptedStep: null },
    });
    return count === 1;
  }

  /** Enrolls, where not yet enrolled, with the step of the code that confirmed it. */
  async enroll(tx: Writer, id: string, step: bigint, now: Date): Promise<boolean> {
    const { count } = await tx.adminUser.updateMany({
      where: { id, mfaEnrolledAt: null },
      data: { mfaEnrolledAt: now, mfaLastAcceptedStep: step },
    });
    return count === 1;
  }

  /** Clears the enrolment and replaces the secret (FR-173). */
  async resetSecondFactor(tx: Writer, id: string, secret: Uint8Array): Promise<boolean> {
    const { count } = await tx.adminUser.updateMany({
      where: { id },
      data: {
        mfaEnrolledAt: null,
        mfaLastAcceptedStep: null,
        mfaSecretEncrypted: Uint8Array.from(secret),
      },
    });
    return count === 1;
  }

  /** Sets the password from the invite link, once: where none was set and the account is active. */
  async setPassword(tx: Writer, id: string, passwordHash: string, now: Date): Promise<boolean> {
    const { count } = await tx.adminUser.updateMany({
      where: { id, passwordSetAt: null, isActive: true },
      data: { passwordHash, passwordSetAt: now },
    });
    return count === 1;
  }

  /** Writes an invited administrator; false when the address is another's. */
  async insertInvited(
    tx: Writer,
    row: {
      readonly id: string;
      readonly email: string;
      readonly displayName: string;
      readonly mfaSecretEncrypted: Uint8Array;
      readonly invitedByAdminId: string;
      readonly invitedAt: Date;
    },
  ): Promise<boolean> {
    const { count } = await tx.adminUser.createMany({
      data: [
        {
          ...row,
          mfaSecretEncrypted: Uint8Array.from(row.mfaSecretEncrypted),
          isActive: true,
          passwordHash: null,
        },
      ],
      skipDuplicates: true,
    });
    return count === 1;
  }

  /** Disables an active administrator (rule 31 keeps the pair equal); false if none was active. */
  async disable(tx: Writer, id: string, now: Date): Promise<boolean> {
    const { count } = await tx.adminUser.updateMany({
      where: { id, isActive: true },
      data: { isActive: false, disabledAt: now },
    });
    return count === 1;
  }
}

/** The admins page's tab and search (T067). */
export interface AdministratorFilter {
  readonly active: boolean;
  readonly search?: string | undefined;
}

function listWhere({ active, search }: AdministratorFilter): Prisma.AdminUserWhereInput {
  if (search === undefined) return { isActive: active };
  const typed = likeLiteral(search);
  return {
    isActive: active,
    OR: [
      { displayName: { contains: typed, mode: 'insensitive' } },
      { email: { contains: typed, mode: 'insensitive' } },
    ],
  };
}

/** One row of the admins page as stored. */
export interface AdministratorListRow {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly mfaEnrolledAt: Date | null;
  readonly lastSignInAt: Date | null;
  readonly invitedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly invitedBy: { readonly displayName: string } | null;
  readonly _count: { readonly recoveryCodes: number };
}

export interface AdministratorRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string | null;
  readonly mfaSecretEncrypted: Uint8Array;
  readonly mfaEnrolledAt: Date | null;
  readonly mfaLastAcceptedStep: bigint | null;
  readonly isActive: boolean;
  readonly failedSignInCount: number;
  readonly lockedUntilAt: Date | null;
  readonly invitedAt: Date | null;
  readonly passwordSetAt: Date | null;
}
