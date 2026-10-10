// T136: browser security headers and the CORS origin allowlist (FR-076, NFR-SEC-11, DEC-51; OWASP
// ASVS 5.0 V3; contracts/kernel.md). Set once, here, for every response the HTTP application
// sends: both surfaces, the health routes and any other path, since every one is a route a browser
// can reach. A request without an `Origin` header, which is how the mobile app and a provider's
// webhook call, is answered exactly as before.
//
// THE HEADERS come from helmet (pinned in `apps/api/package.json`), the proven middleware the SRS
// asks for, with its defaults kept and three of them set for an API that serves JSON and no page
// (OWASP REST Security Cheat Sheet, "Security Headers"):
//   - Content-Security-Policy `default-src 'none'; frame-ancestors 'none'`: a response may load
//     nothing and be framed by nobody;
//   - X-Frame-Options `DENY`, the same refusal for a browser that does not read frame-ancestors;
//   - Strict-Transport-Security only outside development, which runs over plain HTTP. helmet's
//     value is kept: one year, subdomains included.
// X-Content-Type-Options `nosniff` is helmet's default. helmet also removes `X-Powered-By`, which
// named the framework on every response (PR #43 review, m6).
//
// CORS answers only the origins of `ADMIN_ALLOWED_ORIGINS`, validated at startup, where a wildcard
// is refused by the schema itself (env.schema.ts). Nest's `enableCors` is the expressjs `cors`
// middleware: an origin on the list is echoed back with `Vary: Origin`; any other gets no
// `Access-Control-Allow-Origin`, so the browser refuses it. Credentials are not allowed: the admin
// panel's authentication is not built yet, and the task that builds it decides.
//
// WHERE THE ADMIN PANEL'S HTML IS SERVED by another host than this API, that host sends the same
// headers, and research R-18 records them as part of the staging decision.
import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

export interface SecurityHeadersOptions {
  /** `ADMIN_ALLOWED_ORIGINS`: the only origins a cross-origin request is answered for. */
  readonly allowedOrigins: readonly string[];
  /** `NODE_ENV`: Strict-Transport-Security is sent in every mode but development. */
  readonly mode: 'development' | 'test' | 'production';
}

/** Registers the headers and the origin allowlist ahead of every route of `application`. */
export function applySecurityHeaders(
  application: INestApplication,
  { allowedOrigins, mode }: SecurityHeadersOptions,
): void {
  application.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      xFrameOptions: { action: 'deny' },
      strictTransportSecurity: mode !== 'development',
    }),
  );
  application.enableCors({ origin: [...allowedOrigins] });
}
