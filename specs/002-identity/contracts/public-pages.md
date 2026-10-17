# Contract: Routes the API serves to a browser

Beside the two tRPC surfaces, the API serves the routes below under their own
paths, never mixed with the procedure routes (ADR 0021 D5). Every one runs
behind the security-headers middleware and the kernel's web helper (research
R-111): a strict `Content-Security-Policy`, the full header set, the CORS
allowlist, no `Set-Cookie`, templates that escape every value, and the
anonymous rate limit `rate_limit_public_page` per client address. English by
`?lang=en`; the default is Arabic, `dir="rtl"`.

## The pages

| Route                                                        | Method                 | Renders                                                                           | Notes                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/terms`                                                     | GET                    | The Terms body with its version and effective date                                | The body is a served Markdown file per language under `apps/api/src/web/terms/`, rendered to HTML through the escaping renderer; the version shown is the `terms_version` setting; the app's Terms modal is a WebView of this route (FR-127) |
| `/delete-account`                                            | GET                    | `DeleteAccountWeb`: the intro, the two-step timeline, the email field             | FR-143                                                                                                                                                                                                                                       |
| `/delete-account`                                            | POST `{ email }`       | `DeleteAccountWebCode`: the code step, with the email as a hidden field           | Always the same page; a code is sent only if the address belongs to an account, through the email port, under `rate_limit_one_time_code` by address                                                                                          |
| `/delete-account/confirm`                                    | POST `{ email, code }` | `DeleteAccountWebDone` on success; the code step with the generic error otherwise | Runs the same deletion as `account.delete` (FR-141); the email and code travel in the form body, never the URL; the done page names the address and the support address from configuration (FR-145)                                          |
| `/public/design/tokens.css`, `/public/design/components.css` | GET                    | The design's stylesheet                                                           | Static, immutable cache headers; copies written by `scripts/build-tokens.ts` under `check:generated`                                                                                                                                         |

The certificate verification page (`/verify/:code`) is Phase 4's and uses the
same helper.

## The uploads route

| Route                | Method | Auth                                  | Body                                                               | Answers          |
| -------------------- | ------ | ------------------------------------- | ------------------------------------------------------------------ | ---------------- |
| `/uploads/documents` | POST   | user bearer (any standing but banned) | multipart, one file, `kind: 'identity' \| 'credential' \| 'photo'` | `{ documentId }` |

The kernel's upload middleware decides the type by content (R-SEC-4): `identity`
and `credential` admit `application/pdf` only; `photo` admits JPEG and PNG. The
size limit is `upload_max_bytes`; the rate limit `rate_limit_upload` per user.
The file is stored through the storage port under a server-minted key, the
`verification_documents` row written with the key encrypted (R-DB-8) and the
caller as `user_id`; a photo goes to `teacher_profiles.photo_key` /
`users` photo through the same route and is not a verification document. The
answer carries the id only; a link to the file is minted on demand by the
procedures that may show it.

## Headers every route sends

`Content-Security-Policy: default-src 'none'; style-src 'self'; img-src
'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
`Strict-Transport-Security` outside development, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: no-referrer`, and the CORS allowlist of
`ADMIN_ALLOWED_ORIGINS` for the admin SPA's calls (the pages themselves need no
cross-origin call). A test per route asserts the header set and the absence of
`Set-Cookie`.
