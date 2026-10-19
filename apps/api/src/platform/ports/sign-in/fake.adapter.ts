// T022: the sign-in stand-in (contracts/ports.md "Stand-in behaviour", research R-103). It takes
// an unsigned fake token of a documented shape, so no key reaches a device: the stand-in is
// refused outside development and test (T168, env.schema.ts), so the unsigned shape reaches no
// deployment. It still compares the nonce it is handed with the token's field, as the live adapter
// compares the token's claim with the nonce the service consumed; the service owns the single-use
// mark, and an adapter holds no Redis state. The phone app in development builds the same shape
// behind a development-only flag, so the owner can walk the flow without a provider account.
//
// THE SHAPE: `fake.<provider>.<subject>.<email or ->.<verified|unverified>.<nonce>`. The subject
// and the nonce carry no dot (a nonce is base64url; the fake subject is letters, digits, `_` and
// `-`), so the email, which carries dots, is everything between the subject and the flag.
//
// T122: it records every call, in memory only, and fails one when told. It writes nothing anywhere.
import { StandIn } from '../stand-in.js';
import {
  type AuthorizationExchange,
  IdentityTokenError,
  type IdentityTokenRequest,
  type ProviderGrant,
  type ProviderIdentity,
  type SignInPort,
  type SignInProvider,
  isSignInProvider,
} from './sign-in.port.js';

const PREFIX = 'fake';
const NO_EMAIL = '-';
const VERIFIED = 'verified';
const UNVERIFIED = 'unverified';
/** prefix, provider, subject, email, flag, nonce. */
const LEAST_SEGMENTS = 6;

export interface FakeIdentity {
  readonly provider: SignInProvider;
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly nonce: string;
}

/** The fake token for an identity, as a device in development or a test builds it. */
export function fakeIdentityToken({
  provider,
  subject,
  email,
  emailVerified,
  nonce,
}: FakeIdentity): string {
  return [
    PREFIX,
    provider,
    subject,
    email ?? NO_EMAIL,
    emailVerified ? VERIFIED : UNVERIFIED,
    nonce,
  ].join('.');
}

function parse({ provider, token, nonce }: IdentityTokenRequest): ProviderIdentity {
  const segments = token.split('.');
  if (segments.length < LEAST_SEGMENTS || segments[0] !== PREFIX) {
    throw new IdentityTokenError('shape');
  }
  const issuer = segments[1] ?? '';
  const subject = segments[2] ?? '';
  const flag = segments[segments.length - 2];
  const tokenNonce = segments[segments.length - 1];
  const email = segments.slice(3, -2).join('.');
  if (subject === '' || (flag !== VERIFIED && flag !== UNVERIFIED) || email === '') {
    throw new IdentityTokenError('shape');
  }
  if (!isSignInProvider(issuer) || issuer !== provider) throw new IdentityTokenError('issuer');
  if (tokenNonce !== nonce) throw new IdentityTokenError('nonce');
  return {
    provider,
    subject,
    email: email === NO_EMAIL ? null : email,
    emailVerified: flag === VERIFIED && email !== NO_EMAIL,
    displayName: null,
  };
}

export class FakeSignInAdapter extends StandIn<SignInPort> implements SignInPort {
  verifyIdentityToken(request: IdentityTokenRequest): Promise<ProviderIdentity> {
    const failure = this.attempt('verifyIdentityToken', [request]);
    if (failure !== undefined) return Promise.reject(failure);
    try {
      return Promise.resolve(parse(request));
    } catch (error: unknown) {
      return Promise.reject(error as Error);
    }
  }

  exchangeAuthorization(
    exchange: AuthorizationExchange,
  ): Promise<{ readonly refreshToken: string }> {
    const failure = this.attempt('exchangeAuthorization', [exchange]);
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve({ refreshToken: `fake-refresh.${exchange.provider}.${exchange.code}` });
  }

  revoke(grant: ProviderGrant): Promise<void> {
    const failure = this.attempt('revoke', [grant]);
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve();
  }
}
