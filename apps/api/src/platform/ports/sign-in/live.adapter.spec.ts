// 002:T148 (B50, the note under T148, (2) and (3); research R-103; contracts/ports.md "Live
// adapter"): the live sign-in adapter verifies Google's identity token with `node:crypto` against
// Google's published key set, and no JWT library: RS256 only, a `kid` the set holds, the issuer,
// the audience (GOOGLE_CLIENT_IDS), the expiry and the issue time within a small skew, the nonce the
// server minted, and `email_verified`. Apple waits for iOS (Q-T4 (a)): under `live` its token, its
// exchange and its revocation are refused as the port's error, with a log line of a reason.
//
// No spec reaches the network: each hands the adapter a fake fetch serving a key set made from a key
// pair the spec generates, signs its tokens with that pair, and sets the clock the adapter reads.
import { generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from 'node:crypto';
import { addSeconds, unixSeconds } from '@ijazah/time';
import { describe, expect, it, vi } from 'vitest';

import {
  GOOGLE_ISSUERS,
  GOOGLE_KEY_SET_URL,
  KEY_SET_REFETCH_INTERVAL_SECONDS,
  LiveSignInAdapter,
  TOKEN_CLOCK_SKEW_SECONDS,
} from './live.adapter.js';
import { IdentityTokenError, type IdentityTokenProblem } from './sign-in.port.js';

type Fetch = typeof fetch;

const NOW = new Date('2026-12-01T10:00:00Z');
const NOW_SECONDS = unixSeconds(NOW);
const CLIENT_ID = 'web-placeholder-7731.apps.googleusercontent.com';
const NONCE = 'n_4c1f0e9a7b3d2e85';
const EMAIL = 'amr.k@example.invalid';
const SUBJECT = '110248495921238986420';
const KID = 'kid-placeholder-1';
const MAX_AGE_SECONDS = 21_600;

function pair(): { readonly privateKey: KeyObject; readonly jwk: JsonWebKey } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

const google = pair();
const other = pair();

function keySetOf(...entries: readonly (readonly [string, JsonWebKey])[]): object {
  return { keys: entries.map(([kid, jwk]) => ({ ...jwk, kid, alg: 'RS256', use: 'sig' })) };
}

const publishedKeys = keySetOf([KID, google.jwk]);

function part(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

interface TokenParts {
  readonly header?: Record<string, unknown>;
  readonly claims?: Record<string, unknown>;
  readonly key?: KeyObject;
}

function token({ header = {}, claims = {}, key = google.privateKey }: TokenParts = {}): string {
  const signed = `${part({ alg: 'RS256', kid: KID, typ: 'JWT', ...header })}.${part({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: SUBJECT,
    email: EMAIL,
    email_verified: true,
    name: 'Amr K',
    nonce: NONCE,
    iat: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 3_590,
    ...claims,
  })}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), key).toString('base64url')}`;
}

/** A fake fetch answering each call with the next key set, the last one repeated. */
function keyServer(
  sets: readonly object[] = [publishedKeys],
  headers: Record<string, string> = { 'cache-control': `public, max-age=${MAX_AGE_SECONDS}` },
) {
  let served = 0;
  return vi.fn<Fetch>(() => {
    const body = sets[Math.min(served, sets.length - 1)];
    served += 1;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers }));
  });
}

function adapterWith(fetch: Fetch, options: { readonly timeoutMs?: number } = {}) {
  const clock = { now: NOW };
  const log = { warn: vi.fn<(fields: object, message: string) => void>() };
  const adapter = new LiveSignInAdapter({
    googleClientIds: ['another-placeholder.apps.googleusercontent.com', CLIENT_ID],
    fetch,
    now: () => clock.now,
    log,
    ...options,
  });
  return { adapter, clock, log };
}

async function refusalOf(attempt: Promise<unknown>): Promise<IdentityTokenError> {
  try {
    await attempt;
  } catch (error: unknown) {
    if (error instanceof IdentityTokenError) return error;
    throw error;
  }
  throw new Error('the token was accepted');
}

function verify(adapter: LiveSignInAdapter, text: string, nonce = NONCE) {
  return adapter.verifyIdentityToken({ provider: 'google', token: text, nonce });
}

async function reasonOf(text: string, nonce = NONCE): Promise<IdentityTokenProblem> {
  const { adapter } = adapterWith(keyServer());
  return (await refusalOf(verify(adapter, text, nonce))).reason;
}

/** Nothing a log line carries may be a token, a nonce, an email or a client id (R-SEC-2). */
function expectNothingSecretIn(log: { warn: { mock: { calls: unknown[] } } }, text: string): void {
  const written = JSON.stringify(log.warn.mock.calls);
  for (const secret of [text, NONCE, EMAIL, CLIENT_ID, SUBJECT]) {
    expect(written).not.toContain(secret);
  }
}

describe('the live sign-in adapter: Google (002:T148, R-103)', () => {
  it("accepts a token signed by Google's published key, under either issuer, and returns the identity", async () => {
    for (const iss of GOOGLE_ISSUERS) {
      const fetch = keyServer();
      const { adapter } = adapterWith(fetch);

      await expect(verify(adapter, token({ claims: { iss } }))).resolves.toEqual({
        provider: 'google',
        subject: SUBJECT,
        email: EMAIL,
        emailVerified: true,
        displayName: 'Amr K',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(GOOGLE_KEY_SET_URL);
      expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(GOOGLE_ISSUERS).toEqual(['accounts.google.com', 'https://accounts.google.com']);
  });

  it('reports an unverified or unmarked email as unverified, and no email as none (FR-121)', async () => {
    const { adapter } = adapterWith(keyServer());

    await expect(
      verify(adapter, token({ claims: { email_verified: false } })),
    ).resolves.toMatchObject({ email: EMAIL, emailVerified: false });
    await expect(
      verify(adapter, token({ claims: { email_verified: 'true' } })),
    ).resolves.toMatchObject({ email: EMAIL, emailVerified: false });
    await expect(
      verify(adapter, token({ claims: { email: undefined, name: undefined } })),
    ).resolves.toMatchObject({ email: null, emailVerified: false, displayName: null });
  });

  it('refuses a token whose signature is not the published key’s, or whose claims were altered (B1-1)', async () => {
    expect(await reasonOf(token({ key: other.privateKey }))).toBe('signature');

    const [header, , signature] = token().split('.');
    const altered = `${header}.${part({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'someone-else', nonce: NONCE, iat: NOW_SECONDS, exp: NOW_SECONDS + 60 })}.${signature}`;
    expect(await reasonOf(altered)).toBe('signature');
  });

  it('refuses a token for an audience not in GOOGLE_CLIENT_IDS (B1-2)', async () => {
    expect(await reasonOf(token({ claims: { aud: 'stranger.apps.googleusercontent.com' } }))).toBe(
      'audience',
    );
  });

  it('refuses a token from another issuer (B1-3)', async () => {
    for (const iss of [
      'https://appleid.apple.com',
      'https://accounts.google.com.evil.example',
      '',
    ]) {
      expect(await reasonOf(token({ claims: { iss } }))).toBe('issuer');
    }
  });

  it('refuses an expired token once the skew has passed, and takes one inside it (B1-4)', async () => {
    expect(await reasonOf(token({ claims: { exp: NOW_SECONDS - TOKEN_CLOCK_SKEW_SECONDS } }))).toBe(
      'expiry',
    );

    const { adapter } = adapterWith(keyServer());
    await expect(
      verify(adapter, token({ claims: { exp: NOW_SECONDS - TOKEN_CLOCK_SKEW_SECONDS + 1 } })),
    ).resolves.toMatchObject({ subject: SUBJECT });
  });

  it('refuses a token issued in the future past the skew, and takes one inside it (B1-12)', async () => {
    expect(
      await reasonOf(token({ claims: { iat: NOW_SECONDS + TOKEN_CLOCK_SKEW_SECONDS + 1 } })),
    ).toBe('expiry');

    const { adapter } = adapterWith(keyServer());
    await expect(
      verify(adapter, token({ claims: { iat: NOW_SECONDS + TOKEN_CLOCK_SKEW_SECONDS } })),
    ).resolves.toMatchObject({ subject: SUBJECT });
  });

  it("refuses a token whose nonce is not the server's, or that carries none (B1-5)", async () => {
    expect(await reasonOf(token(), 'n_another_nonce_00000')).toBe('nonce');
    expect(await reasonOf(token(), `${NONCE}x`)).toBe('nonce');
    expect(await reasonOf(token({ claims: { nonce: undefined } }))).toBe('nonce');
  });

  it('refuses a header naming another algorithm, even over a valid RS256 signature (B1-6)', async () => {
    for (const alg of ['HS256', 'none', 'RS512', 'ES256']) {
      expect(await reasonOf(token({ header: { alg } }))).toBe('signature');
    }
  });

  it('refuses a kid the key set does not hold, after one refetch, and never tries another key (B1-7)', async () => {
    const fetch = keyServer();
    const { adapter, clock } = adapterWith(fetch);
    await verify(adapter, token());
    clock.now = new Date(addSeconds(NOW, KEY_SET_REFETCH_INTERVAL_SECONDS));

    const unknown = token({ header: { kid: 'kid-placeholder-unknown' } });
    expect((await refusalOf(verify(adapter, unknown))).reason).toBe('signature');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refetches the key set for a new kid at most once per interval, so a rotation is picked up (B1-13)', async () => {
    const rotated = keySetOf([KID, google.jwk], ['kid-placeholder-2', other.jwk]);
    const fetch = keyServer([publishedKeys, rotated]);
    const { adapter, clock } = adapterWith(fetch);
    await verify(adapter, token());

    // Within the interval of the first fetch, a kid the set lacks is refused without a fetch.
    const next = token({ header: { kid: 'kid-placeholder-2' }, key: other.privateKey });
    expect((await refusalOf(verify(adapter, next))).reason).toBe('signature');
    expect(fetch).toHaveBeenCalledTimes(1);

    clock.now = new Date(addSeconds(NOW, KEY_SET_REFETCH_INTERVAL_SECONDS));
    await expect(verify(adapter, next)).resolves.toMatchObject({ subject: SUBJECT });
    expect(fetch).toHaveBeenCalledTimes(2);

    const unknown = token({ header: { kid: 'kid-placeholder-3' } });
    expect((await refusalOf(verify(adapter, unknown))).reason).toBe('signature');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('caches the key set until its max-age, fetching once for concurrent tokens, then fetches again (B1-14)', async () => {
    const fetch = keyServer();
    const { adapter, clock } = adapterWith(fetch);

    await Promise.all([verify(adapter, token()), verify(adapter, token())]);
    clock.now = new Date(addSeconds(NOW, MAX_AGE_SECONDS - 1));
    await verify(adapter, token({ claims: { exp: NOW_SECONDS + MAX_AGE_SECONDS + 60 } }));
    expect(fetch).toHaveBeenCalledTimes(1);

    clock.now = new Date(addSeconds(NOW, MAX_AGE_SECONDS));
    await verify(adapter, token({ claims: { exp: NOW_SECONDS + MAX_AGE_SECONDS + 60 } }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the key set cannot be had: an error, a timeout, a status, an unreadable body; one log line each, naming no secret (B1-8)', async () => {
    const hanging = vi.fn<Fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    );
    const failures: readonly [Fetch, string][] = [
      [vi.fn<Fetch>(() => Promise.reject(new TypeError('fetch failed'))), 'unreachable'],
      [hanging, 'timeout'],
      [vi.fn<Fetch>(() => Promise.resolve(new Response('busy', { status: 503 }))), 'http_503'],
      [vi.fn<Fetch>(() => Promise.resolve(new Response('<html>', { status: 200 }))), 'unreadable'],
      [
        vi.fn<Fetch>(() => Promise.resolve(new Response('{"keys":"none"}', { status: 200 }))),
        'unreadable',
      ],
    ];
    for (const [fetch, cause] of failures) {
      const { adapter, log } = adapterWith(fetch, { timeoutMs: 20 });
      const text = token();

      expect((await refusalOf(verify(adapter, text))).reason).toBe('signature');
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0]?.[0]).toEqual({
        provider: 'google',
        reason: 'signature',
        keySet: cause,
      });
      expectNothingSecretIn(log, text);
    }
  });

  it('refuses a token that is not three base64url parts of JSON with the claims it needs (B1-15)', async () => {
    const [header, claims] = token().split('.');
    for (const text of [
      '',
      'not-a-token',
      `${header}.${claims}`,
      `${header}.${claims}.`,
      `${header}.${claims}.sig.extra`,
      `${header}.!!!.sig`,
      `${part({ alg: 'RS256' })}.${claims}.sig`,
      `${Buffer.from('not json').toString('base64url')}.${claims}.sig`,
      token({ claims: { sub: undefined } }),
      token({ claims: { exp: 'tomorrow' } }),
    ]) {
      expect(await reasonOf(text)).toBe('shape');
    }
  });

  it('logs every refusal once, with the provider and a reason only (R-SEC-2)', async () => {
    const { adapter, log } = adapterWith(keyServer());
    const text = token({ claims: { aud: 'stranger.apps.googleusercontent.com' } });

    await refusalOf(verify(adapter, text));

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[0]).toEqual({ provider: 'google', reason: 'audience' });
    expectNothingSecretIn(log, text);
  });
});

describe('the live sign-in adapter: Apple waits for iOS (002:T148, Q-T4 (a))', () => {
  it('refuses an Apple token as the port’s error, with one log line of a reason, and fetches nothing (B1-9)', async () => {
    const fetch = keyServer();
    const { adapter, log } = adapterWith(fetch);
    // A token Google's own checks would take: only the provider asked refuses it.
    const text = token();

    const refusal = await refusalOf(
      adapter.verifyIdentityToken({ provider: 'apple', token: text, nonce: NONCE }),
    );

    expect(refusal.reason).toBe('issuer');
    expect(fetch).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[0]).toEqual({
      provider: 'apple',
      reason: 'provider_not_live',
      operation: 'verifyIdentityToken',
    });
    expectNothingSecretIn(log, text);
  });

  it('refuses the Apple exchange and revocation the same way, reaching no one', async () => {
    const fetch = keyServer();
    const { adapter, log } = adapterWith(fetch);

    expect(
      (
        await refusalOf(
          adapter.exchangeAuthorization({ provider: 'apple', code: 'code-placeholder' }),
        )
      ).reason,
    ).toBe('issuer');
    expect(
      (await refusalOf(adapter.revoke({ provider: 'apple', refreshToken: 'refresh-placeholder' })))
        .reason,
    ).toBe('issuer');

    expect(fetch).not.toHaveBeenCalled();
    expect(log.warn.mock.calls.map(([fields]) => fields)).toEqual([
      { provider: 'apple', reason: 'provider_not_live', operation: 'exchangeAuthorization' },
      { provider: 'apple', reason: 'provider_not_live', operation: 'revoke' },
    ]);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('placeholder');
  });
});
