// T082 (FR-140 to FR-143, SC-111, ADR 0015 D1 to D4; the B16 check, decisions 1 to 6): the deletion
// of an account, in the app and on the web. The specs are T080's (deletion.service.spec.ts) and the
// composition's over the real tables (tests/db-integrity/account-deletion.spec.ts).
//
// - `deleteAccount` is `account.delete`. The typed word is the schema's (either language). The proof
//   is checked before any transaction opens (decision 5): a provider token whose nonce the server
//   minted, its single-use mark taken before the token is read, verified for the provider of each of
//   the caller's own `auth_identities` rows until one proves that row's subject; or the password
//   against the caller's own hash, a decoy hash where the caller has none. Anything else, another
//   person's valid proof included, is one answer, SIGN_IN_FAILED (not UNAUTHENTICATED, which would
//   sign the phone out), and changes nothing. Then the one transaction, keyed (decision 6, FR-106).
//   The key's stored input names the typed word and the proof's kind, and its stored outcome is
//   null: neither a password, a token, the address nor a grant outlives the deletion in the
//   kernel's table.
// - `requestWebCode` and `confirmWebDeletion` are the web pages' two steps (public-pages.md). The
//   first answers every address with the same `void` and one hashing: a code (purpose
//   `account_deletion`) for an account, whatever its sign-in method, mailed after the commit and
//   never awaited; the decoy hash otherwise. The second consumes the code (one Argon2id comparison
//   on every path, `one-time-codes.ts`) and runs the same transaction; a wrong code answers false
//   and deletes nothing. A right code whose account is gone meanwhile was another deletion's: true.
// - THE TRANSACTION (ADR 0015 D3): the address and Apple's grants read, the row soft-deleted with
//   its personal fields erased (conditional on the row still being live, so of two deletions racing
//   on one person exactly one erases and only that one does the work after the commit), the
//   identity rows deleted, every session revoked (`account_deleted`), the push tokens removed, a
//   teacher's bio and payout columns erased, then the consequences registry with `account_deleted`
//   (FR-142, decision 2): the verification module marks the documents erased there. A throw anywhere
//   rolls all of it back.
// - AFTER THE COMMIT, outside the transaction and detached from the request: the photo's file
//   removed and only then its key cleared; each other module's files handed over (the verification
//   module's documents, decision 1); the Apple grant revoked through the port (decision 3); the
//   confirmation mailed. Each failure is reported and the deletion stands; the files are retried by
//   `erase-deleted-files`, and no log line names the address, a key or a token (R-SEC-2).
import type { DeleteAccountInput } from '@ijazah/contracts';

import { ColumnCipher } from '../../platform/crypto/encryption.js';
import { hashPassword, verifyPassword } from '../../platform/crypto/hashing.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { reportError } from '../../platform/errors/reporting.js';
import { generateSecretToken } from '../../platform/guards/identifiers.js';
import type { IdempotencyService } from '../../platform/idempotency/idempotency.service.js';
import type { EmailPort } from '../../platform/ports/email/email.port.js';
import { IdentityTokenError, type SignInPort } from '../../platform/ports/sign-in/sign-in.port.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import type { SingleUseMarks } from '../../platform/redis/single-use-marks.js';
import type { AccountConsequences } from './consequences.js';
import type { PasswordHashing } from './email-auth.service.js';
import {
  AccountsRepository,
  DeletedPhotosRepository,
  type DeletionProof,
  eraseAccount,
  type ErasureSnapshot,
  readDeletionProof,
  readErasureSnapshot,
} from './identity.repository.js';
import { renderDeletionMail } from './mail/deletion-mail.js';
import { normalizeEmail, type OneTimeCodes, type WarningLog } from './one-time-codes.js';
import type { IdentityDependencies } from './session.service.js';
import { UserSessionsRepository } from './user-sessions.repository.js';

/** The column Apple's grant is encrypted under, bound to its identity row (R-DB-8). */
const GRANT_COLUMN = 'auth_identities.provider_refresh_token_encrypted';

/** Another module's files of a deleted person, removed after the commit (the verification module's documents). */
export interface FileErasure {
  /** Removes the person's erased files, each key cleared once its file is gone; throws if one could not be. */
  eraseFilesOf(userId: string): Promise<void>;
}

/** What the deletion is built over, beside the module's own dependencies. */
export interface DeletionDependencies extends IdentityDependencies {
  readonly consequences: AccountConsequences;
  /** The provider nonce's single-use mark (`auth.providerNonce`). */
  readonly marks: Pick<SingleUseMarks, 'take'>;
  readonly signIn: Pick<SignInPort, 'verifyIdentityToken' | 'revoke'>;
  readonly email: EmailPort;
  readonly storage: Pick<StoragePort, 'remove'>;
  /** `account.delete` is keyed (FR-106). */
  readonly idempotency: Pick<IdempotencyService<Transaction>, 'run'>;
  /** The web's `account_deletion` codes, shared with the email account's codes. */
  readonly codes: Pick<OneTimeCodes, 'send' | 'verify' | 'decoy'>;
  /** Where a mail that could not be handed over is told, never naming the address. */
  readonly log: WarningLog;
  /** The other modules' files of a deleted person, composed by `main.ts`. */
  readonly fileErasures?: readonly FileErasure[] | undefined;
  /** Where a failure after the commit is reported; the error tracker unless a spec sets one. */
  readonly report?: ((error: unknown) => void) | undefined;
  /** Where the work after the commit is left to run; detached unless a spec collects it. */
  readonly defer?: (work: Promise<void>) => void;
  readonly passwords?: PasswordHashing;
}

type Reauth = DeleteAccountInput['reauth'];

const proofRefused = () => new DomainError('SIGN_IN_FAILED');

export class DeletionService {
  readonly #dependencies: DeletionDependencies;
  readonly #accounts: AccountsRepository;
  readonly #sessions: UserSessionsRepository;
  readonly #photos: DeletedPhotosRepository;
  readonly #transactions;
  readonly #cipher: ColumnCipher;
  readonly #passwords: PasswordHashing;
  readonly #report: (error: unknown) => void;
  readonly #defer: (work: Promise<void>) => void;
  readonly #now: () => Date;
  /** The hash a caller without a password is verified against, made once. */
  readonly #decoy: Promise<string>;

  constructor(dependencies: DeletionDependencies) {
    this.#dependencies = dependencies;
    this.#accounts = new AccountsRepository(dependencies.database);
    this.#sessions = new UserSessionsRepository(dependencies.database);
    this.#photos = new DeletedPhotosRepository(dependencies.database);
    this.#transactions = transactionsOver(dependencies.database);
    this.#cipher = new ColumnCipher(dependencies.encryptionKey);
    this.#passwords = dependencies.passwords ?? { hash: hashPassword, verify: verifyPassword };
    this.#report = dependencies.report ?? reportError;
    this.#defer = dependencies.defer ?? ((work) => void work);
    this.#now = dependencies.now ?? (() => new Date());
    this.#decoy = this.#passwords.hash(generateSecretToken());
    // Handled here so a failure is never unhandled; the proof awaits it and meets the failure there.
    this.#decoy.catch(() => undefined);
  }

  /** `account.delete`: the caller's own account, erased. */
  async deleteAccount(userId: string, input: DeleteAccountInput): Promise<void> {
    await this.#prove(userId, input.reauth);
    const at = this.#now();
    // What the transaction read, kept in this call only: a replayed key runs no effect, so it does
    // no work after the commit either (the first call did).
    const call: { erased: ErasureSnapshot | null } = { erased: null };
    await this.#dependencies.idempotency.run(
      {
        scope: 'account.delete',
        key: input.idempotencyKey,
        actorId: userId,
        input: { confirmation: input.confirmation, reauth: input.reauth.kind },
      },
      async (tx) => {
        call.erased = await this.#erase(tx, userId, at);
        return null;
      },
    );
    if (call.erased !== null) this.#afterCommit(userId, call.erased);
  }

  /** The web's email step: the same answer and work for every address (public-pages.md). */
  async requestWebCode(email: string): Promise<void> {
    const address = normalizeEmail(email);
    const owner = await this.#accounts.findByEmail(address);
    if (owner === null) {
      await this.#dependencies.codes.decoy();
      return;
    }
    await this.#dependencies.codes.send(address, 'account_deletion');
  }

  /** The web's confirm step: true when the code was right and the account is deleted. */
  async confirmWebDeletion(email: string, code: string): Promise<boolean> {
    const address = normalizeEmail(email);
    try {
      await this.#dependencies.codes.verify(address, 'account_deletion', code);
    } catch (error: unknown) {
      if (error instanceof DomainError && error.code === 'CODE_INVALID') return false;
      throw error;
    }
    const owner = await this.#accounts.findByEmail(address);
    if (owner === null) return true;
    const at = this.#now();
    const erased = await this.#transactions.run((tx) => this.#erase(tx, owner.userId, at));
    if (erased !== null) this.#afterCommit(owner.userId, erased);
    return true;
  }

  /** The one transaction (ADR 0015 D3); null when the person was already deleted. */
  async #erase(tx: Transaction, userId: string, at: Date): Promise<ErasureSnapshot | null> {
    const snapshot = await readErasureSnapshot(tx, userId);
    if (snapshot === null || !(await eraseAccount(tx, userId, at))) return null;
    await this.#sessions.revokeAll(tx, userId, 'account_deleted', { at });
    await this.#dependencies.consequences.onAccountTerminated(tx, userId, 'account_deleted');
    return snapshot;
  }

  /** The proof, before any transaction (decision 5); SIGN_IN_FAILED for anything it refuses. */
  async #prove(userId: string, reauth: Reauth): Promise<void> {
    if (reauth.kind === 'provider') {
      // The mark is taken first, so a captured token and nonce replay nothing, refused or not.
      if (!(await this.#takeNonce(reauth.nonce))) throw proofRefused();
      const proof = await readDeletionProof(this.#dependencies.database, userId);
      if (proof === null || !(await this.#provesIdentity(proof, reauth))) throw proofRefused();
      return;
    }
    const proof = await readDeletionProof(this.#dependencies.database, userId);
    const stored = proof?.passwordHash ?? (await this.#decoy);
    const { valid } = await this.#passwords.verify(reauth.password, stored);
    if (!valid || proof?.passwordHash == null) throw proofRefused();
  }

  /** Whether the token proves one of the caller's own identities. */
  async #provesIdentity(
    proof: DeletionProof,
    reauth: Extract<Reauth, { kind: 'provider' }>,
  ): Promise<boolean> {
    for (const identity of proof.identities) {
      try {
        const proven = await this.#dependencies.signIn.verifyIdentityToken({
          provider: identity.provider,
          token: reauth.identityToken,
          nonce: reauth.nonce,
        });
        if (proven.provider === identity.provider && proven.subject === identity.subject) {
          return true;
        }
      } catch (error: unknown) {
        if (!(error instanceof IdentityTokenError)) throw error;
      }
    }
    return false;
  }

  async #takeNonce(nonce: string): Promise<boolean> {
    try {
      return await this.#dependencies.marks.take('provider-nonce', nonce);
    } catch (error: unknown) {
      // A nonce of a shape no mark can have was never minted (`sign-in.service.ts`).
      if (error instanceof TypeError) return false;
      throw error;
    }
  }

  /** The work after the commit, each part on its own, detached from the request. */
  #afterCommit(userId: string, { email, grants }: ErasureSnapshot): void {
    const reported = (work: () => Promise<void>) =>
      work().catch((error: unknown) => this.#report(error));
    const files = this.#dependencies.fileErasures ?? [];
    this.#defer(
      Promise.all([
        reported(() => this.#removePhoto(userId)),
        ...files.map((erasure) => reported(() => erasure.eraseFilesOf(userId))),
        ...grants.map(({ identityId, refreshTokenEncrypted }) =>
          reported(() =>
            this.#dependencies.signIn.revoke({
              provider: 'apple',
              refreshToken: this.#cipher.decrypt(refreshTokenEncrypted, GRANT_COLUMN, identityId),
            }),
          ),
        ),
        this.#mail(email),
      ]).then(() => undefined),
    );
  }

  /** The photo's file removed, and its key cleared only once it is gone. */
  async #removePhoto(userId: string): Promise<void> {
    const photo = await this.#photos.heldOf(userId);
    if (photo === null) return;
    await this.#dependencies.storage.remove(photo.storageKey);
    await this.#photos.clear(photo);
  }

  async #mail(email: string | null): Promise<void> {
    if (email === null) return;
    try {
      await this.#dependencies.email.deliver({ to: email, ...renderDeletionMail() });
    } catch (error: unknown) {
      this.#dependencies.log.warn(
        { err: error instanceof Error ? error.name : 'unknown', mail: 'account_deleted' },
        'A deletion confirmation mail could not be delivered',
      );
    }
  }
}
