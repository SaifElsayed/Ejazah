# identity

## Owns

`users, user_roles, teacher_profiles, otp_codes, device_push_tokens, terms_acceptances`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Trust client-supplied role or gender (R-GENDER-4). Store a bare secret column (R-DB-7/8). Share a table with administrator identity (R-SEC-8).

## Payout readiness

`teacher_profiles` carries `payout_account_ref_encrypted`, `payout_configured_at` and `payout_verified_at` (ADR 0007 D3). Only `payments` may request they be set, through this module's public entry. `payout_verified_at IS NULL` makes a teacher invisible, unbookable and unable to publish (SRS §3.7.1).

## Shape

The rules live in the services (Phase 1, T047): `sign-in.service.ts` (the provider nonce and sign-in), `onboarding.service.ts` (the onboarding token and the account's one transaction), `session.service.ts` (the two tokens, rotation, `resolveUserSession`, `revokeAll`), `email-auth.service.ts` (the email account), `account.service.ts` (the signed-in person's own account, T049), and `one-time-codes.ts` with the mails in `mail/`. The queries live in a `*.repository.ts` per table: `identity.repository.ts` (the accounts and the encrypted columns), `user-sessions.repository.ts`, `otp-codes.repository.ts`, `users.repository.ts`, `push-tokens.repository.ts`. A router is thin: validate, call one service method, return: `auth.router.ts`, `onboarding.router.ts` and `account.router.ts` (T048, T049), over the services `createIdentityServices` builds for `AppServices.identity`. `index.ts` is the only import path.

## Requirement ids

_Filled as SRS requirements land in this module._
