# identity

## Owns

`users, user_roles, teacher_profiles, otp_codes, device_push_tokens, terms_acceptances`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Trust client-supplied role or gender (R-GENDER-4). Store a bare secret column (R-DB-7/8). Share a table with administrator identity (R-SEC-8).

## Payout readiness

`teacher_profiles` carries `payout_account_ref_encrypted`, `payout_configured_at` and `payout_verified_at` (ADR 0007 D3). Only `payments` may request they be set, through this module's public entry. `payout_verified_at IS NULL` makes a teacher invisible, unbookable and unable to publish (SRS §3.7.1).

## Shape

`identity.service.ts` holds every rule. `identity.repository.ts` holds every query. `identity.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
