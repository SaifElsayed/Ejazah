// T066 (FR-170 to FR-173, SC-109, research R-107): an administrator's sign-in and second factor, the
// procedures of `adminPublicProcedure` that T067 mounts behind the authentication throttle and budget
// (FR-172: the throttle stands in front of the lockout, never behind it).
//
// SIGN-IN answers one `ADMIN_SIGN_IN_FAILED` for an unknown email, a wrong password, a disabled
// account, an unset password and a locked account, after the same work: a password is verified once
// on every path, against a decoy hash made at start where there is no usable one, so the timings
// agree and no answer carries an attempts count. A right password opens a session whose second
// factor has not passed and says what comes next: `mfa`, or `setup` for an administrator not yet
// enrolled.
//
// THE LOCKOUT is two columns, `failed_sign_in_count` and `locked_until_at`, against the settings
// `admin_lockout_attempts` and `admin_lockout_minutes`. A wrong password and a wrong second-factor
// code count alike; reaching the count locks the account for the duration; a lock that has run out
// is cleared with its count by the next attempt; a completed second factor clears the count.
//
// THE SECOND FACTOR is TOTP (`platform/crypto/totp.ts`), a code accepted once in its step. A
// recovery code (ten Crockford symbols, typed in any case, grouped or not) is spent on use. Setup
// draws a fresh secret on each begin and writes it to the row, so the key shown is valid for that
// sign-in only (FR-171; contracts/admin-surface.md, owner's decision 2026-10-21); confirming enrolls,
// issues `admin_recovery_code_count` codes shown this once, and verifies the session. A wrong code
// answers `CODE_INVALID`; an administrator not enrolled is told `MFA_SETUP_REQUIRED`; a token that is
// no session waiting for its second factor, or an account locked meanwhile, is `ADMIN_SIGN_IN_FAILED`
// and the panel starts again.
//
// THE INVITE LINK sets the password once (`admin-invite.ts`): `INVITE_INVALID` for a link altered,
// expired, already used, or naming an account disabled since; `PASSWORD_WEAK` for a breached
// password (R-105; the length is the contract's), the link still usable.
import { addHours, addMinutes } from '@ijazah/time';
import { z } from 'zod';

import { isBreached } from '../../platform/crypto/breached-passwords/index.js';
import type { ColumnCipher } from '../../platform/crypto/encryption.js';
import {
  hashPassword,
  OtpHasher,
  type Verification,
  verifyPassword,
} from '../../platform/crypto/hashing.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../../platform/crypto/totp.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  generateRecoveryCode,
  generateSecretToken,
  RECOVERY_CODE_LENGTH,
} from '../../platform/guards/identifiers.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { INVITE_TTL_SETTING, InviteTokens } from './admin-invite.js';
import { AdminRecoveryCodesRepository } from './admin-recovery-codes.repository.js';
import type { AdminSessionService } from './admin-session.service.js';
import {
  type AdministratorRow,
  AdminUsersRepository,
  MFA_SECRET_COLUMN,
} from './admin-users.repository.js';

export const LOCKOUT_ATTEMPTS_SETTING = 'admin_lockout_attempts';
export const LOCKOUT_MINUTES_SETTING = 'admin_lockout_minutes';
export const RECOVERY_CODE_COUNT_SETTING = 'admin_recovery_code_count';

const positiveWhole = z.int().positive();
const RECOVERY_CODE = new RegExp(`^[0-9A-HJKMNP-TV-Z]{${RECOVERY_CODE_LENGTH}}$`);

/** How passwords are hashed and checked; replaced by a spec to prove a refusal does the same work. */
export interface PasswordHashing {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<Verification>;
}

export interface AdminAuthDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly encryptionKey: string;
  /** The process's column cipher, reading under the previous key too while a rotation runs (T134). */
  readonly cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  readonly sessions: Pick<AdminSessionService, 'issue' | 'pending' | 'markVerified'>;
  readonly now?: () => Date;
  readonly passwords?: PasswordHashing;
}

export type SignInNext = 'mfa' | 'setup';

const signInFailed = () => new DomainError('ADMIN_SIGN_IN_FAILED');
const codeInvalid = () => new DomainError('CODE_INVALID');

/** An address as it is stored and compared: trimmed, lower case. */
export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `count` fresh recovery codes, and their peppered hashes to store (research R-107). */
export async function drawRecoveryCodes(
  hasher: Pick<OtpHasher, 'hash'>,
  count: number,
): Promise<{ readonly codes: string[]; readonly hashes: readonly string[] }> {
  const codes = Array.from({ length: count }, () => generateRecoveryCode());
  return { codes, hashes: await Promise.all(codes.map((code) => hasher.hash(code))) };
}

export class AdminAuthService {
  readonly #database: Database;
  readonly #transactions;
  readonly #administrators: AdminUsersRepository;
  readonly #recoveryCodes: AdminRecoveryCodesRepository;
  readonly #settings: SettingsReader;
  readonly #sessions: AdminAuthDependencies['sessions'];
  readonly #cipher: Pick<ColumnCipher, 'encrypt' | 'decrypt'>;
  readonly #recoveryHasher: OtpHasher;
  readonly #invites: InviteTokens;
  readonly #passwords: PasswordHashing;
  readonly #now: () => Date;
  /** The hash an unusable account's password is verified against, made once. */
  readonly #decoy: Promise<string>;

  constructor(dependencies: AdminAuthDependencies) {
    this.#database = dependencies.database;
    this.#transactions = transactionsOver(dependencies.database);
    this.#administrators = new AdminUsersRepository(dependencies.database);
    this.#recoveryCodes = new AdminRecoveryCodesRepository(dependencies.database);
    this.#settings = dependencies.settings;
    this.#sessions = dependencies.sessions;
    this.#cipher = dependencies.cipher;
    this.#recoveryHasher = new OtpHasher(dependencies.encryptionKey);
    this.#invites = new InviteTokens(dependencies.encryptionKey);
    this.#passwords = dependencies.passwords ?? { hash: hashPassword, verify: verifyPassword };
    this.#now = dependencies.now ?? (() => new Date());
    this.#decoy = this.#passwords.hash(generateSecretToken());
  }

  /** `auth.signIn`: an unverified session and what comes next, or the one refusal. */
  async signIn(
    email: string,
    password: string,
  ): Promise<{ readonly next: SignInNext; readonly sessionToken: string }> {
    const found = await this.#administrators.findByEmail(normalizeAdminEmail(email));
    const admin = found === null ? null : await this.#unlockedIfDue(found);
    const usable =
      admin !== null &&
      admin.isActive &&
      admin.passwordHash !== null &&
      admin.passwordSetAt !== null &&
      !this.#locked(admin);
    const stored = usable ? (admin.passwordHash ?? '') : await this.#decoy;
    const { valid } = await this.#passwords.verify(password, stored);
    if (!usable) throw signInFailed();
    if (!valid) {
      await this.#countFailure(admin.id);
      throw signInFailed();
    }
    const { token } = await this.#sessions.issue(admin.id);
    return { next: admin.mfaEnrolledAt === null ? 'setup' : 'mfa', sessionToken: token };
  }

  /** `auth.mfa.verify`: the session's second factor by a TOTP code. */
  async verifyMfa(sessionToken: string, code: string): Promise<void> {
    const { sessionId, admin } = await this.#waiting(sessionToken);
    if (admin.mfaEnrolledAt === null) throw new DomainError('MFA_SETUP_REQUIRED');
    const accepted = await verifyTotp(this.#secretOf(admin), code, this.#now(), admin.mfaLastAcceptedStep);
    if (accepted === null) {
      await this.#countFailure(admin.id);
      throw codeInvalid();
    }
    await this.#transactions.run(async (tx) => {
      if (!(await this.#administrators.acceptStep(tx, admin.id, admin.mfaLastAcceptedStep, accepted.step))) {
        throw codeInvalid();
      }
      await this.#sessions.markVerified(sessionId, tx);
      await this.#administrators.signedIn(tx, admin.id, this.#now());
    });
  }

  /** `auth.mfa.recover`: the session's second factor by a recovery code, which is spent. */
  async recover(
    sessionToken: string,
    recoveryCode: string,
  ): Promise<{ readonly remainingCodes: number }> {
    const { sessionId, admin } = await this.#waiting(sessionToken);
    if (admin.mfaEnrolledAt === null) throw new DomainError('MFA_SETUP_REQUIRED');
    const typed = recoveryCode.replace(/[\s-]/g, '').toUpperCase();
    const match = RECOVERY_CODE.test(typed) ? await this.#matchingCode(admin.id, typed) : null;
    if (match === null) {
      await this.#countFailure(admin.id);
      throw codeInvalid();
    }
    return this.#transactions.run(async (tx) => {
      if (!(await this.#recoveryCodes.use(tx, match, this.#now()))) throw codeInvalid();
      await this.#sessions.markVerified(sessionId, tx);
      await this.#administrators.signedIn(tx, admin.id, this.#now());
      return { remainingCodes: await this.#recoveryCodes.countUnused(tx, admin.id) };
    });
  }

  /** `auth.mfa.setup.begin`: a fresh secret for this sign-in, as a URI and a key, shown once. */
  async beginSetup(
    sessionToken: string,
  ): Promise<{ readonly otpauthUri: string; readonly manualKey: string }> {
    const { admin } = await this.#waiting(sessionToken);
    if (admin.mfaEnrolledAt !== null) throw new DomainError('FORBIDDEN');
    const secret = generateTotpSecret();
    const encrypted = this.#cipher.encrypt(secret, MFA_SECRET_COLUMN, admin.id);
    if (!(await this.#administrators.replaceUnenrolledSecret(this.#database, admin.id, encrypted))) {
      throw new DomainError('FORBIDDEN');
    }
    return { otpauthUri: totpUri({ account: admin.email, secret }), manualKey: secret };
  }

  /** `auth.mfa.setup.confirm`: enrolls by a code of the secret begun, with the recovery codes. */
  async confirmSetup(
    sessionToken: string,
    code: string,
  ): Promise<{ readonly recoveryCodes: string[] }> {
    const { sessionId, admin } = await this.#waiting(sessionToken);
    if (admin.mfaEnrolledAt !== null) throw new DomainError('FORBIDDEN');
    const accepted = await verifyTotp(this.#secretOf(admin), code, this.#now(), admin.mfaLastAcceptedStep);
    if (accepted === null) {
      await this.#countFailure(admin.id);
      throw codeInvalid();
    }
    const count = await this.#settings.read(RECOVERY_CODE_COUNT_SETTING, positiveWhole);
    const { codes, hashes } = await drawRecoveryCodes(this.#recoveryHasher, count);
    await this.#transactions.run(async (tx) => {
      if (!(await this.#administrators.enroll(tx, admin.id, accepted.step, this.#now()))) {
        throw new DomainError('FORBIDDEN');
      }
      await this.#recoveryCodes.replace(tx, admin.id, hashes);
      await this.#sessions.markVerified(sessionId, tx);
      await this.#administrators.signedIn(tx, admin.id, this.#now());
    });
    return { recoveryCodes: codes };
  }

  /** `auth.setPassword`: the password from the invite link, once. */
  async setPassword(inviteToken: string, password: string): Promise<void> {
    const admin = await this.#invited(inviteToken);
    if (isBreached(password)) throw new DomainError('PASSWORD_WEAK');
    const passwordHash = await this.#passwords.hash(password);
    if (!(await this.#administrators.setPassword(this.#database, admin.id, passwordHash, this.#now()))) {
      throw new DomainError('INVITE_INVALID');
    }
  }

  /** The administrator a valid, unexpired, unused invite names; INVITE_INVALID otherwise. */
  async #invited(inviteToken: string): Promise<AdministratorRow> {
    const read = this.#invites.read(inviteToken);
    const expiresAt = read === null ? null : new Date(read.expiry);
    if (read === null || expiresAt === null || !(expiresAt > this.#now())) {
      throw new DomainError('INVITE_INVALID');
    }
    const admin = z.uuid().safeParse(read.adminId).success
      ? await this.#administrators.findById(read.adminId)
      : null;
    if (admin === null || !admin.isActive || admin.passwordSetAt !== null || admin.invitedAt === null) {
      throw new DomainError('INVITE_INVALID');
    }
    const hours = await this.#settings.read(INVITE_TTL_SETTING, positiveWhole);
    if (addHours(admin.invitedAt, hours) !== read.expiry) throw new DomainError('INVITE_INVALID');
    return admin;
  }

  /** The session waiting for its second factor and its administrator, unlocked; or the refusal. */
  async #waiting(
    sessionToken: string,
  ): Promise<{ readonly sessionId: string; readonly admin: AdministratorRow }> {
    const { sessionId, adminId } = await this.#sessions.pending(sessionToken);
    const found = await this.#administrators.findById(adminId);
    const admin = found === null ? null : await this.#unlockedIfDue(found);
    if (admin === null || this.#locked(admin)) throw signInFailed();
    return { sessionId, admin };
  }

  /** The id of the unused code `typed` is, or null; every unused code is compared. */
  async #matchingCode(adminId: string, typed: string): Promise<string | null> {
    let match: string | null = null;
    for (const { id, codeHash } of await this.#recoveryCodes.unused(adminId)) {
      const { valid } = await this.#recoveryHasher.verify(typed, codeHash);
      if (valid && match === null) match = id;
    }
    return match;
  }

  #secretOf(admin: AdministratorRow): string {
    return this.#cipher.decrypt(admin.mfaSecretEncrypted, MFA_SECRET_COLUMN, admin.id);
  }

  #locked(admin: AdministratorRow): boolean {
    return admin.lockedUntilAt !== null && admin.lockedUntilAt > this.#now();
  }

  /** The row with a lock that has run out cleared, with its count (R-107). */
  async #unlockedIfDue(admin: AdministratorRow): Promise<AdministratorRow> {
    if (admin.lockedUntilAt === null || admin.lockedUntilAt > this.#now()) return admin;
    await this.#administrators.clearExpiredLock(this.#database, admin.id, this.#now());
    return { ...admin, lockedUntilAt: null, failedSignInCount: 0 };
  }

  async #countFailure(adminId: string): Promise<void> {
    const attempts = await this.#settings.read(LOCKOUT_ATTEMPTS_SETTING, positiveWhole);
    const minutes = await this.#settings.read(LOCKOUT_MINUTES_SETTING, positiveWhole);
    const lockUntil = new Date(addMinutes(this.#now(), minutes));
    await this.#transactions.run((tx) =>
      this.#administrators.countFailure(tx, adminId, attempts, lockUntil),
    );
  }
}
