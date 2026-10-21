// T066 (FR-173, FR-174, research R-107, R-110): the admins page's actions. Each runs in the
// administrator caller kind's transaction (`tx`), which writes the audit record the router describes
// (T067), so nothing here is kept unless the action is.
//
// - `add` writes the administrator with no password and a secret bound to the row, records who
//   invited and when, and queues `deliver-admin-invite` with the id alone: a handler never awaits a
//   provider (kernel.md), and the job mints the link at send time. An address another administrator
//   holds is `CONFLICT` on the email field.
// - `disable` ends the sign-in and every open session; the row, and the name on every audited action,
//   stay. `resetMfa` clears the enrolment, rotates the secret, deletes the recovery codes and ends
//   every session, so the next sign-in repeats the setup (FR-173). Neither may be turned on oneself
//   (`FORBIDDEN`): a last administrator could lock everyone out.
// - `regenerateRecoveryCodes` replaces the caller's own set and shows the new codes once.
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { ColumnCipher } from '../../platform/crypto/encryption.js';
import { OtpHasher } from '../../platform/crypto/hashing.js';
import { generateTotpSecret } from '../../platform/crypto/totp.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  drawRecoveryCodes,
  normalizeAdminEmail,
  RECOVERY_CODE_COUNT_SETTING,
} from './admin-auth.service.js';
import { AdminRecoveryCodesRepository } from './admin-recovery-codes.repository.js';
import type { AdminSessionService } from './admin-session.service.js';
import { AdminUsersRepository, MFA_SECRET_COLUMN } from './admin-users.repository.js';

const positiveWhole = z.int().positive();

/** Where `add` queues the invite: `deliver-admin-invite` with the id alone (R-110). */
export interface AdminInviteQueue {
  queue(adminId: string): Promise<void>;
}

export interface AdminsDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly encryptionKey: string;
  readonly sessions: Pick<AdminSessionService, 'revokeAll'>;
  readonly inviteQueue: AdminInviteQueue;
  readonly now?: () => Date;
}

type Tx = Transaction;

export class AdminsService {
  readonly #administrators: AdminUsersRepository;
  readonly #recoveryCodes: AdminRecoveryCodesRepository;
  readonly #settings: SettingsReader;
  readonly #sessions: AdminsDependencies['sessions'];
  readonly #inviteQueue: AdminInviteQueue;
  readonly #cipher: ColumnCipher;
  readonly #recoveryHasher: OtpHasher;
  readonly #now: () => Date;

  constructor(dependencies: AdminsDependencies) {
    this.#administrators = new AdminUsersRepository(dependencies.database);
    this.#recoveryCodes = new AdminRecoveryCodesRepository(dependencies.database);
    this.#settings = dependencies.settings;
    this.#sessions = dependencies.sessions;
    this.#inviteQueue = dependencies.inviteQueue;
    this.#cipher = new ColumnCipher(dependencies.encryptionKey);
    this.#recoveryHasher = new OtpHasher(dependencies.encryptionKey);
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** `admins.add`: the new administrator's id; the invite is queued. */
  async add(
    tx: Tx,
    actorId: string,
    { displayName, email }: { readonly displayName: string; readonly email: string },
  ): Promise<{ readonly adminId: string }> {
    const adminId = randomUUID();
    const inserted = await this.#administrators.insertInvited(tx, {
      id: adminId,
      email: normalizeAdminEmail(email),
      displayName,
      mfaSecretEncrypted: this.#freshSecret(adminId),
      invitedByAdminId: actorId,
      invitedAt: this.#now(),
    });
    if (!inserted) {
      throw new DomainError('CONFLICT', undefined, { details: [{ path: 'email', code: 'taken' }] });
    }
    await this.#inviteQueue.queue(adminId);
    return { adminId };
  }

  /** `admins.disable`: no more sign-in, every session ended. */
  async disable(tx: Tx, actorId: string, adminId: string): Promise<void> {
    if (actorId === adminId) throw new DomainError('FORBIDDEN');
    await this.#existing(tx, adminId);
    if (!(await this.#administrators.disable(tx, adminId, this.#now()))) {
      throw new DomainError('CONFLICT');
    }
    await this.#sessions.revokeAll(adminId, tx);
  }

  /** `admins.resetMfa` (FR-173): enrolment cleared, secret rotated, codes deleted, sessions ended. */
  async resetMfa(tx: Tx, actorId: string, adminId: string): Promise<void> {
    if (actorId === adminId) throw new DomainError('FORBIDDEN');
    await this.#existing(tx, adminId);
    await this.#administrators.resetSecondFactor(tx, adminId, this.#freshSecret(adminId));
    await this.#recoveryCodes.removeAll(tx, adminId);
    await this.#sessions.revokeAll(adminId, tx);
  }

  /** `admins.regenerateRecoveryCodes`: the caller's new set, shown once. */
  async regenerateRecoveryCodes(
    tx: Tx,
    adminId: string,
  ): Promise<{ readonly recoveryCodes: readonly string[] }> {
    const admin = await this.#existing(tx, adminId);
    if (admin.mfaEnrolledAt === null) throw new DomainError('MFA_SETUP_REQUIRED');
    const count = await this.#settings.read(RECOVERY_CODE_COUNT_SETTING, positiveWhole);
    const { codes, hashes } = await drawRecoveryCodes(this.#recoveryHasher, count);
    await this.#recoveryCodes.replace(tx, adminId, hashes);
    return { recoveryCodes: codes };
  }

  async #existing(tx: Tx, adminId: string) {
    const admin = await this.#administrators.findById(adminId, tx);
    if (admin === null) throw new DomainError('NOT_FOUND');
    return admin;
  }

  /** A new TOTP secret, encrypted for the row it belongs to. */
  #freshSecret(adminId: string): Uint8Array {
    return this.#cipher.encrypt(generateTotpSecret(), MFA_SECRET_COLUMN, adminId);
  }
}
