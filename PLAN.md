# Ijazah — Phase Plan

One Spec Kit spec per phase. Companion to SRS v1.4, ARCHITECTURE v3.2, ERD v1.3. Amended by ADR 0005 (managed escrow retired) and ADR 0007 (direct gateway checkout, 0% commission, zero custody).

| Phase | Spec | Weeks | Depends on |
|---|---|---|---|
| 0 — Foundations | `specs/001-foundations/` | 1–2 | — |
| 1 — Identity and teacher onboarding | `specs/002-identity/` | 3–5 | 0 |
| 2 — Catalog, discovery, booking | `specs/003-booking/` | 5–8 | 1 |
| 3 — Live sessions | `specs/004-sessions/` | 8–13 | 2 |
| 4 — Certification, reviews, notifications | `specs/005-certification/` | 12–15 | 2 |
| 5 — Retired (managed payments, ADR 0005) | — | — | — |
| 6 — Hardening and store submission | `specs/007-submission/` | 15–17 | all |

---

## Phase 0: Foundations

**Spec objective:** build the repository, data model and platform kernel every later phase depends on.

**SRS:** NFR-SEC-7/8, §6 · **Architecture:** §3, §4, §5, §12, §14, §15

**What this phase delivers**

- Monorepo: three apps (mobile, admin, api with its worker process), four packages
- Security baseline before first feature commit
- Boundary lint for modules and mobile wall
- Docker Compose local environment
- CI pipeline and automatic staging deploy
- Full Prisma schema, 33 tables, multi-file
- Database-level integrity rules and role-level delete revocation
- Seed data identical on every machine
- Platform kernel: config, logging, errors, guards, idempotency
- tRPC context, four procedure types, two separate routers
- Five port interfaces (storage, video, push, sms, payment) with fake adapters
- Storage adapters: local and S3
- Sentry, health and readiness endpoints
- Spike: video baseline on real devices
- Spike: Arabic RTL PDF with 25-entry chain

**Why separate this**

Because every later phase depends on it, and because boundary lint that arrives in Week 6 is boundary lint already violated.

**Definition of done**

- CI green on typecheck, lint, test, build
- Secret scanning and branch protection enforced
- Staging deploys automatically from `main`
- Migrations run clean from empty database
- DELETE revoked at Postgres role level on `users`, `sessions`, `enrollments`, `ijazahs`, `audit_logs`
- Every port has a working fake adapter
- Both spikes closed with a written outcome
- All three deployable applications build green: mobile client, admin dashboard, API backend (serving both, with its worker process)

---

## Phase 1: Identity and teacher onboarding

**Spec objective:** let a teacher apply and an admin approve them, with the identity model built right the first time.

**SRS:** FR-AUTH-1…11, §2.2, FR-VERIFY-1…11, FR-PAYG-12…16, FR-ADMIN-1/17, FR-LOC-1/2/3

**What this phase delivers**

- Signup by phone or email with OTP
- Login, refresh tokens, password reset
- Rate limiting on auth and OTP
- Role set supporting dual role
- Gender and date of birth capture
- Derived `is_minor` flag surfaced to admin
- Versioned terms acceptance
- Design tokens as single source
- Arabic and English with logical RTL
- Student, teacher and shared feature trees
- Teacher application with document upload
- Signed expiring URLs, encrypted at rest
- Admin shell with mandatory MFA
- Audit log written from day one
- Verification queue: approve, reject, request more, ban
- Post-approval payout setup in-app via the payment port; recipient reference stored encrypted; teacher invisible and unbookable until the gateway verifies it (ADR 0007 D3)

**Definition of done**

- A teacher applies end to end on a physical device
- An admin approves them and the audit log records it
- Arabic RTL renders correctly on iOS and Android
- Gender is changeable only by an admin
- Approval is blocked until the verification call is recorded
- An approved teacher without a verified payout account appears nowhere and cannot publish
- No raw colour or spacing value exists outside `design/`

---

## Phase 2: Catalog, discovery, booking

**Spec objective:** let a student find a teacher and buy a package with correctly scheduled sessions.

**SRS:** FR-PROFILE-1…10, FR-DISC-1…5, FR-BOOK-1…11, FR-PAYG-1…11, NFR-COMP-1

**What this phase delivers**

- Subjects in both languages
- Teacher profiles and packages
- `packages/time` complete and DST-safe
- Availability slots as local time plus zone
- Search and browse
- Gender filtering enforced at the repository layer
- Slot holds with TTL and expiry job
- Double-booking prevention on both axes
- Enrollment with full term snapshots
- Session generation as UTC instants
- Enrollment cancellation
- Adversarial gender suite blocking in CI
- Gateway checkout behind the payment port: order creation, hosted checkout, signed-webhook ingestion, `confirm-enrollment` and `expire-pending-payments` jobs (ADR 0007)
- Real gateway adapter (OPEN-11)
- Admin payments monitor, read-only

**Definition of done**

- A student finds a teacher, holds a slot, pays on the gateway sandbox, and the signed webhook confirms the enrollment and generates sessions with no human step
- Sessions schedule correctly across a Cairo DST boundary
- Adversarial gender tests pass in CI
- A forbidden profile returns 404, never 403
- No code outside `packages/money` does piaster arithmetic; no wallet, ledger, escrow or balance exists anywhere; money amounts appear only in `payments`
- `confirmed_at` has exactly one write path and no proof-upload or manual-paid endpoint exists

---

## Phase 3: Live sessions

**Spec objective:** run a session end to end and settle its outcome from evidence, not from the client.

**SRS:** FR-SESS-1…19, FR-NOSHOW-1…6, FR-CANCEL-1…7, FR-DISPUTE-1…4

**What this phase delivers**

- Video adapter behind the port
- Server-side token minting and join window
- Session room: audio, camera, screen share
- Pre-session confirmation screen
- In-session chat with document attachments
- Image rejection by server-side content sniffing
- Chat retention and purge job
- Attendance webhooks into participant events
- Idempotent webhook handling
- Evaluation job at scheduled end plus two minutes
- Full session state machine
- Simultaneous time accumulated across reconnections
- All four no-show outcomes
- Cancellation by mutual agreement
- Admin review queues for under-threshold and outage

**Definition of done**

- A session runs on two physical devices over mobile data
- Attendance evaluates correctly across a mid-session disconnect
- A session evaluates even when the final webhook never arrives
- All four no-show outcomes are reachable
- The sessions module never references a price, a payment record or any payment concept

---

## Phase 4: Certification, reviews, notifications

**Spec objective:** grant, verify the certificate that is the product.

**SRS:** FR-ISNAD-1…7, FR-IJAZAH-1…14, FR-REVIEW-1…5, FR-NOTIF-1…4, FR-SESS-15, §3.14

**What this phase delivers**

- Chain of transmission per teacher per subject
- Admin verification of chain entries
- Teacher signature upload
- Ijazah granting, generated and uploaded modes
- Immutable chain snapshot at grant
- Non-guessable certificate numbers and QR
- Public certificate verification page
- Admin bar to revoke the ability of a teacher to grant Ijazah with reasons
- Reviews on terminal enrollments
- Review moderation preserving the star
- Push notifications and notification centre
- Delivery job with retry
- User reports and block
- Admin settings surface

**Definition of done**

- A teacher grants a certificate in both modes (generated and uploaded)
- A 25-entry chain renders correctly in Arabic
- The public page verifies a certificate by token
- A teacher can never edit a chain entry
- One review per enrollment is enforced by constraint
- Every non-retired SRS v1.3 requirement ID maps to shipped code

---

## Phase 5: Retired — managed payments

Retired by ADR 0005 D1 and not reinstated by ADR 0007: payment is a direct
gateway checkout with zero custody, built in Phase 2 behind the payment port. Reintroducing managed payments would be a new spec,
a new ADR and a MAJOR constitution amendment, not a reactivation of this phase.

---

## Phase 6: Hardening and store submission

**Spec objective:** prove the system works from outside your network, and get it into review.

**SRS:** §5, §9, NFR-PERF

**What this phase delivers**

- Hosted infrastructure live from Week 14
- Full adversarial suite green
- Manual penetration pass on gender rules
- Eight use cases walked on both platforms, both languages
- Performance verified on real 3G and 4G
- Backup restore drill
- Staging dataset operated as admins for a week
- Privacy policy and terms publicly hosted
- Screenshots at every device size, both languages
- Store descriptions in Arabic and English
- Age rating and data-safety declarations
- Demo account seeded for reviewers

**Why separate this**

Because no new features are added here, and every team that breaks that rule resubmits in month five.

**Definition of done**

- Reviewers can open and use the app from their own network
- A backup has been restored, not merely taken
- Submitted to both stores

---

## Descope ladder

Cut in this order if a gate slips.

- Reviews and ratings
- In-session file sharing, keeping text chat
- Public certificate verification page
- Uploaded certificates, shipping generated only
- Notification breadth
- Admin settings UI
- One store first

**Never cut:** gender enforcement, product honesty about payment (R-HONEST-1), timezone handling, the security baseline.