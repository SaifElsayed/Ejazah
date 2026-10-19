// T022: the sign-in port (specs/002-identity/contracts/ports.md "SignInPort", research R-103,
// R-API-5). The only way a provider identity becomes known. Named for what the product does,
// never for a provider's SDK or token format.
//
// What the interface carries (ports.md "Constraints"): the verify operation takes the nonce the
// server minted (`auth.providerNonce`), and the service consumes its single-use mark before
// calling here, so a captured token and nonce replay nothing; the identity returns `emailVerified`
// apart from the email, so a caller cannot read an unverified address as one (FR-121); nothing a
// provider issued is returned except, from the exchange operation, the refresh token the revoke
// operation needs (stored encrypted, ADR 0015 D3).

/** The providers a person may sign in with (ADR 0012 D2). */
export type SignInProvider = 'google' | 'apple';

export interface IdentityTokenRequest {
  readonly provider: SignInProvider;
  /** The identity token the device received from the provider. */
  readonly token: string;
  /** The nonce the server minted for this sign-in, already consumed by the service. */
  readonly nonce: string;
}

/** The identity a verified token proves. */
export interface ProviderIdentity {
  readonly provider: SignInProvider;
  /** The provider's stable identifier of the person. */
  readonly subject: string;
  /** The address the provider reported, when it reported one; trusted only when `emailVerified`. */
  readonly email: string | null;
  /** Whether the provider marks the address as verified (FR-121). */
  readonly emailVerified: boolean;
  /** A display name the provider offered, when it offered one. */
  readonly displayName: string | null;
}

/** An authorization to exchange for the provider's refresh token (Apple, TN3194). */
export interface AuthorizationExchange {
  readonly provider: 'apple';
  readonly code: string;
}

/** A grant to revoke at account deletion (ADR 0015 D3). */
export interface ProviderGrant {
  readonly provider: 'apple';
  readonly refreshToken: string;
}

export interface SignInPort {
  /** The identity a token proves; throws `IdentityTokenError` for a token it does not accept. */
  verifyIdentityToken(request: IdentityTokenRequest): Promise<ProviderIdentity>;
  /** The provider's refresh token for an authorization, kept so the grant can be revoked later. */
  exchangeAuthorization(
    exchange: AuthorizationExchange,
  ): Promise<{ readonly refreshToken: string }>;
  /** Revokes the grant, so the provider no longer links the person to this platform. */
  revoke(grant: ProviderGrant): Promise<void>;
}

/** Why a token was refused: what an operator may read; never the token or the nonce. */
export type IdentityTokenProblem =
  'shape' | 'signature' | 'issuer' | 'audience' | 'expiry' | 'nonce';

/** The refusal of an identity token. Its message names no value of the token (R-SEC-2). */
export class IdentityTokenError extends Error {
  readonly reason: IdentityTokenProblem;

  constructor(reason: IdentityTokenProblem) {
    super('The identity token was not accepted.');
    this.name = 'IdentityTokenError';
    this.reason = reason;
  }
}

/** Whether `value` names a provider this port knows. */
export function isSignInProvider(value: string): value is SignInProvider {
  return value === 'google' || value === 'apple';
}
