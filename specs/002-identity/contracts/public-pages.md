# Contract: Routes the API serves to a browser

Beside the two tRPC surfaces, the API serves the routes below under their own
paths, never mixed with the procedure routes (ADR 0021 D5). Every one runs
behind the security-headers middleware and the kernel's web helper (research
R-111): a strict `Content-Security-Policy`, the full header set, the CORS
allowlist, no `Set-Cookie`, templates that escape every value, and the
anonymous rate limit `rate_limit_public_page` per client address. English by
`?lang=en`; the default is Arabic, `dir="rtl"`.

## The pages

| Route                                                                      | Method                 | Renders                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/terms`                                                                   | GET                    | The Terms body with its version and effective date                                | The body is a pre-rendered HTML fragment per language under `apps/api/src/platform/web/terms/` (`ar.html`, `en.html`), server-built files inserted with `raw()`, so no Markdown dependency; the version shown is the `terms_version` setting; the app's Terms modal is a WebView of this route (FR-127). `?theme=dark` or `?theme=light` writes `data-theme` on `<html>`, so the page draws in that scheme of the design's `tokens.css` on its own background (`.web-surface`); any other value is ignored and never written, and without one the page is light. The WebView passes the app's scheme (T105) |
| `/delete-account`                                                          | GET                    | `DeleteAccountWeb`: the intro, the two-step timeline, the email field             | FR-143                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/delete-account`                                                          | POST `{ email }`       | `DeleteAccountWebCode`: the code step, with the email as a hidden field           | Always the same page, the same work and the same timing: an unknown address runs the decoy hash; a known one gets a code (purpose `account_deletion`) dispatched after commit without being awaited (R-104); under `rate_limit_one_time_code` by address and `rate_limit_public_page` by client address                                                                                                                                                                                                                                                                                                     |
| `/delete-account/confirm`                                                  | POST `{ email, code }` | `DeleteAccountWebDone` on success; the code step with the generic error otherwise | Runs the same deletion as `account.delete` (FR-141); the email and code travel in the form body, never the URL; the done page names the address and the support address from configuration (FR-145)                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/public/design/tokens.<hash>.css`, `/public/design/components.<hash>.css` | GET                    | The design's stylesheet                                                           | Static; the name carries the content hash (16 hex characters of SHA-256, computed at start), so the immutable year-long cache can never serve a stale design: a new build is a new name, which the pages link. The bare names `tokens.css` and `components.css` answer too, revalidated on every request (`no-cache`, the hash as ETag, 304 when it matches), never immutable. Copies written by `scripts/build-tokens.ts` under `check:generated` (PR #79 review, the owner's decision 2026-10-19)                                                                                                         |

The certificate verification page (`/verify/:code`) is Phase 4's and uses the
same helper.

## The uploads route

| Route                | Method | Auth                                  | Body                                                    | Answers          |
| -------------------- | ------ | ------------------------------------- | ------------------------------------------------------- | ---------------- |
| `/uploads/documents` | POST   | user bearer (any standing but banned) | multipart, one file, `kind: 'identity' \| 'credential'` | `{ documentId }` |
| `/uploads/photos`    | POST   | user bearer                           | multipart, one image (JPEG or PNG)                      | `{ photoUrl }`   |

The body carries the `kind` field before the file, since the file is read as it streams and nothing after it is read (T024). The kernel's upload middleware decides the type by content (R-SEC-4): `/uploads/documents` admits `application/pdf` only, `/uploads/photos` JPEG and PNG only. The size limit is `upload_max_bytes`; the rate limit `rate_limit_upload` per user. A document is stored through the storage port under a server-minted key, the `verification_documents` row written with the key encrypted (R-DB-8) and the caller as `user_id`, and the answer carries the id only; a link to the file is minted on demand by the procedures that may show it. A photo is the identity module's: its route writes `users.photo_key` through identity's own repository (R-API-6) and answers a signed link.

## Headers every route sends

`Content-Security-Policy: default-src 'none'; style-src 'self'; img-src
'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
`Strict-Transport-Security` outside development, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, and the CORS allowlist of
`ADMIN_ALLOWED_ORIGINS` for the admin SPA's calls (the pages themselves need no
cross-origin call). A test per route asserts the header set and the absence of
`Set-Cookie`.
