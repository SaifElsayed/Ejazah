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
// - `me` is the sidebar's administrator, and `list` the admins page's tab (T067): by name, a page
//   of `admin_list_page_size`, the search over the name and the address as typed.
import { randomUUID } from 'node:crypto';

import { addMinutes } from '@ijazah/time';
import { z } from 'zod';

import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import { OtpHasher } from '../../platform/crypto/hashing.js';
import { generateTotpSecret, verifyTotp } from '../../platform/crypto/totp.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  drawRecoveryCodes,
  LOCKOUT_ATTEMPTS_SETTING,
  LOCKOUT_MINUTES_SETTING,
  normalizeAdminEmail,
  RECOVERY_CODE_COUNT_SETTING,
} from './admin-auth.service.js';
import { AdminRecoveryCodesRepository } from './admin-recovery-codes.repository.js';
import type { AdminSessionService } from './admin-session.service.js';
import {
  type AdministratorListRow,
  AdminUsersRepository,
  MFA_SECRET_COLUMN,
} from './admin-users.repository.js';
import { LIST_PAGE_SIZE_SETTING } from './audit-query.service.js';

const positiveWhole = z.int().positive();

/** Where `add` queues the invite: `deliver-admin-invite` with the id alone (R-110). */
export interface AdminInviteQueue {
  queue(adminId: string): Promise<void>;
}

export interface AdminsDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly encryptionKey: string;
  /** The process's column cipher, reading under the previous key too while a rotation runs (T134). */
  readonly cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
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
  readonly #cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  readonly #recoveryHasher: OtpHasher;
  readonly #now: () => Date;
  readonly #database: Database;

  constructor(dependencies: AdminsDependencies) {
    this.#database = dependencies.database;
    this.#administrators = new AdminUsersRepository(dependencies.database);
    this.#recoveryCodes = new AdminRecoveryCodesRepository(dependencies.database);
    this.#settings = dependencies.settings;
    this.#sessions = dependencies.sessions;
    this.#inviteQueue = dependencies.inviteQueue;
    this.#cipher = dependencies.cipher;
    this.#recoveryHasher = new OtpHasher(dependencies.encryptionKey);
    this.#now = dependencies.now ?? (() => new Date());
  }

  /**
   * `admins.add`: the new administrator's id; the invite is queued. `scripts/dev/admin-invite.ts`
   * (T097) writes the same row with SQL, so a change made here is made there too.
   */
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

  /**
   * `admins.recoveryCodes.regenerate`: the caller's new set, shown once, for a current code of their
   * second factor (T096): a session alone cannot mint codes that outlive it. The code is checked as
   * the sign-in checks it, a step never accepted twice; a wrong one counts toward the lockout on its
   * own write (the procedure's transaction rolls back with the refusal), and a locked account is
   * refused whatever it sends, so a stolen session cannot keep guessing.
   */
  async regenerateRecoveryCodes(
    tx: Tx,
    adminId: string,
    code: string,
  ): Promise<{ readonly recoveryCodes: string[] }> {
    const admin = await this.#existing(tx, adminId);
    if (admin.mfaEnrolledAt === null) throw new DomainError('MFA_SETUP_REQUIRED');
    if (admin.lockedUntilAt !== null && admin.lockedUntilAt > this.#now()) {
      throw new DomainError('CODE_INVALID');
    }
    // A lock that has run out is cleared with its count, as the sign-in clears it (R-107), so the
    // next failures can lock again (B14d-2 review, finding 1).
    if (admin.lockedUntilAt !== null) {
      await this.#administrators.clearExpiredLock(this.#database, admin.id, this.#now());
    }
    const secret = this.#cipher.decrypt(admin.mfaSecretEncrypted, MFA_SECRET_COLUMN, admin.id);
    const accepted = await verifyTotp(secret, code, this.#now(), admin.mfaLastAcceptedStep);
    if (accepted === null) {
      const attempts = await this.#settings.read(LOCKOUT_ATTEMPTS_SETTING, positiveWhole);
      const minutes = await this.#settings.read(LOCKOUT_MINUTES_SETTING, positiveWhole);
      await this.#administrators.countFailure(
        this.#database,
        admin.id,
        attempts,
        new Date(addMinutes(this.#now(), minutes)),
      );
      throw new DomainError('CODE_INVALID');
    }
    if (
      !(await this.#administrators.acceptStep(
        tx,
        admin.id,
        admin.mfaLastAcceptedStep,
        accepted.step,
      ))
    ) {
      throw new DomainError('CODE_INVALID');
    }
    // A right code forgets the failed ones, as a passed sign-in does (B14d-2 review, m1).
    await this.#administrators.clearFailures(tx, admin.id);
    const count = await this.#settings.read(RECOVERY_CODE_COUNT_SETTING, positiveWhole);
    const { codes, hashes } = await drawRecoveryCodes(this.#recoveryHasher, count);
    await this.#recoveryCodes.replace(tx, adminId, hashes);
    return { recoveryCodes: codes };
  }

  /** `auth.me`: the sidebar's administrator. */
  async me(
    tx: Tx,
    adminId: string,
  ): Promise<{ readonly adminId: string; readonly displayName: string; readonly email: string }> {
    const admin = await this.#existing(tx, adminId);
    return { adminId: admin.id, displayName: admin.displayName, email: admin.email };
  }

  /** `admins.list`: one page of the tab, by name, and how many there are. */
  async list(
    tx: Tx,
    readerId: string,
    query: {
      readonly tab: 'active' | 'disabled';
      readonly search?: string | undefined;
      readonly page: number;
    },
  ): Promise<{
    readonly rows: AdminsListRow[];
    readonly total: number;
    readonly pageSize: number;
  }> {
    const size = await this.#settings.read(LIST_PAGE_SIZE_SETTING, positiveWhole);
    const filter = { active: query.tab === 'active', search: query.search };
    const [rows, total] = await Promise.all([
      this.#administrators.page(tx, filter, (query.page - 1) * size, size),
      this.#administrators.count(tx, filter),
    ]);
    return { rows: rows.map((row) => listRowOf(row, readerId)), total, pageSize: size };
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

/** One row of the admins page as `admins.list` answers it. */
export interface AdminsListRow {
  readonly adminId: string;
  readonly displayName: string;
  readonly email: string;
  readonly self: boolean;
  readonly mfaEnrolled: boolean;
  readonly lastSignInAt?: string;
  readonly invitedAt?: string;
  readonly invitedByName?: string;
  readonly recoveryCodesLeft: number;
  readonly disabledAt?: string;
}

function listRowOf(row: AdministratorListRow, readerId: string): AdminsListRow {
  return {
    adminId: row.id,
    displayName: row.displayName,
    email: row.email,
    self: row.id === readerId,
    mfaEnrolled: row.mfaEnrolledAt !== null,
    ...(row.lastSignInAt === null ? {} : { lastSignInAt: row.lastSignInAt.toISOString() }),
    ...(row.invitedAt === null ? {} : { invitedAt: row.invitedAt.toISOString() }),
    ...(row.invitedBy === null ? {} : { invitedByName: row.invitedBy.displayName }),
    recoveryCodesLeft: row._count.recoveryCodes,
    ...(row.disabledAt === null ? {} : { disabledAt: row.disabledAt.toISOString() }),
  };
}
