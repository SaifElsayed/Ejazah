// T047: provider sign-in (FR-120 to FR-123, research R-102, R-103).
//
// THE NONCE. `providerNonce` mints 32 random bytes and marks them single-use in Redis until
// `provider_nonce_ttl_minutes` from now. `signInWithProvider` takes the mark before the token is
// read, so a nonce the server never minted, one that lapsed, and one already presented are refused
// alike, and a captured token with its nonce replays nothing: the mark is gone even when the token
// is then refused.
//
// THE TOKEN is verified by the sign-in port (signature, issuer, audience, expiry and the nonce,
// R-103). Its email is read only when the provider marks it verified (FR-121). A refusal of the
// nonce or the token is UNAUTHENTICATED, one answer.
//
// THE OUTCOME. An identity already linked to a live account signs in: a session and its landing. A
// new identity whose verified email belongs to an account is refused with that account's method,
// never signed in to or merged (FR-123). Any other new identity gets an onboarding token with the
// prefill; for Apple the authorization code is exchanged at once and the refresh token rides inside
// the token, encrypted (TN3194, ADR 0015 D3). Nothing is written before onboarding completes. A new
// identity whose subject, or whose verified email, a banned person's deleted account left (T097,
// FR-155) is refused after the token and before Apple's exchange: ACCOUNT_RESTRICTED, no detail, no
// token.
import { addMinutes } from '@ijazah/time';
import { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import { generateSecretToken } from '../../platform/guards/identifiers.js';
import {
  IdentityTokenError,
  type ProviderIdentity,
  type SignInPort,
} from '../../platform/ports/sign-in/sign-in.port.js';
import type { SingleUseMarks } from '../../platform/redis/single-use-marks.js';
import { BannedIdentifiers } from './banned-identifiers.js';
import { AccountsRepository } from './identity.repository.js';
import type { OnboardingService } from './onboarding.service.js';
import { normalizeEmail } from './one-time-codes.js';
import type { IdentityDependencies, Landing, SessionService } from './session.service.js';

export const PROVIDER_NONCE_TTL_SETTING = 'provider_nonce_ttl_minutes';

export interface SignInDependencies extends IdentityDependencies {
  readonly marks: SingleUseMarks;
  readonly signIn: SignInPort;
  readonly onboarding: Pick<OnboardingService, 'mint'>;
  readonly sessions: Pick<SessionService, 'issue' | 'landing'>;
}

/** `auth.signInWithProvider`'s input (packages/contracts, `signInWithProviderInput`). */
export interface ProviderSignIn {
  readonly provider: 'google' | 'apple';
  readonly identityToken: string;
  readonly nonce: string;
  readonly authorizationCode?: string | undefined;
}

/** `auth.signInWithProvider`'s answer. */
export type ProviderSignInOutcome =
  | {
      readonly outcome: 'session';
      readonly accessToken: string;
      readonly refreshToken: string;
      readonly landing: Landing;
    }
  | {
      readonly outcome: 'onboarding';
      readonly onboardingToken: string;
      readonly prefill: {
        readonly displayName?: string;
        readonly email?: string;
        readonly emailVerified: boolean;
      };
    };

const refused = (cause?: unknown) =>
  new DomainError('UNAUTHENTICATED', undefined, cause === undefined ? {} : { cause });

export class SignInService {
  readonly #accounts: AccountsRepository;
  readonly #banned: BannedIdentifiers;
  readonly #dependencies: SignInDependencies;
  readonly #now: () => Date;

  constructor(dependencies: SignInDependencies) {
    this.#dependencies = dependencies;
    this.#accounts = new AccountsRepository(dependencies.database);
    this.#banned = new BannedIdentifiers(dependencies);
    this.#now = dependencies.now ?? (() => new Date());
  }

  /** A fresh nonce for the next provider sign-in, single-use until it lapses. */
  async providerNonce(): Promise<{ readonly nonce: string; readonly expiresAt: string }> {
    const minutes = await this.#dependencies.settings.read(
      PROVIDER_NONCE_TTL_SETTING,
      z.int().positive(),
    );
    const nonce = generateSecretToken();
    const expiresAt = addMinutes(this.#now(), minutes);
    await this.#dependencies.marks.place('provider-nonce', nonce, new Date(expiresAt));
    return { nonce, expiresAt };
  }

  async signInWithProvider(input: ProviderSignIn): Promise<ProviderSignInOutcome> {
    if (!(await this.#takeNonce(input.nonce))) throw refused();
    const proven = await this.#verify(input);

    const userId = await this.#accounts.findUserIdByIdentity(proven.provider, proven.subject);
    if (userId !== null) {
      const tokens = await this.#dependencies.sessions.issue(userId);
      return {
        outcome: 'session',
        ...tokens,
        landing: await this.#dependencies.sessions.landing(userId),
      };
    }

    const email =
      proven.emailVerified && proven.email !== null ? normalizeEmail(proven.email) : null;
    await this.#banned.refuse({
      email,
      identity: { provider: proven.provider, subject: proven.subject },
    });
    if (email !== null) {
      const owner = await this.#accounts.findByEmail(email);
      if (owner !== null) {
        throw new DomainError('EMAIL_IN_USE_BY_OTHER_METHOD', undefined, {
          details: [{ path: 'email', code: owner.method }],
        });
      }
    }
    const grant =
      proven.provider === 'apple' && input.authorizationCode !== undefined
        ? (
            await this.#dependencies.signIn.exchangeAuthorization({
              provider: 'apple',
              code: input.authorizationCode,
            })
          ).refreshToken
        : undefined;
    const onboardingToken = await this.#dependencies.onboarding.mint({
      kind: 'provider',
      provider: proven.provider,
      subject: proven.subject,
      email,
      emailVerified: email !== null,
      displayName: proven.displayName,
      ...(grant === undefined ? {} : { grant }),
    });
    return {
      outcome: 'onboarding',
      onboardingToken,
      prefill: {
        emailVerified: email !== null,
        ...(email === null ? {} : { email }),
        ...(proven.displayName === null ? {} : { displayName: proven.displayName }),
      },
    };
  }

  async #takeNonce(nonce: string): Promise<boolean> {
    try {
      return await this.#dependencies.marks.take('provider-nonce', nonce);
    } catch (error: unknown) {
      // A nonce of a shape no mark can have (empty, or carrying the key separator) was never minted.
      if (error instanceof TypeError) return false;
      throw error;
    }
  }

  async #verify(input: ProviderSignIn): Promise<ProviderIdentity> {
    try {
      return await this.#dependencies.signIn.verifyIdentityToken({
        provider: input.provider,
        token: input.identityToken,
        nonce: input.nonce,
      });
    } catch (error: unknown) {
      if (error instanceof IdentityTokenError) throw refused(error);
      throw error;
    }
  }
}
