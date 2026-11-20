// 002:T148 (B50, the note under T148, (2) and (3); research R-103; contracts/ports.md "Live
// adapter"; ADR 0012 D2): the live sign-in adapter, selected by `SIGN_IN_PROVIDER=live`.
//
// GOOGLE. The identity token is a JWT (the note under T022), verified with `node:crypto` and no JWT
// library (plan.md, "no JWT library"): three base64url parts; a header of `alg: 'RS256'` and a `kid`
// the published key set holds; the signature over the first two parts, with that key imported from
// its JWK; then, in this order, the issuer (`accounts.google.com`, with or without `https://`), the
// audience (one of GOOGLE_CLIENT_IDS), the expiry and the issue time (each within
// `TOKEN_CLOCK_SKEW_SECONDS`, read from the clock the adapter is given), and the nonce the server
// minted, compared in constant time. `email_verified` counts only when it is the boolean `true`, so
// an unverified or unmarked address is reported as unverified (FR-121).
//
// THE KEY SET. Google's published JWK set, fetched with the injected `fetch` under
// `KEY_SET_REQUEST_TIMEOUT_MS` and cached until its `Cache-Control: max-age`; concurrent tokens share
// one fetch. A `kid` the cached set lacks triggers one refetch, at most once per
// `KEY_SET_REFETCH_INTERVAL_SECONDS` (Google rotates its keys; a stream of made-up kids makes no
// stream of requests). A fetch that fails, times out, answers a status or an unreadable body refuses
// the token (fail closed): no token is taken on a key the adapter could not read. The set is the
// process's own, bounded by what Google publishes; nothing about a person is held.
//
// APPLE waits for iOS (Q-T4 (a)). Under `live`, an Apple token, the Apple exchange and the Apple
// revocation are refused as the port's error, with a log line, and reach no one; no Apple identity
// can therefore exist under `live`.
//
// Every refusal is one `IdentityTokenError` (the service answers the one UNAUTHENTICATED, the note
// under T042) and one warn line of the provider and a reason (and, for the key set, what failed):
// never the token, the nonce, the email, the subject or a client id (R-SEC-2).
import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import { unixSeconds } from '@ijazah/time';
import { z } from 'zod';

import {
  type AuthorizationExchange,
  IdentityTokenError,
  type IdentityTokenProblem,
  type IdentityTokenRequest,
  type ProviderGrant,
  type ProviderIdentity,
  type SignInPort,
} from './sign-in.port.js';

/** Google's published signing keys, the `jwks_uri` of its OpenID discovery document. */
export const GOOGLE_KEY_SET_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** The issuers Google's ID tokens carry (Google's "Verify the integrity of the ID token"). */
export const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'] as const;

/**
 * How long a fetch of Google's key set waits before it is aborted. A transport number of the kernel,
 * not a setting (R-MONEY-12's exception, as `PUSH_REQUEST_TIMEOUT_MS`): a person's sign-in waits on
 * it, and a timed-out fetch refuses the token, so a longer wait only holds the request longer.
 */
export const KEY_SET_REQUEST_TIMEOUT_MS = 5_000;

/**
 * How far the server's clock may differ from Google's when the expiry and the issue time are read. A
 * protection number of the kernel, not a setting: widening it from the panel would lengthen the life
 * of every token, a stolen one included.
 */
export const TOKEN_CLOCK_SKEW_SECONDS = 60;

/**
 * The least time between two fetches of the key set made for a `kid` the cached set lacks, and the
 * cache's life when Google sends no `max-age`. A protection number of the kernel, not a setting: it
 * bounds the requests a stream of made-up kids can cause, and Google publishes a new key well before
 * it signs with it.
 */
export const KEY_SET_REFETCH_INTERVAL_SECONDS = 60;

const SIGNING_ALGORITHM = 'RS256';
const NODE_SIGNING_ALGORITHM = 'RSA-SHA256';
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_AGE = /(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i;
const TOKEN_PARTS = 3;

/** Where the adapter writes its one warn line per refusal: the process's logger. */
export interface SignInLog {
  warn(fields: object, message: string): void;
}

export interface LiveSignInOptions {
  /** GOOGLE_CLIENT_IDS: the audiences a Google token may name. */
  readonly googleClientIds: readonly string[];
  readonly log?: SignInLog | undefined;
  readonly fetch?: typeof fetch;
  /** The clock the expiry, the issue time and the cache are read against. */
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

/** What kept the key set from being read; written to the log line, never a value of it. */
type KeySetFailure = 'unreachable' | 'timeout' | 'unreadable' | `http_${number}`;

interface KeySet {
  readonly keys: ReadonlyMap<string, KeyObject>;
  /** The second from which the set must be fetched again. */
  readonly freshUntil: number;
}

/** A refusal inside the adapter, logged and turned into the port's error at its edge. */
class Refusal extends Error {
  readonly reason: IdentityTokenProblem;
  readonly keySet: KeySetFailure | undefined;

  constructor(reason: IdentityTokenProblem, keySet?: KeySetFailure) {
    super('refused');
    this.reason = reason;
    this.keySet = keySet;
  }
}

class KeySetError extends Error {
  readonly failure: KeySetFailure;

  constructor(failure: KeySetFailure) {
    super('The key set was not read.');
    this.failure = failure;
  }
}

const header = z.object({ alg: z.string(), kid: z.string().min(1) });

const claims = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().min(1),
  exp: z.int(),
  iat: z.int(),
  nonce: z.string().optional(),
  email: z.string().min(1).optional(),
  email_verified: z.unknown().optional(),
  name: z.string().min(1).optional(),
});

const keySetAnswer = z.object({
  keys: z.array(
    z.object({ kty: z.string(), kid: z.string().min(1), n: z.string(), e: z.string() }),
  ),
});

export class LiveSignInAdapter implements SignInPort {
  readonly #audiences: ReadonlySet<string>;
  readonly #log: SignInLog | undefined;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;
  #keySet: KeySet | undefined;
  #fetching: Promise<KeySet> | undefined;
  #lastFetchAt: number | undefined;

  constructor(options: LiveSignInOptions) {
    this.#audiences = new Set(options.googleClientIds);
    this.#log = options.log;
    // Called as a plain function, never as a method of this adapter.
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? (() => new Date());
    this.#timeoutMs = options.timeoutMs ?? KEY_SET_REQUEST_TIMEOUT_MS;
  }

  async verifyIdentityToken(request: IdentityTokenRequest): Promise<ProviderIdentity> {
    if (request.provider === 'apple') throw this.#appleRefused('verifyIdentityToken');
    try {
      return await this.#verifyGoogle(request.token, request.nonce);
    } catch (error: unknown) {
      if (!(error instanceof Refusal)) throw error;
      this.#log?.warn(
        {
          provider: 'google',
          reason: error.reason,
          ...(error.keySet === undefined ? {} : { keySet: error.keySet }),
        },
        'sign-in: the identity token was refused',
      );
      throw new IdentityTokenError(error.reason);
    }
  }

  exchangeAuthorization(
    _exchange: AuthorizationExchange,
  ): Promise<{ readonly refreshToken: string }> {
    return Promise.reject(this.#appleRefused('exchangeAuthorization'));
  }

  revoke(_grant: ProviderGrant): Promise<void> {
    return Promise.reject(this.#appleRefused('revoke'));
  }

  #appleRefused(operation: keyof SignInPort): IdentityTokenError {
    this.#log?.warn(
      { provider: 'apple', reason: 'provider_not_live', operation },
      'sign-in: Apple is refused under live until iOS',
    );
    return new IdentityTokenError('issuer');
  }

  async #verifyGoogle(token: string, nonce: string): Promise<ProviderIdentity> {
    const parts = token.split('.');
    const [headerPart, claimsPart, signaturePart] = parts;
    if (
      parts.length !== TOKEN_PARTS ||
      headerPart === undefined ||
      claimsPart === undefined ||
      signaturePart === undefined ||
      !parts.every((part) => BASE64URL.test(part))
    ) {
      throw new Refusal('shape');
    }
    const { alg, kid } = parsed(header, headerPart);
    const proven = parsed(claims, claimsPart);
    if (alg !== SIGNING_ALGORITHM) throw new Refusal('signature');

    const key = await this.#keyFor(kid);
    if (!signatureHolds(`${headerPart}.${claimsPart}`, key, signaturePart)) {
      throw new Refusal('signature');
    }

    if (!(GOOGLE_ISSUERS as readonly string[]).includes(proven.iss)) throw new Refusal('issuer');
    if (!this.#audiences.has(proven.aud)) throw new Refusal('audience');
    const now = unixSeconds(this.#now());
    if (now >= proven.exp + TOKEN_CLOCK_SKEW_SECONDS) throw new Refusal('expiry');
    if (proven.iat > now + TOKEN_CLOCK_SKEW_SECONDS) throw new Refusal('expiry');
    if (proven.nonce === undefined || !sameText(proven.nonce, nonce)) throw new Refusal('nonce');

    return {
      provider: 'google',
      subject: proven.sub,
      email: proven.email ?? null,
      emailVerified: proven.email !== undefined && proven.email_verified === true,
      displayName: proven.name ?? null,
    };
  }

  /** The key `kid` names: from the cached set, or after one refetch the interval allows. */
  async #keyFor(kid: string): Promise<KeyObject> {
    try {
      const now = unixSeconds(this.#now());
      const cached = this.#keySet;
      const set = cached === undefined || now >= cached.freshUntil ? await this.#refresh() : cached;
      const key = set.keys.get(kid);
      if (key !== undefined) return key;
      const last = this.#lastFetchAt;
      if (last !== undefined && now < last + KEY_SET_REFETCH_INTERVAL_SECONDS) {
        throw new Refusal('signature');
      }
      const fresh = (await this.#refresh()).keys.get(kid);
      if (fresh === undefined) throw new Refusal('signature');
      return fresh;
    } catch (error: unknown) {
      if (error instanceof KeySetError) throw new Refusal('signature', error.failure);
      throw error;
    }
  }

  /** One fetch at a time: concurrent tokens wait on the same one. */
  #refresh(): Promise<KeySet> {
    this.#fetching ??= this.#fetchKeySet().finally(() => {
      this.#fetching = undefined;
    });
    return this.#fetching;
  }

  async #fetchKeySet(): Promise<KeySet> {
    const startedAt = unixSeconds(this.#now());
    this.#lastFetchAt = startedAt;
    let response: Response;
    try {
      response = await this.#fetch(GOOGLE_KEY_SET_URL, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error: unknown) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      throw new KeySetError(timedOut ? 'timeout' : 'unreachable');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new KeySetError(`http_${response.status}`);
    }
    let answer: z.infer<typeof keySetAnswer>;
    try {
      answer = keySetAnswer.parse(await response.json());
    } catch {
      throw new KeySetError('unreadable');
    }
    const keys = new Map<string, KeyObject>();
    for (const { kty, kid, n, e } of answer.keys) {
      const key = imported({ kty, n, e });
      if (key !== undefined) keys.set(kid, key);
    }
    const set: KeySet = { keys, freshUntil: startedAt + maxAgeOf(response.headers) };
    this.#keySet = set;
    return set;
  }
}

/** A part of the token read as JSON against `schema`; anything else is the token's shape. */
function parsed<T>(schema: z.ZodType<T>, part: string): T {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new Refusal('shape');
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new Refusal('shape');
  return result.data;
}

/** Whether `signature` is the key's RS256 signature of `signed`; a malformed one does not hold. */
function signatureHolds(signed: string, key: KeyObject, signature: string): boolean {
  try {
    return verify(
      NODE_SIGNING_ALGORITHM,
      Buffer.from(signed),
      key,
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

/** An RSA public key from its JWK; a key Node cannot import is left out of the set. */
function imported(jwk: { kty: string; n: string; e: string }): KeyObject | undefined {
  if (jwk.kty !== 'RSA') return undefined;
  try {
    return createPublicKey({ key: jwk, format: 'jwk' });
  } catch {
    return undefined;
  }
}

/** The answer's `max-age` in seconds, or the refetch interval when it names none. */
function maxAgeOf(headers: Headers): number {
  const seconds = MAX_AGE.exec(headers.get('cache-control') ?? '')?.[1];
  return seconds === undefined ? KEY_SET_REFETCH_INTERVAL_SECONDS : Number(seconds);
}

/** Whether two texts are equal, compared in constant time over their digests. */
function sameText(left: string, right: string): boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(left), digest(right));
}
