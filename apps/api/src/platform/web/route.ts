// T019: the route helper of the public pages, and the design's stylesheets (FR-144, ADR 0021 D5,
// research R-111; specs/002-identity/contracts/public-pages.md "Headers every route sends").
//
// A public page is a Node request handler the HTTP application mounts under its own path, beside
// the two tRPC surfaces and never inside them. The helper is what makes ADR 0021 D5's conditions
// structural rather than a discipline per page:
//
//   - THE HEADERS are set here, over the security-headers middleware already in place (T136):
//     the strict Content-Security-Policy of R-111 (`default-src 'none'; style-src 'self'; img-src
//     'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`) replaces the API's
//     `default-src 'none'; frame-ancestors 'none'`, and the response is `no-store`, HTML in UTF-8,
//     with its language named.
//   - NO COOKIE can leave: `Set-Cookie` is stripped from the response whatever sets it, so the
//     pages cannot start a session by accident, and a browser that reaches them carries nothing
//     to the API (no cookie, so no cross-site request forgery against these routes).
//   - THE RATE LIMIT `rate_limit_public_page` is counted per client address before the handler
//     runs, through the kernel's limiter (T170), the address read as the context reads it (T017):
//     the socket's peer or the trusted proxy header's last hop.
//   - THE LANGUAGE is `ar` unless `?lang=en`; nothing else in the query selects anything here.
//   - A FORM is read from a POST's body only, never from the query, so a field a page takes (an
//     address, a code) never travels in a URL (T083, public-pages.md). The body must be
//     `application/x-www-form-urlencoded` in UTF-8, anything else (multipart, JSON, text) is
//     refused with 400 before a byte is parsed; it is read whole up to `PUBLIC_FORM_MAX_BYTES` and
//     refused with 413 past it, by its declared length before reading or as it streams, and the
//     connection is closed so nothing more of it is read. The fields reach the handler as
//     `URLSearchParams`, after the anonymous limit, so a refused request reads no body.
//   - ESCAPING is the template's (`html.ts`); a handler returns a `SafeHtml` and nothing else
//     reaches the body.
//   - AN ERROR is a page too, in the request's language, with the status of the kernel's one
//     mapping (T101); an unexpected one is logged with the request's correlation identifier and
//     reported (T111), and the page says nothing of it.
//
// THE DESIGN'S STYLESHEETS, `tokens.css` and `components.css`, are served under `/public/design/`
// from the copies `scripts/build-tokens.ts` writes into `web/assets/` (under `check:generated`),
// read once at start (`assets.ts`). A page links the content-hashed name, `tokens.<hash>.css`,
// immutable to the browser for a year: a change to the design is a new build, a new name and a new
// deploy, so no cache ever serves a stale design (PR #79 review; the owner's decision). The bare
// name answers a hand-written link too, revalidated on every request (`no-cache` with the hash as
// its ETag, 304 when it matches). They are the only static files the API serves.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientAddressOf } from '../http/client-address.js';
import type { Locale } from '../http/locale.js';
import { DomainError } from '../errors/domain-error.js';
import { mapError } from '../errors/error-filter.js';
import { reportError } from '../errors/reporting.js';
import type { RateLimiter, RateLimitKey } from '../guards/rate-limit.guard.js';
import { type Logger, requestLogger } from '../logging/logger.js';
import { html, type SafeHtml } from './html.js';
import { DESIGN_ASSETS_PATH, designAssets, findDesignAsset } from './assets.js';
import { renderPage } from './page.js';

/** The settings key of the anonymous limit every public page counts (contracts/README.md). */
export const PUBLIC_PAGE_RATE_LIMIT = 'rate_limit_public_page' satisfies RateLimitKey;

/** The policy every public page sends (research R-111). */
export const PUBLIC_PAGE_CSP =
  "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/**
 * The largest form body a page reads: an address of at most 254 characters and a six-digit code,
 * each URL-encoded (three bytes a character at worst), with room to spare and nothing near a
 * file. A page that needs more is a different kind of route.
 */
export const PUBLIC_FORM_MAX_BYTES = 4_096;

/** The one body type a page reads. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

/** The methods a public page may declare; `GET` unless the route says otherwise. */
export type WebMethod = 'GET' | 'POST';

/** What a page handler reads of the request: nothing it could mistake for the server's word. */
export interface WebRequest {
  readonly method: WebMethod;
  readonly lang: Locale;
  readonly clientAddress: string;
  readonly query: URLSearchParams;
  /** A POST's URL-encoded fields; empty on a GET. Never read from the query. */
  readonly form: URLSearchParams;
  readonly correlationId: string;
  readonly log: Logger;
}

/** What a page handler answers: a page, and optionally a status and headers of its own. */
export interface WebResponse {
  readonly status?: number;
  readonly page: SafeHtml;
  /** Extra headers; `Set-Cookie` among them is dropped, as everywhere on these routes. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface WebRoute {
  /** The methods answered; any other is refused with 405. `['GET']` when absent. */
  readonly methods?: readonly WebMethod[];
  readonly handle: (request: WebRequest) => Promise<WebResponse> | WebResponse;
}

export interface WebRouteDependencies {
  readonly rateLimiter: RateLimiter;
  readonly log: Logger;
  /** `TRUSTED_PROXY`, when set (T017). */
  readonly trustedProxyHeader?: string;
}

/** A Node request handler, as the HTTP application mounts one. */
export type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;

const COOKIE_HEADER = 'set-cookie';

/** `response` with `Set-Cookie` stripped whatever sets it, before anything is sent. */
function withoutCookies(response: ServerResponse): ServerResponse {
  const setHeader = response.setHeader.bind(response);
  response.setHeader = (name, value) =>
    name.toLowerCase() === COOKIE_HEADER ? response : setHeader(name, value);
  const appendHeader = response.appendHeader.bind(response);
  response.appendHeader = (name, value) =>
    name.toLowerCase() === COOKIE_HEADER ? response : appendHeader(name, value);
  const writeHead = response.writeHead.bind(response);
  response.writeHead = ((status: number, ...rest: unknown[]) => {
    response.removeHeader(COOKIE_HEADER);
    return (writeHead as (status: number, ...rest: unknown[]) => ServerResponse)(status, ...rest);
  }) as ServerResponse['writeHead'];
  return response;
}

/** The language a request asks for: English by `?lang=en`, Arabic otherwise. */
export function languageOf(query: URLSearchParams): Locale {
  return query.get('lang') === 'en' ? 'en' : 'ar';
}

const errorTexts: Readonly<Record<Locale, { title: string; body: string }>> = {
  ar: { title: 'تعذّر عرض الصفحة', body: 'حاول مرة أخرى بعد قليل.' },
  en: { title: 'The page could not be shown', body: 'Try again in a moment.' },
};

/** The page an error is answered with: the status's own words, nothing of the cause. */
export function errorPage(lang: Locale, status: number): SafeHtml {
  const text = errorTexts[lang];
  return renderPage({
    lang,
    title: text.title,
    body: html`<main class="page">
      <h1>${text.title}</h1>
      <p>${text.body}</p>
      <p class="muted">${status}</p>
    </main>`,
  });
}

function sendPage(
  response: ServerResponse,
  lang: Locale,
  status: number,
  page: SafeHtml,
  headers: Readonly<Record<string, string>> = {},
  headOnly = false,
): void {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.setHeader('content-security-policy', PUBLIC_PAGE_CSP);
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader('content-language', lang);
  response.setHeader('cache-control', 'no-store');
  response.statusCode = status;
  response.end(headOnly ? undefined : page.toString());
}

/** Whether the request's body is declared URL-encoded; its `charset`, when named, must be UTF-8. */
function isUrlEncoded(request: IncomingMessage): boolean {
  const [type = '', ...parameters] = (request.headers['content-type'] ?? '').split(';');
  if (type.trim().toLowerCase() !== FORM_CONTENT_TYPE) return false;
  return parameters.every((parameter) => {
    const [name = '', value = ''] = parameter.split('=');
    return name.trim().toLowerCase() !== 'charset' || value.trim().toLowerCase() === 'utf-8';
  });
}

/** The body is refused: the response closes the connection, so the rest of it is never read. */
function tooLarge(response: ServerResponse): DomainError {
  response.setHeader('connection', 'close');
  return new DomainError('PAYLOAD_TOO_LARGE');
}

/**
 * A POST's form, read whole up to the limit and parsed; refused when it is not one or too large. A
 * POST with no body at all (no length, or zero, and no transfer coding) carries an empty form.
 */
async function readForm(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<URLSearchParams> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (declared === 0 && request.headers['transfer-encoding'] === undefined) {
    return new URLSearchParams();
  }
  if (!isUrlEncoded(request)) throw new DomainError('VALIDATION_FAILED');
  if (declared > PUBLIC_FORM_MAX_BYTES) throw tooLarge(response);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > PUBLIC_FORM_MAX_BYTES) throw tooLarge(response);
    chunks.push(chunk);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch (error: unknown) {
    throw new DomainError('VALIDATION_FAILED', undefined, { cause: error });
  }
  return new URLSearchParams(text);
}

/** The path of a mounted route: what follows the mount, without its query. */
function pathOf(request: IncomingMessage): { path: string; query: URLSearchParams } {
  const url = new URL(request.url ?? '/', 'http://local');
  return { path: url.pathname, query: url.searchParams };
}

/**
 * The handler for one public page. Mounted under the page's path by the HTTP application, so the
 * remainder it sees is `/` for the page itself; anything deeper is not a page.
 */
export function webRoute(
  { rateLimiter, log, trustedProxyHeader }: WebRouteDependencies,
  route: WebRoute,
): NodeHandler {
  const methods: readonly WebMethod[] = route.methods ?? ['GET'];
  return (incoming, outgoing) => {
    const response = withoutCookies(outgoing);
    const { path, query } = pathOf(incoming);
    const lang = languageOf(query);
    const correlationId = randomUUID();
    const clientAddress = clientAddressOf(
      { remoteAddress: incoming.socket.remoteAddress, headers: incoming.headers },
      trustedProxyHeader,
    );
    const requestLog = requestLogger(log, correlationId).child({ clientAddress });
    void (async () => {
      try {
        if (path !== '/' && path !== '') {
          sendPage(response, lang, 404, errorPage(lang, 404));
          return;
        }
        // HEAD is GET without the body (PR #79 review): monitors and link checkers get 200.
        const headOnly = incoming.method === 'HEAD';
        const method = headOnly ? 'GET' : (incoming.method ?? 'GET');
        if (!(methods as readonly string[]).includes(method)) {
          sendPage(response, lang, 405, errorPage(lang, 405), { allow: allowOf(methods) });
          return;
        }
        // The page's fixed name in a refusal's record is the path it is mounted under (T062):
        // Express's `baseUrl`, set by `application.use(path, …)` and never by the client.
        await rateLimiter.check(
          PUBLIC_PAGE_RATE_LIMIT,
          { kind: 'identifier', value: clientAddress },
          `page:${(incoming as { readonly baseUrl?: string }).baseUrl ?? ''}`,
        );
        const form = method === 'POST' ? await readForm(incoming, response) : new URLSearchParams();
        const answer = await route.handle({
          method: method as WebMethod,
          lang,
          clientAddress,
          query,
          form,
          correlationId,
          log: requestLog,
        });
        sendPage(response, lang, answer.status ?? 200, answer.page, answer.headers, headOnly);
      } catch (error: unknown) {
        const mapped = mapError(error);
        if (mapped.unexpected) {
          requestLog.error({ err: error }, 'Unexpected error on a public page');
          reportError(error, correlationId);
        }
        sendPage(response, lang, mapped.status, errorPage(lang, mapped.status));
      }
    })();
  };
}

/** The `Allow` header of a page: its methods, and HEAD beside GET. */
function allowOf(methods: readonly WebMethod[]): string {
  return methods.flatMap((method) => (method === 'GET' ? ['GET', 'HEAD'] : [method])).join(', ');
}

/** The route helper's refusal of what it cannot answer, for a handler that must refuse itself. */
export function notFound(): never {
  throw new DomainError('NOT_FOUND');
}

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * `GET /public/design/<file>` for the two stylesheets: the hashed name immutable for a year, the
 * bare name revalidated every time. Mounted by the HTTP application under `DESIGN_ASSETS_PATH`.
 */
export function designAssetsRoute(): NodeHandler {
  // Read at mount time, so a missing copy stops the start rather than the first page (as before).
  designAssets();
  return (incoming, outgoing) => {
    const response = withoutCookies(outgoing);
    const { path, query } = pathOf(incoming);
    const lang = languageOf(query);
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      sendPage(response, lang, 405, errorPage(lang, 405), { allow: 'GET, HEAD' });
      return;
    }
    const found = findDesignAsset(path.replace(/^\//, ''));
    if (found === undefined) {
      sendPage(response, lang, 404, errorPage(lang, 404));
      return;
    }
    const { asset, immutable } = found;
    const etag = `"${asset.hash}"`;
    response.setHeader('content-type', 'text/css; charset=utf-8');
    response.setHeader('etag', etag);
    if (immutable) {
      response.setHeader('cache-control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    } else {
      // The bare name: the browser asks every time and is told "unchanged" while the hash holds.
      response.setHeader('cache-control', 'no-cache');
      if (incoming.headers['if-none-match'] === etag) {
        response.statusCode = 304;
        response.end();
        return;
      }
    }
    response.statusCode = 200;
    response.end(incoming.method === 'HEAD' ? undefined : asset.body);
  };
}

export { DESIGN_ASSETS_PATH };
