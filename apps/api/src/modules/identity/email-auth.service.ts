// T047: the email account (FR-120, FR-128, FR-129, research R-104, R-105).
//
// SIGN-UP. A code goes to every well-formed address, the same answer whether the address is in use
// or not; only once the code verifies is an address in use told, with its account's method
// (FR-123), so the conflict reaches only someone who controls the mailbox and nothing is
// enumerated. A verified code yields an onboarding token for the address. An address a banned
// person's deleted account left (T097, FR-155) is refused after the code, ACCOUNT_RESTRICTED with no
// detail and no token; the code request answers it as any other (R-104).
//
// SIGN-IN. The password is verified after the throttle the router applies (FR-135). An unknown
// address and a provider account verify against a decoy hash, so every branch does one Argon2id
// verification and answers SIGN_IN_FAILED with one message (R-107's timing rule).
//
// RESET. The request answers every address with the same `void` and the same hashing work: a code
// for an email account, the decoy hash for an unknown or a provider address; the mail leaves after
// the commit, never awaited (`one-time-codes.ts`). The reset checks the new password first (length
// is the schema's, the breached list the service's: PASSWORD_WEAK), so a weak choice spends no
// code; then it consumes the code, sets the hash, revokes every other session (`password_reset`)
// and signs in, in one transaction (FR-129).
import { isBreached } from '../../platform/crypto/breached-passwords/index.js';
import { hashPassword, type Verification, verifyPassword } from '../../platform/crypto/hashing.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { generateSecretToken } from '../../platform/guards/identifiers.js';
import { BannedIdentifiers } from './banned-identifiers.js';
import { AccountsRepository } from './identity.repository.js';
import type { OnboardingService } from './onboarding.service.js';
import { normalizeEmail, type OneTimeCodes } from './one-time-codes.js';
import type {
  IdentityDependencies,
  Landing,
  SessionService,
  SessionTokens,
} from './session.service.js';

/** How a password is hashed and compared: the Argon2id of `hashing.ts`. */
export interface PasswordHashing {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<Verification>;
}

export interface EmailAuthDependencies extends IdentityDependencies {
  readonly codes: Pick<OneTimeCodes, 'send' | 'verify' | 'decoy'>;
  readonly onboarding: Pick<OnboardingService, 'mint'>;
  readonly sessions: Pick<SessionService, 'issue' | 'landing' | 'revokeAll'>;
  readonly passwords?: PasswordHashing;
}

type SignedIn = SessionTokens & { readonly landing: Landing };

const signInFailed = () => new DomainError('SIGN_IN_FAILED');

export class EmailAuthService {
  readonly #accounts: AccountsRepository;
  readonly #banned: BannedIdentifiers;
  readonly #transactions;
  readonly #dependencies: EmailAuthDependencies;
  readonly #passwords: PasswordHashing;
  /** The hash an unknown address is verified against, made once. */
  readonly #decoy: Promise<string>;

  constructor(dependencies: EmailAuthDependencies) {
    this.#dependencies = dependencies;
    this.#accounts = new AccountsRepository(dependencies.database);
    this.#banned = new BannedIdentifiers(dependencies);
    this.#transactions = transactionsOver(dependencies.database);
    this.#passwords = dependencies.passwords ?? { hash: hashPassword, verify: verifyPassword };
    this.#decoy = this.#passwords.hash(generateSecretToken());
  }

  /** Sends a sign-up code to any well-formed address; the same answer for every one. */
  async requestSignUpCode(email: string): Promise<void> {
    await this.#dependencies.codes.send(normalizeEmail(email), 'signup');
  }

  /** An onboarding token for a verified address, or the conflict once the code verifies. */
  async verifySignUpCode(
    email: string,
    code: string,
  ): Promise<{ readonly onboardingToken: string }> {
    const address = normalizeEmail(email);
    await this.#dependencies.codes.verify(address, 'signup', code);
    await this.#banned.refuse({ email: address });
    const owner = await this.#accounts.findByEmail(address);
    if (owner !== null) {
      throw new DomainError('EMAIL_IN_USE_BY_OTHER_METHOD', undefined, {
        details: [{ path: 'email', code: owner.method }],
      });
    }
    return {
      onboardingToken: await this.#dependencies.onboarding.mint({ kind: 'email', email: address }),
    };
  }

  /** Signs in an email account; SIGN_IN_FAILED, after the same work, for anything else. */
  async signIn(email: string, password: string): Promise<SignedIn> {
    const owner = await this.#accounts.findByEmail(normalizeEmail(email));
    const stored = owner?.passwordHash ?? (await this.#decoy);
    const { valid } = await this.#passwords.verify(password, stored);
    if (!valid || owner === null || owner.passwordHash === null) throw signInFailed();
    const tokens = await this.#dependencies.sessions.issue(owner.userId);
    return { ...tokens, landing: await this.#dependencies.sessions.landing(owner.userId) };
  }

  /** Mails a reset code to an email account; the same answer and work for every address. */
  async requestPasswordReset(email: string): Promise<void> {
    const address = normalizeEmail(email);
    const owner = await this.#accounts.findByEmail(address);
    if (owner === null || owner.passwordHash === null) {
      await this.#dependencies.codes.decoy();
      return;
    }
    await this.#dependencies.codes.send(address, 'password_reset');
  }

  /** Sets a new password, signs in and revokes every other session (FR-129). */
  async resetPassword(email: string, code: string, newPassword: string): Promise<SignedIn> {
    if (isBreached(newPassword)) throw new DomainError('PASSWORD_WEAK');
    const address = normalizeEmail(email);
    await this.#dependencies.codes.verify(address, 'password_reset', code);
    const owner = await this.#accounts.findByEmail(address);
    if (owner === null || owner.passwordHash === null) throw new DomainError('CODE_INVALID');
    const passwordHash = await this.#passwords.hash(newPassword);
    const { sessions } = this.#dependencies;
    return this.#transactions.run(async (tx) => {
      await this.#accounts.setPasswordHash(tx, owner.userId, passwordHash);
      await sessions.revokeAll(owner.userId, 'password_reset', { tx });
      const tokens = await sessions.issue(owner.userId, tx);
      return { ...tokens, landing: await sessions.landing(owner.userId, tx) };
    });
  }
}
