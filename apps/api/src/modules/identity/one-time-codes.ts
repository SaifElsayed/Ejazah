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
// Every verification compares one Argon2id hash, a decoy where no usable code exists (none sent,
// lapsed, spent, over the cap), so a wrong code takes the same work whether the address has an
// account or not, and the save step of a reset is no oracle either (review of B9, M1).
//
// THE FAILED CODES' CAP (R1a, 002:T173; SRS §3.14, DEC-100). Every CODE_INVALID, whatever made the
// code fail, counts once under `rate_limit_failed_one_time_code`, its subject the purpose and the
// normalised address, in the limiter's fixed window that the first failure opens. Before a code is
// written, the count is read, never added to: at the setting's limit the request does the decoy's
// work and writes and mails nothing, so its answer is every address's (R-104). A right code resets
// nothing. The failure that fills the cap writes the window's one record, the purpose and the
// subject's digest only, so the refusals it starts write none.
import { generateOneTimeCode } from '../../platform/guards/identifiers.js';
import { OtpHasher, type Verification } from '../../platform/crypto/hashing.js';
import type { Database } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type {
  RateLimiter,
  RateLimitKey,
  RateLimitSubject,
} from '../../platform/guards/rate-limit.guard.js';
import type { EmailPort } from '../../platform/ports/email/email.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import { addMinutes } from '@ijazah/time';
import { z } from 'zod';

import { type CodeMailPurpose, renderCodeMail } from './mail/code-mail.js';
import { OtpCodesRepository } from './otp-codes.repository.js';

export const OTP_TTL_SETTING = 'otp_code_ttl_minutes';
export const OTP_MAX_ATTEMPTS_SETTING = 'otp_max_attempts';
/** T173 (SRS §3.14, DEC-100): failed codes per e-mail address and purpose before issuing stops. */
export const FAILED_CODE_RATE_LIMIT = 'rate_limit_failed_one_time_code' satisfies RateLimitKey;

/** Where failed codes are counted and the cap read (T173): the process's limiter. */
export type FailedCodeCap = Pick<RateLimiter, 'countEvent' | 'isCapped'>;

/**
 * The cap of a composition no limiter was bound to (T173): every use fails closed, so such a
 * composition issues no code and answers no failed one, rather than issuing codes uncapped.
 */
export const UNBOUND_FAILED_CODE_CAP: FailedCodeCap = {
  countEvent: () => Promise.reject(new Error('No limiter is bound for the failed one-time codes.')),
  isCapped: () => Promise.reject(new Error('No limiter is bound for the failed one-time codes.')),
};

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
  /** T173: counts each failed code, and is read before each code is issued. */
  readonly failedCodes: FailedCodeCap;
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
  readonly #failedCodes: FailedCodeCap;
  /** The hash a verification without a usable code compares against, made once. */
  readonly #decoyHash: Promise<string>;

  constructor(dependencies: OneTimeCodesDependencies) {
    this.#codes = new OtpCodesRepository(dependencies.database);
    this.#transactions = transactionsOver(dependencies.database);
    this.#settings = dependencies.settings;
    this.#email = dependencies.email;
    this.#log = dependencies.log;
    this.#now = dependencies.now ?? (() => new Date());
    this.#hasher = dependencies.hasher ?? new OtpHasher(dependencies.encryptionKey);
    this.#failedCodes = dependencies.failedCodes;
    this.#decoyHash = this.#hasher.hash(generateOneTimeCode());
    // Handled here so a failure is never unhandled; `verify` awaits it and meets the failure there.
    this.#decoyHash.catch(() => undefined);
  }

  /** Writes a fresh code for `destination` and mails it once the row has committed. */
  async send(destination: string, purpose: CodeMailPurpose): Promise<void> {
    if (await this.#failedCodes.isCapped(FAILED_CODE_RATE_LIMIT, capSubject(destination, purpose))) {
      // T173: capped, the decoy's work and nothing written or mailed; the caller answers as ever.
      await this.decoy();
      return;
    }
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
    const live = row !== null && row.consumedAt === null && now < row.expiresAt ? row : null;
    const counted = live !== null && (await this.#codes.countAttempt(live.id, max)) ? live : null;
    // One Argon2id comparison on every path: the code's own hash, or the decoy's.
    const { valid } = await this.#hasher.verify(code, counted?.codeHash ?? (await this.#decoyHash));
    if (counted === null || !valid || !(await this.#codes.consume(counted.id, now))) {
      await this.#countFailure(destination, purpose);
      throw invalidCode();
    }
  }

  /** T173: one failed code counted; the failure that fills the cap writes the window's record. */
  async #countFailure(destination: string, purpose: CodeMailPurpose): Promise<void> {
    const subjectDigest = await this.#failedCodes.countEvent(
      FAILED_CODE_RATE_LIMIT,
      capSubject(destination, purpose),
    );
    if (subjectDigest !== undefined) {
      this.#log.warn(
        { purpose, subjectDigest },
        'One-time codes capped for an address and purpose until the window ends',
      );
    }
  }
}

/** The cap's subject (T173): the purpose and the address as it is stored, one counter each. */
function capSubject(destination: string, purpose: CodeMailPurpose): RateLimitSubject {
  return { kind: 'identifier', value: `${purpose}:${normalizeEmail(destination)}` };
}

function invalidCode(): DomainError {
  return new DomainError('CODE_INVALID');
}
