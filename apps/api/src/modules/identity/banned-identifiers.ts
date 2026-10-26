// T097 (FR-155; ADR 0015 D1 and D3; the note under T097): a banned person's sign-in identifiers
// outlive the deletion of their account, so the ban does too.
//
// THE HASH. HMAC-SHA256 under a subkey of ENCRYPTION_KEY derived by HKDF under
// `ijazah:banned-identifier:v1`, hex. Its input names its kind first and separates every part with
// NUL, which neither a normalized address nor a provider name can hold, so no address and no pair
// hash alike and no two pairs share an input:
//   an address    `email` NUL <the address as `normalizeEmail` gives it>
//   an identity   `provider` NUL <google | apple> NUL <the provider's subject>
// The key never leaves the process; without it a stored hash cannot be tested against a guessed
// address. Without the address, the hash cannot be remade under a new key either, so a rotation of
// ENCRYPTION_KEY leaves every stored row unmatched (docs/RUNBOOK.md).
//
// KEEPING. `keep` runs in the deletion's transaction, before the row's personal fields and its
// `auth_identities` are erased, and only for an account whose `account_status` is `banned`.
//
// THE CHECK. `refuse` runs only after the person proved the address or the account (the right code,
// a provider token, an onboarding token), never at the code request, which answers every address
// alike (R-104): otherwise anyone could learn of another person's ban. A match is
// ACCOUNT_RESTRICTED with no detail, thrown before any token is issued or any row written; nothing
// says an account was deleted before.
import { createHmac } from 'node:crypto';

import { BANNED_IDENTIFIER_LABEL, deriveSubkey } from '../../platform/crypto/encryption.js';
import type { Database, Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  type BannedIdentifierRow,
  BannedIdentifiersRepository,
  keepBannedIdentifiers,
} from './banned-identifiers.repository.js';
import { normalizeEmail } from './one-time-codes.js';

const SEPARATOR = '\u0000';

/** A provider identity: the provider and its subject. */
export interface ProviderSubject {
  readonly provider: 'google' | 'apple';
  readonly subject: string;
}

/** The identifiers a sign-up proved, any of which may be one a banned person left. */
export interface ProvenIdentifiers {
  readonly email?: string | null | undefined;
  readonly identity?: ProviderSubject | undefined;
}

export class BannedIdentifiers {
  readonly #key: Buffer;
  readonly #repository: BannedIdentifiersRepository;

  constructor(dependencies: { readonly database: Database; readonly encryptionKey: string }) {
    this.#key = deriveSubkey(dependencies.encryptionKey, BANNED_IDENTIFIER_LABEL);
    this.#repository = new BannedIdentifiersRepository(dependencies.database);
  }

  /** Keeps the hashes of a banned person's address and identities, on the deletion's transaction. */
  async keep(
    tx: Pick<Transaction, 'bannedIdentifier'>,
    {
      email,
      identities,
    }: { readonly email: string | null; readonly identities: readonly ProviderSubject[] },
  ): Promise<void> {
    const rows: BannedIdentifierRow[] = [
      ...(email === null ? [] : [{ kind: 'email' as const, identifierHmac: this.#email(email) }]),
      ...identities.map((identity) => ({
        kind: 'provider' as const,
        identifierHmac: this.#identity(identity),
      })),
    ];
    await keepBannedIdentifiers(tx, rows);
  }

  /** ACCOUNT_RESTRICTED, with no detail, when a proven identifier is one a banned person left. */
  async refuse({ email, identity }: ProvenIdentifiers): Promise<void> {
    const hashes = [
      ...(email == null ? [] : [this.#email(email)]),
      ...(identity === undefined ? [] : [this.#identity(identity)]),
    ];
    if (await this.#repository.holdsAny(hashes)) throw new DomainError('ACCOUNT_RESTRICTED');
  }

  #email(email: string): string {
    return this.#mac(['email', normalizeEmail(email)]);
  }

  #identity({ provider, subject }: ProviderSubject): string {
    return this.#mac(['provider', provider, subject]);
  }

  #mac(parts: readonly string[]): string {
    return createHmac('sha256', this.#key).update(parts.join(SEPARATOR), 'utf8').digest('hex');
  }
}
