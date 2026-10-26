# Contract: Ports this phase adds or first calls

Two new ports, in the project's own terms (R-API-5), each with a stand-in the
suite runs against (SC-114), selected by configuration (FR-056). The port
count becomes seven; ARCHITECTURE §3.2's table and `platform/ports/README.md`
gain the rows.

## SignInPort — `platform/ports/sign-in/`

| Operation                                                             | Purpose                                                                                                                                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verify an identity token for a provider, given the nonce the app sent | The only way a provider identity becomes known: returns the provider, the subject, the email and whether the provider marks it verified, and a display name when offered; throws on a bad signature, issuer, audience, expiry or nonce |
| Exchange an authorization (Apple) for the provider's refresh token    | Kept encrypted so the account can be revoked at deletion (TN3194)                                                                                                                                                                      |
| Revoke a provider grant (Apple), given the refresh token              | Account deletion (ADR 0015 D3)                                                                                                                                                                                                         |

**Constraints carried by the interface**: the verify operation takes the nonce the server minted (`auth.providerNonce`), and the service consumes its single-use mark before verifying, so a captured token and nonce replay nothing; it returns `emailVerified` as a
separate boolean, so a caller cannot read an unverified email as an address
(FR-121); it returns no token, so nothing a provider issued is stored except
the refresh token the revoke operation needs.

**Selection**: `SIGN_IN_PROVIDER`, `fake` (the only member until the live
adapter's task adds `live`); refused outside development and test like every
stand-in (T168). Provider keys, all optional and stripped from every test run:
`GOOGLE_CLIENT_IDS` (comma-separated audiences), `APPLE_CLIENT_ID`,
`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`.

**Stand-in behaviour**: accepts an unsigned fake token of the shape `fake.<provider>.<subject>.<email or ->.<verified|unverified>.<nonce>` — no key, since the device must hold none; the stand-in is refused outside development and test (T168), so the unsigned shape reaches no deployment — still compares the nonce it is handed with the fake token's field (the service owns the single-use mark; an adapter holds no Redis state), records every call, can be told to fail, and answers `exchange` with a recorded fake refresh token and `revoke` with a recorded no-op. The phone app in development builds the fake token behind a development-only flag, so the owner can walk the flow on a device without a provider account.

**Live adapter (later task)**: fetches Google's and Apple's JWK sets, caches
them with their cache headers, verifies with `node:crypto` (RS256 for Google,
ES256 for Apple), checks `iss`, `aud` against the configured client ids, `exp`
and `nonce` (Apple: the SHA-256 of the raw nonce), reads `email_verified`
(Google) and `email_verified` / `is_private_email` (Apple); exchanges and
revokes against Apple's REST endpoints with a client secret signed by the
configured key.

## EmailPort — `platform/ports/email/`

| Operation                                                             | Purpose                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Deliver a mail to one address: subject, text body, optional HTML body | One-time codes, the deletion confirmation, the administrator invite |

**Constraints**: the port takes a rendered mail, never a template id, so no
vendor concept enters it; the body may carry a one-time code, so no
implementation logs it and the logger redacts `text`, `html` and `code`
(R-SEC-2); the address is validated as one address.

**Selection**: `EMAIL_PROVIDER`, `fake` (the live member arrives with the
sender chosen at launch), and `EMAIL_FROM` (an address; the stand-in records
it). Refused outside development and test like every stand-in.

**Stand-in behaviour**: records every mail (to, subject, text) so a test reads
the code it carried; can be told to fail; in development, logs nothing of the
body and writes each mail to `.storage/mail/` so the owner can read a code on
a device walk-through.

## PaymentPort — the recipient operations, as this phase calls them

Phase 0's interface (`contracts/ports.md`), with one additive field since B15:
`recipient_rejected` carries the gateway's `reason` where it sent one (note
under T077, decision 2). This phase is the first caller of
`registerPayoutRecipient(teacherUserId, details)` and of the parsed
`recipient_verified` / `recipient_rejected` events. It reads no
`getRecipientStatus`; the poll fallback is Phase 2's (decision 6). What this
phase fixes:

- `PayoutDetails` is published in `packages/contracts` as the stand-in's
  provisional shape (holder name, account kind, account number) and marked
  provisional in its doc comment; the gateway task of Phase 2 settles it
  (OPEN-11) additively.
- The recipient reference the port returns is stored encrypted with its lookup
  hash (data-model §2), and an event is routed to its teacher by that hash
  (R-114). The event carries the reference exactly as the gateway sent it.
- The stand-in's hosted recipient onboarding does not exist; the app's
  `PayoutStart` button calls `teacher.payout.register` with the provisional
  details on a development build, and the stand-in's webhook endpoint (already
  signed under its derived secret, T121) is driven by a development script to
  emit the verified or rejected event (quickstart §6).
