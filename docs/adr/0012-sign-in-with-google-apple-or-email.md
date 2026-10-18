# ADR 0012 — Sign-in with Google, Apple or email; sign-in comes before onboarding; phone sign-up deferred

**Status:** accepted · **Date:** 2026-10-14 · **Decided by:** the owner, on the comparison of 2026-10-14 · **Amends:** SRS FR-AUTH-1, FR-AUTH-6, §4.3, §6.2, §13, DEC-25 (adds FR-AUTH-12, FR-AUTH-13, DEC-52); ERD `users` and `otp_codes` notes, §15 rule 1; ARCHITECTURE §3.2 and §3.4; PLAN.md Phase 1; `docs/design/screens.md` Auth

## Context

FR-AUTH-1 allowed sign-up with a phone number or an email address, by
password or one-time code. A one-time code by SMS is the only part of that
which costs money per user, and in Egypt it carries two more costs:

| | Cost or condition |
| --- | --- |
| SMS through Twilio | $0.3959 a segment to Egypt, plus $0.05 per Verify check: about $450 for 1,000 codes |
| SMS through an Egyptian provider | EGP 0.10 to 0.60 a message in published price lists: EGP 100 to 600 for 1,000 codes |
| Sender ID | Operators expect it registered, with a commercial register extract and a tax card, in 2 to 8 weeks; Etisalat overwrites or drops unregistered alphanumeric senders |
| SMS pumping | Scripted requests to number ranges that pay the attacker; the platform pays every message |
| Sign in with Google | No charge; the server verifies Google's ID token itself |
| Sign in with Apple | No charge beyond the Apple Developer Program the App Store needs anyway |
| Email one-time codes | Free tier of a transactional sender (3,000 a month, 100 a day), then about $20 a month for 50,000 |

Development pays for none of these: the SMS port has a stand-in (T120), and
the owner's rule is no paid infrastructure before launch.

Two outside rules shape the choice:

- **App Store Review Guideline 4.8.** An app that offers a third-party login
  such as Google must also offer an equivalent login that limits collection to
  name and email, lets the user keep the email private, and does not track for
  advertising without consent. Sign in with Apple meets it; whether plain
  email-and-password does is not settled by Apple's text, so it is not relied on.
- **NIST SP 800-63B-4.** SMS one-time codes are a *restricted* authenticator:
  allowed, but only beside an unrestricted alternative.

## Decisions

**D1 — Three ways in, one account each.** A user signs up and signs in with
Google, with Apple (offered on iOS), or with an email address and a password.
An email-and-password account proves its address with a six-digit one-time code
before onboarding. Password reset (FR-AUTH-6) exists only for email-and-password
accounts, by a code sent to the verified address; Google and Apple accounts have
no password on the platform (`password_hash` null).

**D2 — The account key is the provider's subject, never the email.** A Google or
Apple identity is stored as (provider, `sub`) on a new table, `auth_identities`.
Google's own guidance: `sub` is "the unique and permanent user identifier";
"don't use email address as an identifier". The server verifies every ID token's
signature, issuer, audience and expiry before reading it, and requires the
token's nonce to match the one the app sent for that exchange (the replay guard
both providers support). It reads the provider's email only when the token marks
it verified (`email_verified` for Google; Apple's addresses are verified or
relay addresses): an unverified email is treated as absent, so the comparison of
FR-AUTH-13 never answers for a mailbox the caller does not control. When the
provider offers no verified email, onboarding asks for one and verifies it by a
code before the account is written, as the email flow does, so every account
still has a verified email (D5, FR-AUTH-1) and `users.email` is never empty.

**D3 — No automatic linking.** A Google or Apple sign-in whose email already
belongs to another account neither signs in to that account nor merges with it.
The user is told which method that account uses. Linking a second method to an
account is a signed-in action and is deferred (§13). Merging on a matching email
is a known account-takeover path, and Google describes linking only as a flow the
signed-in user starts.

**D4 — Sign-in comes before onboarding.** The order is: welcome and language,
sign-in (D1), then onboarding — role (FR-AUTH-2), display name, gender
(FR-AUTH-3), date of birth (FR-AUTH-4), time zone (FR-AUTH-10), Terms
(FR-AUTH-11) — then the student's home or the teacher's application. A returning
user goes straight home. Reasons:

1. Every teacher a student sees is filtered by the student's own gender
   (FR-DISC-3, §3.7.1), so the core of the app cannot run without an account.
   Apple's guidance to delay sign-in applies to apps that work without one; for
   an app that needs one it says to explain why, then sign in.
2. Gender cannot be changed by the user afterwards (FR-GENDER-5). It must belong
   to a verified identity from the moment it is written, not to an anonymous
   device that later claims an account.
3. Nothing is stored before the account exists, so no personal data of a person
   who abandons the flow is kept (NFR-COMP-2; Egypt's Law 151 of 2020).
4. A returning user who taps "Continue with Google" is not walked through
   questions they already answered.

Gender is shown back on its own confirmation step before the account is
completed, because the user cannot correct it later.

**The account row is written when onboarding completes, not at sign-in** (PR #70
review, 2026-10-17). `users` keeps its NOT NULL columns (gender, date of birth,
display name, time zone) and ADR 0016's single `user_roles` row. A first sign-in
verifies the provider identity (D2) or the email code and hands the app a
short-lived, single-purpose onboarding token that carries the verified identity
(the provider and its `sub`, or the verified email), with the name and email the
provider offered for prefilling; the onboarding answers are held on the device;
the completing procedure, the only one that accepts that token, writes `users`,
`auth_identities` (or the password hash) and `user_roles` in one transaction and
only then issues a session. An abandoned flow leaves no row (reason 3). "An
account that has not completed onboarding shall reach no other procedure"
(FR-AUTH-12) is met by construction: there is no account yet. No nullable
`gender` and no half-onboarded state enter the model, so the gender predicate
(R-GENDER-5) never meets a requester without a gender. If the token expires the
user signs in again; Apple sends the name only on the first authorization, so the
display-name step is prefilled when the provider offers a name and typed
otherwise.

**D5 — Phone sign-up is deferred, not removed.** `users.phone`, its partial
unique index and the phone-or-email check constraint stay as they are; every MVP
account has an email (Google and Apple return one when it is verified; when a
provider offers no verified email, onboarding collects and verifies one before
the account is written, D2), so the check always holds for a live row (the Phase
1 ERD pass rewrote it for deleted rows, ERD §15 rules 1 and 32). The SMS port and its stand-in stay. Phone sign-up returns as a new
decision when a sender ID is registered and its cost is accepted.

## Consequences

- **SRS.** FR-AUTH-1 and FR-AUTH-6 are rewritten; FR-AUTH-12 (order of sign-in
  and onboarding) and FR-AUTH-13 (no automatic linking) are added; §4.3 gains
  Google, Apple and transactional email and marks the SMS row deferred; §6.2's
  User note says the phone is unused; §13 lists phone sign-up and method linking;
  DEC-25 is amended and DEC-52 records this decision.
- **ERD.** `auth_identities (user_id, provider google·apple, provider_subject,
  created_at)`, unique on (provider, provider_subject), joins the ERD amendments
  that open the Phase 1 cycle (PLAN.md), with a forward migration. No Phase 0
  migration changes; the `users` columns stay NOT NULL because the row is written
  when onboarding completes (D4). `otp_codes.destination` holds an email address in MVP; the
  `login` purpose is unused, because email accounts sign in with their password.
- **Architecture.** An email port (`email.port.ts`, a provider adapter, a
  stand-in) is built in Phase 1; the ports become six. The transactional sender
  is chosen at launch, with the sending domain authenticated (SPF, DKIM, DMARC).
- **Mobile.** The Auth frames change: welcome with the three sign-in buttons,
  email sign-in, email sign-up, email code, password reset, then the two
  onboarding steps and the gender confirmation. The phone screen and its keypad
  are removed.
- **Store submission.** Apple's button follows Apple's design rules; the
  Google button follows Google's branding guidelines.
- **Not decided here.** In-app account deletion, which both stores require of
  an app that creates accounts, is not in the SRS; it is raised separately.

## Sources

- [Google — Sign in with Google best practices](https://developers.google.com/identity/siwg/best-practices)
- [Apple — Human Interface Guidelines, Managing accounts](https://developer.apple.com/design/human-interface-guidelines/managing-accounts)
- [Apple Developer Forums — Guideline 4.8 Login Services](https://developer.apple.com/forums/thread/765145)
- [NIST SP 800-63B-4 (restricted authenticators), summary](https://blog.typingdna.com/nist-sp-800-63b-rev-4-sms-otp-is-now-a-restricted-authenticator-but-we-have-the-fix/)
- [Twilio — SMS pricing, Egypt](https://www.twilio.com/en-us/sms/pricing/eg) · [Twilio — Verify pricing](https://www.twilio.com/en-us/verify/pricing)
- [Sent.dm — Egypt SMS pricing](https://www.sent.dm/resources/egypt-sms-pricing) · [Telnyx — Egypt SMS guidelines](https://support.telnyx.com/en/articles/6670411-egypt-sms-guidelines)
- [Authgear — SMS pumping](https://www.authgear.com/post/sms-pumping-attack)
