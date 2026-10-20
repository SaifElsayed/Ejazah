// T047: one-time codes by email (research R-104), shared by the email account (sign-up, reset) and
// by onboarding (an identity without a verified email, FR-122).
//
// SENDING. A six-digit code is drawn by `node:crypto`, hashed with the peppered Argon2id of Phase 0
// and written with its expiry (`otp_code_ttl_minutes`); a new code replaces the unconsumed ones of
// its destination and purpose. The mail carrying it is dispatched after the row's transaction has
// committed, outside it and without being awaited by the request: a detached promise whose failure
// is logged, never answered, so a slow or failing provider neither delays nor fails the request and
// its timing says nothing. The log line names neither the address nor the code (R-SEC-2).
//
// THE DECOY. A branch that sends nothing (an unknown address asking for a reset) hashes a fresh
// code all the same, so every branch does the same Argon2id work (the oracle PR #74's review found).
//
// VERIFYING. Wrong, expired, spent and over-the-cap codes are one refusal, CODE_INVALID, with one
// message. Each attempt is counted before the hash is compared, and only below `otp_max_attempts`,
// so the cap holds under concurrent guesses; the code is consumed by the one call that matches.
import { generateOneTimeCode } from '../../platform/guards/identifiers.js';
import { OtpHasher, type Verification } from '../../platform/crypto/hashing.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { EmailPort } from '../../platform/ports/email/email.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { addMinutes } from '@ijazah/time';
import { z } from 'zod';

import { type CodeMailPurpose, renderCodeMail } from './mail/code-mail.js';
import { OtpCodesRepository } from './otp-codes.repository.js';

export const OTP_TTL_SETTING = 'otp_code_ttl_minutes';
export const OTP_MAX_ATTEMPTS_SETTING = 'otp_max_attempts';

const positiveWhole = z.int().positive();

/** How a code is hashed and compared: the peppered Argon2id of `hashing.ts`. */
export interface CodeHasher {
  hash(code: string): Promise<string>;
  verify(code: string, stored: string): Promise<Verification>;
}

/** Where a detached mail's failure is told. */
export interface WarningLog {
  warn(entry: object, message?: string): void;
}

export interface OneTimeCodesDependencies {
  readonly database: Database;
  readonly settings: SettingsReader;
  readonly encryptionKey: string;
  readonly email: EmailPort;
  readonly log: WarningLog;
  readonly now?: () => Date;
  readonly hasher?: CodeHasher;
}

/** An address as it is stored and compared: trimmed, lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class OneTimeCodes {
  readonly #codes: OtpCodesRepository;
  readonly #transactions;
  readonly #settings: SettingsReader;
  readonly #email: EmailPort;
  readonly #log: WarningLog;
  readonly #now: () => Date;
  readonly #hasher: CodeHasher;

  constructor(dependencies: OneTimeCodesDependencies) {
    this.#codes = new OtpCodesRepository(dependencies.database);
    this.#transactions = transactionsOver(dependencies.database);
    this.#settings = dependencies.settings;
    this.#email = dependencies.email;
    this.#log = dependencies.log;
    this.#now = dependencies.now ?? (() => new Date());
    this.#hasher = dependencies.hasher ?? new OtpHasher(dependencies.encryptionKey);
  }

  /** Writes a fresh code for `destination` and mails it once the row has committed. */
  async send(destination: string, purpose: CodeMailPurpose): Promise<void> {
    const minutes = await this.#settings.read(OTP_TTL_SETTING, positiveWhole);
    const code = generateOneTimeCode();
    const codeHash = await this.#hasher.hash(code);
    const expiresAt = new Date(addMinutes(this.#now(), minutes));
    await this.#transactions.run((tx) =>
      this.#codes.replace(tx, { destination, purpose, codeHash, expiresAt }),
    );
    const mail = renderCodeMail(purpose, code, minutes);
    void this.#email.deliver({ to: destination, ...mail }).catch((error: unknown) => {
      this.#log.warn(
        { err: error instanceof Error ? error.name : 'unknown', purpose },
        'A one-time code mail could not be delivered',
      );
    });
  }

  /** The same hashing work as `send`, for a branch that sends nothing. */
  async decoy(): Promise<void> {
    await this.#hasher.hash(generateOneTimeCode());
  }

  /** Consumes the live code of `destination` and `purpose` when `code` is it; CODE_INVALID if not. */
  async verify(destination: string, purpose: CodeMailPurpose, code: string): Promise<void> {
    const max = await this.#settings.read(OTP_MAX_ATTEMPTS_SETTING, positiveWhole);
    const now = this.#now();
    const row = await this.#codes.findLatest(destination, purpose);
    if (row === null || row.consumedAt !== null || row.expiresAt <= now) throw invalidCode();
    if (!(await this.#codes.countAttempt(row.id, max))) throw invalidCode();
    const { valid } = await this.#hasher.verify(code, row.codeHash);
    if (!valid || !(await this.#codes.consume(row.id, now))) throw invalidCode();
  }
}

function invalidCode(): DomainError {
  return new DomainError('CODE_INVALID');
}
