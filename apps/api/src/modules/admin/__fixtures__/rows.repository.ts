// B12a (T060, T061): the rows the admin services' specs write as a precondition or read as a result,
// and nothing a request ever runs. Only an admin repository may reach the admin tables (R-API-6), so
// the specs reach them through this one, as the services reach them through theirs.
import { randomUUID } from 'node:crypto';

import type { Database } from '../../../platform/db/prisma.repository.js';

export interface SpecAdministrator {
  readonly email: string;
  readonly passwordHash?: string | null;
  /** The secret, already encrypted for the row; the fixture encrypts a known one by default. */
  readonly mfaSecretEncrypted: Uint8Array;
  readonly id?: string;
  readonly enrolled?: boolean;
  readonly isActive?: boolean;
  readonly failedSignInCount?: number;
  readonly lockedUntilAt?: Date | null;
  readonly invitedAt?: Date | null;
  readonly invitedByAdminId?: string | null;
  readonly passwordSetAt?: Date | null;
  readonly now: Date;
}

export class SpecAdminRows {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Writes an administrator straight to `admin_users`; its id. */
  async createAdministrator({
    email,
    passwordHash = null,
    mfaSecretEncrypted,
    id = randomUUID(),
    enrolled = true,
    isActive = true,
    failedSignInCount = 0,
    lockedUntilAt = null,
    invitedAt = null,
    invitedByAdminId = null,
    passwordSetAt,
    now,
  }: SpecAdministrator): Promise<string> {
    await this.#database.adminUser.create({
      data: {
        id,
        email,
        passwordHash,
        mfaSecretEncrypted: Uint8Array.from(mfaSecretEncrypted),
        displayName: 'Spec Administrator',
        isActive,
        disabledAt: isActive ? null : now,
        mfaEnrolledAt: enrolled ? now : null,
        failedSignInCount,
        lockedUntilAt,
        invitedAt,
        invitedByAdminId,
        passwordSetAt: passwordSetAt !== undefined ? passwordSetAt : passwordHash === null ? null : now,
      },
    });
    return id;
  }

  administrator(id: string) {
    return this.#database.adminUser.findUniqueOrThrow({ where: { id } });
  }

  sessions(adminId: string) {
    return this.#database.adminSession.findMany({ where: { adminId }, orderBy: { issuedAt: 'asc' } });
  }

  recoveryCodes(adminId: string) {
    return this.#database.adminRecoveryCode.findMany({
      where: { adminId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Moves a session's clock fields, to put it past a limit without waiting. */
  async setSession(
    sessionId: string,
    data: { lastSeenAt?: Date; expiresAt?: Date; revokedAt?: Date | null },
  ): Promise<void> {
    await this.#database.adminSession.update({ where: { id: sessionId }, data });
  }

  /** Sets an administrator's columns directly, for a state no service call reaches. */
  async setAdministrator(
    id: string,
    data: {
      lockedUntilAt?: Date | null;
      failedSignInCount?: number;
      passwordHash?: string | null;
      passwordSetAt?: Date | null;
      invitedAt?: Date | null;
    },
  ): Promise<void> {
    await this.#database.adminUser.update({ where: { id }, data });
  }
}
