// T019 — the public-page helper over real HTTP (FR-144, ADR 0021 D5, research R-111;
// public-pages.md "Headers every route sends"): the header set, no cookie, the anonymous limit per
// client address, `?lang=en`, the design's stylesheets, and an error as a page.
//
// The application is built as main.ts builds it (`createApplication`), with the real surfaces
// (empty) and two fixture pages, and listened on an ephemeral port; every case is a real request.
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../../app.module.js';
import { DomainError } from '../errors/domain-error.js';
import { type RateLimitCounter, RateLimiter } from '../guards/rate-limit.guard.js';
import { createLogger } from '../logging/logger.js';
import { SettingError, type SettingsReader } from '../settings/settings-reader.js';
import { html } from './html.js';
import { renderPage } from './page.js';
import { designAssets } from './assets.js';
import {
  PUBLIC_FORM_MAX_BYTES,
  PUBLIC_PAGE_CSP,
  PUBLIC_PAGE_RATE_LIMIT,
  type WebRoute,
} from './route.js';
import {
  unusedAdminServices,
  unusedCatalogServices,
  unusedIdentityServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';

/** A limiter over an in-memory counter, `limit` calls per subject on every key (T170). */
function limiterOf(limit: number): {
  limiter: RateLimiter;
  counter: RateLimitCounter & { keys: string[] };
} {
  const settings: SettingsReader = {
    read: async (key, schema) => {
      if (key !== PUBLIC_PAGE_RATE_LIMIT) throw new SettingError(key, 'missing');
      return schema.parse({ limit, window_seconds: 60 });
    },
  };
  const counts = new Map<string, number>();
  const counter = {
    keys: [] as string[],
    hit: async (key: string) => {
      counter.keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return count;
    },
  };
  return {
    limiter: new RateLimiter({ settings, counter, subjectKey: Buffer.alloc(32, 1) }),
    counter,
  };
}

const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};
const sessions = { user: async () => null, admin: async () => null };

// The services the user surface's context carries (T038): nothing here reads one.
const services = {
  settings: {
    read: async () => {
      throw new Error('no setting is read here');
    },
  },
  publicConfig: { supportEmail: 'support@ijazah.invalid' },
  subjects: { listActive: async () => [] },
  identity: unusedIdentityServices,
  verification: unusedVerificationServices,
  catalog: unusedCatalogServices,
};

const records: string[] = [];
const log = createLogger({ level: 'info', destination: { write: (line) => records.push(line) } });

const terms: WebRoute = {
  handle: ({ lang, query }) => ({
    page: renderPage({
      lang,
      title: lang === 'ar' ? 'الشروط' : 'Terms',
      // A value from the query, written into the page: escaped by the template.
      body: html`<main>
        <h1>${lang === 'ar' ? 'الشروط' : 'Terms'}</h1>
        <p>${query.get('q')}</p>
      </main>`,
    }),
    // A handler that tries to set a cookie through the headers it may add: dropped.
    headers: { 'set-cookie': 'session=abc', 'x-page': 'terms' },
  }),
};

const broken: WebRoute = {
  methods: ['GET', 'POST'],
  handle: ({ method }) => {
    if (method === 'POST') throw new DomainError('NOT_FOUND');
    throw new Error('the template engine caught fire');
  },
};

// T083: a page that writes back what its form carried, each field escaped by the template.
const form: WebRoute = {
  methods: ['GET', 'POST'],
  handle: ({ lang, method, form: fields }) => ({
    page: renderPage({
      lang,
      title: 'Form',
      body: html`<main>
        <p id="method">${method}</p>
        <p id="email">${fields.get('email')}</p>
        <p id="code">${fields.getAll('code').join('')}</p>
        <p id="count">${[...fields.keys()].length}</p>
      </main>`,
    }),
  }),
};

const LIMIT = 3;
// The cases that are not about the limit stay below it: each request uses its own address.
let application: INestApplication;
let origin: string;
let counter: RateLimitCounter & { keys: string[] };

beforeAll(async () => {
  const limited = limiterOf(LIMIT);
  counter = limited.counter;
  application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 1024,
    administration,
    rateLimiter: limited.limiter,
    sessions,
    services,
    adminServices: unusedAdminServices,
    trustedProxyHeader: 'X-Forwarded-For',
    // The shorter path is declared first on purpose: the application mounts the longer first.
    webRoutes: { '/terms': terms, '/broken': broken, '/a': terms, '/a/b': broken, '/form': form },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application?.close();
});

/** A request whose client address the trusted proxy header names (the last hop). */
function get(path: string, address = '203.0.113.5', init: RequestInit = {}): Promise<Response> {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: { 'x-forwarded-for': `10.0.0.1, ${address}`, ...(init.headers ?? {}) },
  });
}

describe('the public-page helper (T019, FR-144)', () => {
  it('sends the strict policy, the header set, HTML in UTF-8, no store, and never a cookie', async () => {
    const response = await get('/terms', '203.0.113.21');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-language')).toBe('ar');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-page')).toBe('terms');
  });

  it('renders Arabic right-to-left by default and English by `?lang=en`', async () => {
    const arabic = await (await get('/terms', '203.0.113.22')).text();
    expect(arabic).toContain('<html lang="ar" dir="rtl">');
    expect(arabic).toContain('<h1>الشروط</h1>');

    const english = await get('/terms?lang=en', '203.0.113.23');
    expect(english.headers.get('content-language')).toBe('en');
    expect(await english.text()).toContain('<html lang="en" dir="ltr">');

    // Anything but `en` is Arabic.
    expect(await (await get('/terms?lang=fr', '203.0.113.24')).text()).toContain('lang="ar"');
  });

  it('escapes what a request puts into the page', async () => {
    const page = await (
      await get(`/terms?q=${encodeURIComponent('<script>alert(1)</script>')}`)
    ).text();
    expect(page).not.toContain('<script>alert');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('counts the anonymous limit per client address, by the trusted header’s last hop, and answers 429 as a page', async () => {
    const address = '198.51.100.77';
    for (let call = 0; call < LIMIT; call += 1) {
      expect((await get('/terms', address)).status).toBe(200);
    }
    const refused = await get('/terms', address);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
    expect(refused.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await refused.text()).toContain('429');
    // Another last hop is another subject, whatever the first hop says.
    expect((await get('/terms', '198.51.100.78')).status).toBe(200);
    expect(
      (
        await fetch(`${origin}/terms`, {
          headers: { 'x-forwarded-for': `${address}, 198.51.100.79` },
        })
      ).status,
    ).toBe(200);
    expect(
      counter.keys.every((key) => key.startsWith(`rate-limit:${PUBLIC_PAGE_RATE_LIMIT}:`)),
    ).toBe(true);
    expect(counter.keys.some((key) => key.includes(address))).toBe(false);
  });

  it('answers a method the page does not take with 405, a deeper path with 404, both as pages', async () => {
    const post = await get('/terms', '203.0.113.6', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
    expect(post.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect((await get('/terms/deeper', '203.0.113.6')).status).toBe(404);
  });

  it('answers HEAD as GET without a body, with the same headers', async () => {
    const head = await get('/terms', '203.0.113.40', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
    expect(head.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await head.text()).toBe('');
  });

  it('a page under another page’s path reaches its own handler, whatever the declaration order', async () => {
    // `/a/b` is the broken fixture (GET throws unexpectedly → 500), `/a` the terms page.
    expect((await get('/a/b', '203.0.113.41')).status).toBe(500);
    expect((await get('/a', '203.0.113.42')).status).toBe(200);
    expect((await get('/a/c', '203.0.113.43')).status).toBe(404);
  });

  it('answers a handler’s error as a page with the kernel’s status, and says nothing of an unexpected one', async () => {
    const expected = await get('/broken', '203.0.113.8', { method: 'POST' });
    expect(expected.status).toBe(404);
    expect(await expected.text()).toContain('lang="ar"');

    const before = records.length;
    const unexpected = await get('/broken?lang=en', '203.0.113.9');
    expect(unexpected.status).toBe(500);
    const page = await unexpected.text();
    expect(page).toContain('The page could not be shown');
    expect(page).not.toContain('caught fire');
    expect(page).not.toContain('Error');
    const line = records.slice(before).find((record) => record.includes('caught fire'));
    expect(line).toBeDefined();
    expect(line).toContain('"correlationId"');
    // The client's address reaches the record as its network only (R-SEC-2).
    expect(line).toContain('"clientAddress":"203.0.113.0/24"');
    expect(line).not.toContain('203.0.113.9');
  });
});

describe('the design’s stylesheets (T019, public-pages.md)', () => {
  it('serves the two stylesheets by their hashed names, immutable for a year, as CSS', async () => {
    for (const asset of designAssets()) {
      expect(asset.hashedName).toMatch(/^(tokens|components)\.[0-9a-f]{16}\.css$/);
      const response = await fetch(`${origin}/public/design/${asset.hashedName}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(response.headers.get('etag')).toBe(`"${asset.hash}"`);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(await response.text()).toBe(asset.body);
    }
    // The page links exactly those names.
    const page = await (await get('/terms', '203.0.113.50')).text();
    for (const asset of designAssets())
      expect(page).toContain(`/public/design/${asset.hashedName}`);
  });

  it('answers the bare name revalidated every time, never immutable: no-cache, an ETag, 304 when it matches', async () => {
    const [tokens] = designAssets();
    if (tokens === undefined) throw new Error('no assets');
    const first = await fetch(`${origin}/public/design/tokens.css`);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-cache');
    expect(first.headers.get('etag')).toBe(`"${tokens.hash}"`);
    expect(await first.text()).toBe(tokens.body);
    const again = await fetch(`${origin}/public/design/tokens.css`, {
      headers: { 'if-none-match': `"${tokens.hash}"` },
    });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    // A stale hash in the name is not a file: the old build's link is gone, not served.
    expect((await fetch(`${origin}/public/design/tokens.0000000000000000.css`)).status).toBe(404);
  });

  it('serves nothing else there', async () => {
    expect((await fetch(`${origin}/public/design/other.css`)).status).toBe(404);
    expect((await fetch(`${origin}/public/design/../../main.js`)).status).toBe(404);
    const post = await fetch(`${origin}/public/design/tokens.css`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('the form body of a page (T083, public-pages.md)', () => {
  const urlencoded = { 'content-type': 'application/x-www-form-urlencoded' };

  function post(
    body: NonNullable<RequestInit['body']>,
    address: string,
    headers: Record<string, string> = urlencoded,
  ) {
    return get('/form', address, { method: 'POST', body, headers });
  }

  it('hands the handler the URL-encoded fields of a POST, decoded and escaped where written', async () => {
    const response = await post(
      'email=a%2Bb%40example.com&code=1&code=2&code=3&note=x+y%3Cb%3E',
      '203.0.113.60',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
    expect(response.headers.get('set-cookie')).toBeNull();
    const page = await response.text();
    expect(page).toContain('<p id="method">POST</p>');
    expect(page).toContain('<p id="email">a+b@example.com</p>');
    expect(page).toContain('<p id="code">123</p>');
    expect(page).toContain('<p id="count">5</p>');
  });

  it('reads the charset parameter of the type, and nothing of a GET', async () => {
    const withCharset = await post('email=x%40example.com', '203.0.113.61', {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    });
    expect(await withCharset.text()).toContain('<p id="email">x@example.com</p>');
    const query = await get('/form?email=q%40example.com', '203.0.113.62');
    const page = await query.text();
    expect(page).toContain('<p id="method">GET</p>');
    // The query is never read as the form: a field travels in the body or not at all.
    expect(page).toContain('<p id="count">0</p>');
  });

  it('refuses a body over the limit with 413 as a page, whether declared or streamed', async () => {
    const over = `email=${'a'.repeat(PUBLIC_FORM_MAX_BYTES)}`;
    const declared = await post(over, '203.0.113.63');
    expect(declared.status).toBe(413);
    expect(declared.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(declared.headers.get('content-security-policy')).toBe(PUBLIC_PAGE_CSP);
    expect(declared.headers.get('set-cookie')).toBeNull();
    expect(await declared.text()).toContain('413');

    // Chunked, with no length declared: refused as it streams past the limit.
    const chunks = [
      over.slice(0, PUBLIC_FORM_MAX_BYTES / 2),
      over.slice(PUBLIC_FORM_MAX_BYTES / 2),
    ];
    const body = new ReadableStream({
      pull(controller) {
        const next = chunks.shift();
        if (next === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(next));
      },
    });
    // Node's fetch streams a body only when told it is half-duplex.
    const init = { method: 'POST', body, headers: urlencoded, duplex: 'half' } as RequestInit;
    const streamed = await get('/form', '203.0.113.64', init);
    expect(streamed.status).toBe(413);

    // At the limit exactly is read.
    const atLimit = `email=${'a'.repeat(PUBLIC_FORM_MAX_BYTES - 'email='.length)}`;
    expect((await post(atLimit, '203.0.113.65')).status).toBe(200);
  });

  it('refuses a body that is not URL-encoded (multipart, JSON, plain text) with 400 as a page', async () => {
    const multipart = new FormData();
    multipart.set('email', 'x@example.com');
    const refused = await get('/form', '203.0.113.66', { method: 'POST', body: multipart });
    expect(refused.status).toBe(400);
    expect(refused.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(
      (
        await post('{"email":"x@example.com"}', '203.0.113.67', {
          'content-type': 'application/json',
        })
      ).status,
    ).toBe(400);
    // A string body with no type named is sent as plain text.
    expect((await post('email=x', '203.0.113.68', {})).status).toBe(400);
  });

  it('refuses a body that is not UTF-8 with 400', async () => {
    const invalid = new Uint8Array([0x65, 0x6d, 0x61, 0x69, 0x6c, 0x3d, 0xff, 0xfe]);
    expect((await post(invalid, '203.0.113.69')).status).toBe(400);
  });
});
