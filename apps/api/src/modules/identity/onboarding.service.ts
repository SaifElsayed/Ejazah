// T047: the first sign-in (FR-124 to FR-127, research R-102).
//
// THE TOKEN. A proven identity rides to the device in `v1.<payload>.<HMAC-SHA256>`, the key derived
// from ENCRYPTION_KEY under `ijazah:onboarding-token:v1`, the payload base64url JSON: a random
// `jti`, the expiry (`onboarding_token_ttl_minutes`), and the identity: a provider and its subject
// with the email it reported and whether it is verified, or a verified email. For Apple the
// provider's refresh token rides inside as a column-cipher blob bound to the `jti` (ciphertext the
// device cannot read), written to `auth_identities` by the completing transaction. Nothing of the
// person is stored on the server until the account is.
//
// COMPLETE. A token whose `jti` is already claimed is refused before anything else, so a used token
// says so rather than what its answers would meet. The answers are checked next (the current terms
// version, an IANA zone the time package
// knows, a password exactly for an email identity and not breached, an email and its code exactly
// when the identity has no verified one, an address no account holds), so a refusal there leaves
// the token good for another try. Then the `jti` is claimed in Redis until the token's expiry, and
// the person, the identity or the password hash, the one role, the terms acceptance and the session
// are written in one transaction. A transaction that fails releases the claim, so the person can try
// again with the same token; one that commits keeps it, so a second presentation is refused.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { addMinutes, assertTimeZone, TimeError } from '@ijazah/time';
import { z } from 'zod';

import { isBreached } from '../../platform/crypto/breached-passwords/index.js';
import {
  ColumnCipher,
  deriveSubkey,
  ONBOARDING_TOKEN_LABEL,
} from '../../platform/crypto/encryption.js';
import { hashPassword } from '../../platform/crypto/hashing.js';
import { transactionsOver } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { generateSecretToken } from '../../platform/guards/identifiers.js';
import type { SingleUseMarks } from '../../platform/redis/single-use-marks.js';
import { TERMS_VERSION_SETTING } from '../../platform/settings/keys.js';
import { AccountsRepository } from './identity.repository.js';
import { normalizeEmail, type OneTimeCodes } from './one-time-codes.js';
import type {
  IdentityDependencies,
  Landing,
  SessionService,
  SessionTokens,
} from './session.service.js';

export const ONBOARDING_TTL_SETTING = 'onboarding_token_ttl_minutes';

const TOKEN_VERSION = 'v1';
const GRANT_COLUMN = 'auth_identities.provider_refresh_token_encrypted';

const identitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('provider'),
    provider: z.enum(['google', 'apple']),
    subject: z.string().min(1),
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    displayName: z.string().nullable(),
    grant: z.string().optional(),
  }),
  z.object({ kind: z.literal('email'), email: z.string().min(1) }),
]);

const payloadSchema = z.object({
  jti: z.string().min(1),
  expiresAt: z.iso.datetime(),
  identity: identitySchema,
});

/** The identity a token carries. */
export type OnboardingIdentity = z.infer<typeof identitySchema>;

/** A proven identity before it becomes a token: the grant still in clear. */
export type ProvenIdentity =
  | (Omit<Extract<OnboardingIdentity, { kind: 'provider' }>, 'grant'> & {
      readonly grant?: string;
    })
  | Extract<OnboardingIdentity, { kind: 'email' }>;

/** `onboarding.complete`'s input (packages/contracts, `onboardingCompleteInput`). */
export interface CompleteInput {
  readonly onboardingToken: string;
  readonly role: 'student' | 'teacher';
  readonly displayName: string;
  readonly gender: 'male' | 'female';
  readonly dateOfBirth: string;
  readonly timezone: string;
  readonly termsVersion: string;
  readonly password?: string | undefined;
  readonly email?: string | undefined;
  readonly emailCode?: string | undefined;
}

export interface OnboardingDependencies extends IdentityDependencies {
  readonly marks: SingleUseMarks;
  readonly sessions: Pick<SessionService, 'issue'>;
  readonly codes: Pick<OneTimeCodes, 'send' | 'verify'>;
  /** The key a rotation retires, so a token minted under it still reads (research R-8). */
  readonly encryptionKeyPrevious?: string | undefined;
}

const invalidToken = () => new DomainError('ONBOARDING_TOKEN_INVALID');

const invalidField = (path: string, code: string) =>
  new DomainError('VALIDATION_FAILED', undefined, { details: [{ path, code }] });

export class OnboardingService {
  readonly #accounts: AccountsRepository;
  readonly #transactions;
  readonly #dependencies: OnboardingDependencies;
  readonly #key: Buffer;
  readonly #cipher: ColumnCipher;
  readonly #now: () => Date;

  constructor(dependencies: OnboardingDependencies) {
    this.#dependencies = dependencies;
    this.#accounts = new AccountsRepository(dependencies.database);
    this.#transactions = transactionsOver(dependencies.database);
    this.#key = deriveSubkey(dependencies.encryptionKey, ONBOARDING_TOKEN_LABEL);
    this.#cipher = new ColumnCipher(dependencies.encryptionKey, dependencies.encryptionKeyPrevious);
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** The token a proven identity rides in until `complete`. */
  async mint(identity: ProvenIdentity): Promise<string> {
    const minutes = await this.#dependencies.settings.read(
      ONBOARDING_TTL_SETTING,
      z.int().positive(),
    );
    const jti = generateSecretToken();
    const carried: OnboardingIdentity =
      identity.kind === 'provider' && identity.grant !== undefined
        ? {
            ...identity,
            grant: this.#cipher.encrypt(identity.grant, GRANT_COLUMN, jti).toString('base64url'),
          }
        : identity;
    const payload = Buffer.from(
      JSON.stringify({ jti, expiresAt: addMinutes(this.#now(), minutes), identity: carried }),
    ).toString('base64url');
    const body = `${TOKEN_VERSION}.${payload}`;
    return `${body}.${this.#mac(body)}`;
  }

  /** Sends a code to `email` for an identity whose provider gave no verified email (FR-122). */
  async requestEmailCode(onboardingToken: string, email: string): Promise<void> {
    const { identity } = this.#read(onboardingToken);
    if (verifiedEmailOf(identity) !== null) throw invalidField('onboardingToken', 'email_verified');
    await this.#dependencies.codes.send(normalizeEmail(email), 'signup');
  }

  /** Writes the account and its first session in one transaction (FR-125). */
  async complete(
    input: CompleteInput,
    preferredLanguage: 'ar' | 'en' = 'ar',
  ): Promise<SessionTokens & { readonly landing: Landing }> {
    const { jti, expiresAt, identity } = this.#read(input.onboardingToken);
    if (await this.#dependencies.marks.has('onboarding', jti)) throw invalidToken();
    const terms = await this.#dependencies.settings.read(TERMS_VERSION_SETTING, z.string().min(1));
    if (input.termsVersion !== terms) throw invalidField('termsVersion', 'not_current');
    try {
      assertTimeZone('timezone', input.timezone);
    } catch (error: unknown) {
      if (error instanceof TimeError) throw invalidField('timezone', 'unknown');
      throw error;
    }
    const passwordHash = await this.#passwordHash(identity, input.password);
    const email = await this.#email(identity, input);
    const owner = await this.#accounts.findByEmail(email);
    if (owner !== null) {
      throw new DomainError('EMAIL_IN_USE_BY_OTHER_METHOD', undefined, {
        details: [{ path: 'email', code: owner.method }],
      });
    }
    const grant =
      identity.kind === 'provider' && identity.grant !== undefined
        ? this.#cipher.decrypt(Buffer.from(identity.grant, 'base64url'), GRANT_COLUMN, jti)
        : null;

    if (!(await this.#dependencies.marks.place('onboarding', jti, expiresAt))) {
      throw invalidToken();
    }
    try {
      return await this.#transactions.run(async (tx) => {
        const identityId = randomUUID();
        const userId = await this.#accounts.create(tx, {
          email,
          passwordHash,
          displayName: input.displayName,
          gender: input.gender,
          dateOfBirth: input.dateOfBirth,
          timezone: input.timezone,
          preferredLanguage,
          role: input.role,
          termsVersion: input.termsVersion,
          acceptedAt: this.#now(),
          ...(identity.kind === 'provider'
            ? {
                identity: {
                  id: identityId,
                  provider: identity.provider,
                  subject: identity.subject,
                  grantEncrypted:
                    grant === null ? null : this.#cipher.encrypt(grant, GRANT_COLUMN, identityId),
                },
              }
            : {}),
        });
        const tokens = await this.#dependencies.sessions.issue(userId, tx);
        return {
          ...tokens,
          landing: input.role === 'student' ? 'student_home' : 'teacher_application',
        } as const;
      });
    } catch (error: unknown) {
      await this.#dependencies.marks.take('onboarding', jti);
      throw error;
    }
  }

  async #passwordHash(identity: OnboardingIdentity, password: string | undefined) {
    if (identity.kind !== 'email') {
      if (password !== undefined) throw invalidField('password', 'not_allowed');
      return null;
    }
    if (password === undefined) throw invalidField('password', 'required');
    if (isBreached(password)) throw new DomainError('PASSWORD_WEAK');
    return hashPassword(password);
  }

  async #email(identity: OnboardingIdentity, input: CompleteInput): Promise<string> {
    const verified = verifiedEmailOf(identity);
    if (verified !== null) {
      if (input.email !== undefined || input.emailCode !== undefined) {
        throw invalidField('email', 'not_allowed');
      }
      return verified;
    }
    if (input.email === undefined || input.emailCode === undefined) {
      throw invalidField('email', 'required');
    }
    const email = normalizeEmail(input.email);
    await this.#dependencies.codes.verify(email, 'signup', input.emailCode);
    return email;
  }

  #read(token: string): {
    readonly jti: string;
    readonly expiresAt: Date;
    readonly identity: OnboardingIdentity;
  } {
    const [version, payload, mac, ...rest] = token.split('.');
    if (
      version !== TOKEN_VERSION ||
      payload === undefined ||
      mac === undefined ||
      rest.length > 0
    ) {
      throw invalidToken();
    }
    const expected = Buffer.from(this.#mac(`${version}.${payload}`));
    const given = Buffer.from(mac);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw invalidToken();
    let parsed: z.infer<typeof payloadSchema>;
    try {
      parsed = payloadSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    } catch {
      throw invalidToken();
    }
    const expiresAt = new Date(parsed.expiresAt);
    if (expiresAt <= this.#now()) throw invalidToken();
    return { jti: parsed.jti, expiresAt, identity: parsed.identity };
  }

  #mac(body: string): string {
    return createHmac('sha256', this.#key).update(body).digest('base64url');
  }
}

/** The verified email an identity carries, or null (FR-121: an unverified one is absent). */
function verifiedEmailOf(identity: OnboardingIdentity): string | null {
  if (identity.kind === 'email') return identity.email;
  return identity.emailVerified && identity.email !== null ? identity.email : null;
}
