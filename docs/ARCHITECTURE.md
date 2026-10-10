# Ijazah — System Architecture

_Version 3.2 · Companion to SRS v1.4, ERD v1.3, Constitution 2.3 · September 2026_
_Adds ports-and-adapters for external capabilities. Supersedes v3.0. Amended by [ADR 0007](adr/0007-direct-gateway-checkout.md): direct gateway checkout with 0% commission and zero custody, payment port and payments module, post-approval payout gate; by [ADR 0005](adr/0005-phase-0-document-amendments.md): eleven modules with unified table ownership, worker as a second process of the API, `surfaces/` router directory, per-path coverage floor, `develop` as the integration branch; by [ADR 0009](adr/0009-reresolve-sessions-on-tzdata-change.md): a session's local time is the schedule and its UTC instants are recomputed when time zone rules change; and by [ADR 0010](adr/0010-database-refuses-double-booking.md): the database refuses double booking, the slot hold outlives the gateway order, and the payment port can cancel an unpaid order._

## 0. How to use this document

You have no tech lead. This document is the tech lead. When two of you disagree about where something goes, the answer is here. If it isn't here, that's a gap — raise it, decide it together, write it down. Never settle it silently at the keyboard.

Read §1, §2 and §3 before writing any code. All three of you. §3 in particular, because it's the part that decides whether "modular" makes this codebase easier or harder to work in.

## 1. The shape of this system

A modular monolith in a monorepo. One repository, one database, one schema, three deployable applications — of which the API runs as two processes (request and worker).

Not microservices — deliberately.

Modules are drawn where service boundaries would go if you ever split them out. That's the point: extraction stays possible without being paid for now.

### The ten principles

1. **The server decides. The client displays.** Every rule is enforced server-side. A hidden button is a courtesy, never a control.
2. **The platform never holds money. It routes it.** The student pays the gateway; the gateway settles the net straight to the teacher's payout account; the platform takes 0% and keeps only a record of what the gateway did. No wallet, no ledger, no balance, no escrow. A payment is "confirmed" only when the gateway's signed webhook says so — never from a client redirect, a toggle or an upload (R-HONEST-1, ADR 0007).
3. **Store what happened, derive what is true.** Derived values that get stored will drift, and you won't notice until someone shouts.
4. **Snapshot anything a parent can change.** If a mutable row could rewrite history, copy what you need at the time it mattered.
5. **Every external call is idempotent and retryable.** Webhooks arrive twice. Networks time out after success. Users double-tap.
6. **One concept, one place.** One function decides gender pairing. One decides whether an enrollment may generate sessions. One resolves slots to UTC. One file defines a colour.
7. **Modules own their data.** A module reaches into another's tables only through that module's public entry point. Lint-enforced.
8. **Abstract across boundaries, not within them.** A port exists for things that cross to the outside world or have a real second implementation. Never for your own domain. See §3.
9. **Structured, not clever.** Real patterns applied consistently. If you can't explain a file to the other two in a minute, rewrite it.
10. **If the spec doesn't say, stop.** Don't invent business rules while coding. Raise it, decide it, write it down, then implement.

## 2. Containers

| Container | Technology                                    | Responsibility                                            |
| --------- | --------------------------------------------- | --------------------------------------------------------- |
| Mobile    | Expo · React Native · TypeScript · NativeWind | Student and Teacher. One binary, one store listing.       |
| Admin     | Vite · React · shadcn/ui                      | Internal operations. English only. Deliberately plain.    |
| API       | NestJS · tRPC                                 | All business logic. The only thing touching the database. |
| Worker    | NestJS · BullMQ                               | Scheduled and deferred work. Second process of `apps/api` (`src/worker.ts`), same modules. |
| Database  | PostgreSQL · Prisma · one schema              | Single source of truth.                                   |
| Queue     | Redis                                         | BullMQ queues and rate limiting only. Slot holds live in Postgres (`slot_holds`). |

Why the worker is a separate process: a slow PDF render or a stuck notification batch must never block an HTTP request, and a crashed worker must never take the API down. Why it is not a separate application: it imports the same modules as the request process, which is what stops a background job from carrying its own divergent copy of a rule (ADR 0005 D3).

Redis holds nothing whose loss would diverge from the database. A slot hold that disappeared on a cache flush would release a slot a student is in the middle of booking, so holds are rows in `slot_holds` with an expiry job, not keys with a TTL (ADR 0005 D4).

## 3. Ports and adapters — read this carefully

You want modules you can swap. Correct instinct, but it must be applied selectively, or "modular" becomes a maze of indirection where every change requires opening five files to find the code that actually runs.

### 3.1 The rule

A port exists only where there is a real second implementation — one that exists today or is concretely planned.

A port with exactly one implementation, forever, is an extra file, an extra indirection, and an extra thing to understand, buying nothing. That is speculative generality, and it is the specific way a modular codebase becomes an unreadable one.

### 3.2 What is a port — and what is not

| Capability                                          | Port? | Reasoning                                                                                                                                             |
| --------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payment                                             | ✓     | Direct gateway checkout (ADR 0007). The port speaks the domain: create a checkout for an enrollment, verify and parse an inbound event, register a payout recipient, report its status. Gateways are interchangeable on price and KYC reach (OPEN-11); a recording stand-in is the second implementation from day one. |
| Video                                               | ✓     | Daily / LiveKit / Agora are interchangeable; you may switch on price or reliability.                                                                  |
| Push                                                | ✓     | Expo Notifications now, direct FCM/APNs later.                                                                                                        |
| File storage                                        | ✓     | Local disk in dev, S3-compatible in prod. Two implementations from day one.                                                                           |
| SMS / OTP                                           | ✓     | Providers change on price. Trivial interface.                                                                                                         |
| Chat                                                | ✗     | Built in-house on Postgres + WebSocket. A port would abstract your own code from itself. Add one if Stream or Sendbird ever becomes real.             |
| Search                                              | ✗     | A filtered Postgres query. The repository already is the port. Moving to Meilisearch means swapping the repository implementation — that seam exists. |
| Profiles, booking, sessions, certification, reviews | ✗     | Core domain. There is nothing to swap them for. Abstracting your own domain behind an adapter is the classic over-abstraction mistake.                |

### 3.3 Why domain modules don't need ports

Your module structure already gives you swappability. A module with a public `index.ts` and a service interface can have its entire internals rewritten — different queries, different algorithm, different tables — without any other module noticing. That is open/closed. Adding an adapter layer on top would be a second seam where one already works.

The distinction that matters: ports abstract **who** you talk to. Modules abstract **how** you do it. You need both, but not in the same place.

### 3.4 How adapters are structured

```
apps/api/src/platform/ports/
├── ports.module.ts                   selects every adapter by config
├── payment/
│   ├── payment.port.ts               the interface — THE contract
│   ├── gateway.adapter.ts            the selected gateway (OPEN-11), Phase 2
│   └── fake.adapter.ts               recording stand-in; can be told to fail
├── storage/
│   ├── storage.port.ts               the interface — THE contract
│   ├── local.adapter.ts              development
│   ├── s3.adapter.ts                 deployed environments
│   └── in-memory.adapter.ts          stand-in for tests
├── video/    video.port.ts · daily.adapter.ts · fake.adapter.ts
├── push/     push.port.ts · expo.adapter.ts · fake.adapter.ts
└── sms/      sms.port.ts · provider.adapter.ts · fake.adapter.ts
```

Five ports. Selection is configuration, never a code change:

```ts
providers: [
  {
    provide: STORAGE_PORT,
    useClass: config.storageDriver === 's3' ? S3StorageAdapter : LocalStorageAdapter,
  },
];
```

```ts
export interface PaymentPort {
  createCheckout(enrollmentId: string, amount: Piasters, currency: string, latestExpiry: Date): Promise<CheckoutRef>;   // order id + hosted checkout URL; the order expires no later than latestExpiry (ADR 0010 D4)
  cancelCheckout(gatewayOrderId: string): Promise<'cancelled' | 'paid' | 'in_progress' | 'unsupported'>;              // cancels an unpaid order, moves no money; an order already cancelled or expired answers 'cancelled' (ADR 0010 D6)
  verifyAndParseEvent(rawBody: Buffer, headers: Record<string, string>): Promise<GatewayEvent>;   // throws on bad signature
  registerPayoutRecipient(teacherUserId: string, details: PayoutDetails): Promise<RecipientRef>;
  getRecipientStatus(recipientRef: RecipientRef): Promise<'pending' | 'verified' | 'rejected'>;
}

export interface VideoPort {
  createRoom(sessionId: string): Promise<RoomRef>;
  createSessionToken(sessionId: string, participantUserId: string): Promise<JoinToken>;
  recordParticipantEvent(event: ProviderParticipantEvent): Promise<void>;
  endRoom(sessionId: string): Promise<void>;
}
```

Three rules that keep ports honest:

1. Every module depends on the port token, never on a concrete adapter. Importing `DailyAdapter` outside `platform/ports/video/` is a lint error.
2. The port interface speaks your domain, not the vendor's. `video.createSessionToken(sessionId, userId)` — not `daily.createMeetingToken()`. If vendor concepts leak into the interface, swapping vendors changes every caller, and the port has failed at its only job.
3. Every port has a fake adapter for tests. `InMemoryStorageAdapter`, `FakePaymentAdapter`. This is half the value: your test suite never touches a network.

### 3.5 The payment port specifically

The port has exactly the operations the domain needs and nothing the gateway happens to offer. Note what is absent: no "get balance", no "transfer", no "refund" — the platform holds nothing to balance or transfer, and any reimbursement is an admin decision executed by Platform Administration outside the code path (FR-DISPUTE-6). `cancelCheckout` is not a refund: it cancels an order nobody has paid, so no money moves; a student's new checkout uses it to end the old one (FR-BOOK-12, ADR 0010 D6). If a vendor concept ever appears in this interface, the port has failed at its only job (R-API-5).

The enforcement rule: money-carrying records (gateway order, gross, fee, net) exist only in the `payments` module. Any other module that mentions a wallet, ledger, balance, escrow or payout amount is the bug (R-MONEY-6). `booking` learns that an enrollment is confirmed through `payments` calling its public entry; it never reads a `payments` row.

## 4. Backend modules

Each module has a service (all rules), a repository (all queries), a router (thin tRPC procedures), an `index.ts` (public entry), and a README. Twelve modules, one per data-model domain; the machine-readable form is `packages/config/module-tables.json`, which the table-ownership lint rule reads (R-API-6, ADR 0005 D2).

| Module        | Owns                                                                   | Tables                                                                                              |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| identity      | users, roles, auth, tokens, gender declaration, teacher profile record incl. payout readiness columns (written via its public entry by `payments`) | `users` `user_roles` `teacher_profiles` `otp_codes` `device_push_tokens` `terms_acceptances` |
| verification  | teacher applications, documents, admin decisions                        | `verification_documents` `verification_requests`                                                  |
| catalog       | subjects, packages, availability, isnad chain, signatures; **discovery** (search and browse — gender filter enforced in its repository signatures) | `subjects` `teacher_subjects` `packages` `availability_slots` `isnad_entries` `teacher_signatures` |
| booking       | slot holds, enrollments, enrollment confirmation (called by `payments` on a paid event) | `slot_holds` `enrollments`                                                                        |
| payments      | gateway orders, signed-webhook ingestion (raw-body HTTP endpoint outside tRPC), payout recipient onboarding, the `confirm-enrollment` and `expire-pending-payments` jobs | `payments` `payment_events` |
| sessions      | session generation, live lifecycle, attendance evidence, mutual cancellation, completion | `sessions` `session_participant_events` `cancellation_requests`                                |
| chat          | in-session messaging, retention, moderation access                      | `chat_messages`                                                                                    |
| certification | ijazah granting, PDF, public verification, bars                         | `ijazahs` `ijazah_bars`                                                                           |
| reviews       | ratings, aggregates, moderation                                         | `reviews`                                                                                          |
| moderation    | disputes, compensation cases (opened automatically on termination), gender flags, reports, admin actions | `disputes` `gender_flags` `user_reports`                                                        |
| notifications | templating, delivery, notification centre                               | `notifications`                                                                                    |
| admin         | admin auth, queues, settings, audit log                                 | `admin_users` `audit_logs` `settings`                                                           |
| platform      | config, logging, errors, db, idempotency, guards, PORTS (§3)            | `idempotency_keys` (ADR 0008 D2)                                                                   |

Discovery is a service inside `catalog`, not a module: search is a filtered query over catalog's own tables (§3.2), and a module owning no tables would have to read another module's tables to do anything, which R-API-6 forbids. Session generation is triggered by `booking` when an enrollment is marked paid, but the rows are written by `sessions` through its public entry — `booking` never touches the `sessions` table. Certification reads the isnad chain through `catalog`'s public entry. `payments` is the only module with an HTTP endpoint outside tRPC: the gateway's webhook is a plain POST whose raw body must reach the signature check untouched (§8).

Lint-enforced dependency rules:

- Modules depend sideways and downward, never upward into admin.
- `platform` depends on nothing; everything may depend on `platform`.
- A module is imported only through `index.ts`. Reaching into internals is a build error.
- Concrete adapters are imported only inside their own port folder.
- Circular dependency needed? The logic belongs in `platform` or in a new module.

## 5. Repository layout

```
ijazah/
├── apps/
│   ├── api/src/
│   │   ├── main.ts                  request process entrypoint
│   │   ├── worker.ts                queue process entrypoint — same modules, no second copy of a rule
│   │   ├── surfaces/
│   │   │   ├── app.router.ts        user surface (mobile)
│   │   │   ├── admin.router.ts      administrator surface — mounted SEPARATELY
│   │   │   ├── context.ts           identity, role, gender, locale, correlation id — all server-resolved
│   │   │   └── procedures.ts        public / student / teacher / admin caller kinds
│   │   ├── platform/
│   │   │   ├── ports/               §3.4
│   │   │   └── config/ logging/ errors/ guards/ crypto/ db/ idempotency/ health/
│   │   ├── modules/                 twelve, one per domain (§4)
│   │   │   └── booking/
│   │   │       ├── booking.service.ts       ALL rules
│   │   │       ├── booking.repository.ts    ALL queries
│   │   │       ├── booking.router.ts        thin procedures
│   │   │       ├── booking.service.spec.ts
│   │   │       ├── index.ts                 PUBLIC ENTRY
│   │   │       └── README.md                owns / never / SRS IDs
│   │   └── jobs/               expire-holds · expire-pending-payments · confirm-enrollment · expire-idempotency-keys
│   │                           evaluate-session · send-reminder · render-certificate
│   │                           purge-chat · deliver-notification
│   ├── mobile/             §6
│   └── admin/              §6.5
│
├── packages/
│   ├── contracts/  — tRPC types, Zod schemas, shared enums
│   ├── money/      — the branded Piasters type for package prices. NOTHING else touches money
│   ├── time/       — slot → UTC, DST-safe. NOTHING else does timezone maths
│   └── config/     eslint (incl. boundary rules and the internal plugin) · tsconfig · prettier · module-tables.json
│
├── prisma/
│   ├── schema/     — MULTI-FILE — base.prisma plus one file per module
│   │   ├── base.prisma            datasource, generator, every enum
│   │   ├── identity.prisma        verification.prisma   catalog.prisma
│   │   ├── booking.prisma         payments.prisma       sessions.prisma       chat.prisma
│   │   ├── platform.prisma        (idempotency_keys — the kernel's one table)
│   │   ├── certification.prisma   reviews.prisma        moderation.prisma
│   │   └── notifications.prisma   admin.prisma
│   ├── migrations/  never edited after merge
│   └── seed.ts      identical fixtures everywhere
│
├── scripts/          schema-check · seed-checksum · contract-snapshot · generated-file-check · branch-spec-check
├── tests/            violations · db-integrity · seed · pipeline · ports · adversarial
├── specs/            Spec Kit
├── docker-compose.yml   postgres · redis
└── docs/             SRS · ARCHITECTURE · ERD · RUNBOOK · adr/ · design/
```

Why the schema is split per module: thirty-three tables in one file, edited daily by three people, produces constant merge conflicts in the most dangerous file in the repo. Prisma's multi-file schema folder removes that entirely, and the file boundaries reinforce module ownership.

## 6. The mobile app

### 6.1 Three trees, one wall

```
apps/mobile/src/
├── app/            expo-router — file tree IS the nav tree
│   └── (auth)/  (student)/  (teacher)/  _layout.tsx
│
├── features/
│   ├── student/   — NEVER imports from teacher/
│   │   └── discovery/ booking/ enrollments/ credentials/ reviews/
│   ├── teacher/   — NEVER imports from student/
│   │   └── application/ payout-setup/ packages/ availability/ isnad/ granting/
│   └── shared/    — both may import · imports from NEITHER
│       ├── session-room/    the live call — genuinely identical
│       ├── chat/            genuinely identical
│       ├── account/         language, theme, password, notifications
│       └── notifications/   notification centre
│
├── design/         — SINGLE SOURCE — §6.3
├── i18n/           ar.json · en.json · RTL helpers
└── lib/            trpc client, storage, guards
```

Note what is deliberately absent: there is no wallet, balance or earnings screen on either side, because the platform holds no money (ADR 0007). The teacher's `payout-setup/` feature registers a payout account with the gateway after approval and shows its verification state; it never shows a balance, because there is none to show.

The rule for `shared/`: genuinely identical flows and primitives only. When student and teacher code starts to look alike, stop and decide deliberately — same concept (→ shared) or coincidentally similar (→ leave duplicated)? Duplication is cheaper than a wrong abstraction. The wall's real value is forcing that conversation instead of letting an import happen by accident at 11pm.

### 6.2 The wall is a lint rule, not a promise

The six `boundaries/*` rules of `eslint-plugin-ijazah` in `packages/config`, with the wall data in `packages/config/eslint.boundaries.js`:

| From                  | May import                                                  |
| --------------------- | ----------------------------------------------------------- |
| `features/student/**` | `features/shared/**`, `design/**`, `lib/**`, `packages/*`   |
| `features/teacher/**` | `features/shared/**`, `design/**`, `lib/**`, `packages/*`   |
| `features/shared/**`  | `design/**`, `lib/**`, `packages/*` — nothing role-specific |

A violation is a build error. This is the whole mechanism. Without it the wall erodes in three weeks.

Each feature folder has the same internal shape — `api.ts`, `hooks.ts`, `components/`, `screens/`, `index.ts` — so seeing one is seeing all of them.

### 6.3 The design system — one file changes everything

```
design/
├── tokens.ts           — THE source: colours, spacing, radii, typography
├── tailwind.config.js  consumes tokens.ts — never hardcodes
├── theme.tsx            light/dark + direction providers
└── primitives/          Button · Text · Card · Input · Sheet · Badge
```

- A raw colour or spacing value never appears in a feature file. Only tokens.
- Features compose primitives. They don't build buttons.
- Changing the brand colour is one line.
- Lint bans hex colours and raw numeric spacing outside `design/`.
- NativeWind makes it real: Tailwind class names in React Native, same config.

### 6.4 RTL is logical, never directional

- Always `ms-4` / `me-4`. Never `ml-4` / `mr-4`.
- Always `text-start`. Never `text-left`.
- Directional icons flip via `useDirection()`.
- Lint bans `ml-*`, `mr-*`, `left-*`, `right-*`, `text-left`, `text-right` in `features/**`.

Get this wrong for two weeks and fixing it is a rewrite of every screen.

### 6.5 Admin — deliberately separate

Vite SPA. Routes mirror the admin queues. Shares nothing visual with mobile — no tokens, no theme, no components, no translations. English only, plain shadcn defaults. It is an internal tool, not a product.

The only shared thing is `packages/contracts`, and even there it consumes a separate router.

## 7. The API layer

### 7.1 NestJS holds structure, tRPC is transport

```
tRPC procedure → NestJS service → repository → Prisma
     (thin)         (all rules)     (all SQL)
```

A tRPC procedure contains no business logic. Validate, call one service method, return. If a procedure has an `if` about business rules, that logic is in the wrong file.

### 7.2 Two routers, four procedure types

`appRouter` and `adminRouter` are entirely separate surfaces. An admin capability is unreachable from mobile even with a forged role claim, because the procedure does not exist there.

| Procedure          | Guarantees                                                |
| ------------------ | --------------------------------------------------------- |
| `publicProcedure`  | No auth. Signup, login, certificate verification.         |
| `studentProcedure` | Authed, Student role active. Injects gender into context. |
| `teacherProcedure` | Authed, Teacher role active and approved.                 |
| `adminProcedure`   | Admin router only. MFA. Writes an audit entry.            |

Role and gender come from the server-held session, never from client input.

### 7.3 Version skew — the tRPC tax

You cannot force a mobile update. Three mitigations, all required:

1. **EAS Update** — OTA JS pushes, no store review.
2. **Minimum-version gate** — server rejects clients below a floor.
3. **Additive-only rule** — never remove or rename a procedure, field or enum value. Add and deprecate.

The additive-only rule is the one that gets broken. Put it in `constitution.md` and check it at review.

## 8. Payment

Direct gateway checkout, 0% commission, zero custody (ADR 0007). Read this before touching `booking`, `payments` or anything that displays a paid state.

### 8.1 Checkout and confirmation

```
student confirms enrollment
   │  booking: enrollment = pending_payment, linked to the slot hold placed on entering checkout
   │  payments: PaymentPort.createCheckout(…, latestExpiry), outside any transaction → payments row (created)
   │     recorded, and the hosted checkout URL handed to the client, only in a transaction whose conditional
   │     update of the hold row finds it still active; otherwise the checkout is withheld and the order
   │     cancelled where the gateway allows (ADR 0010 D6). Retry creates its order on the same hold the same way
   ▼
student pays on the gateway's hosted page          (the platform never sees card data)
   │
   ▼
gateway POSTs a signed webhook  →  payments.webhook endpoint (raw body, outside tRPC)
   │  1. PaymentPort.verifyAndParseEvent — bad signature → 401, nothing else happens   (R-MONEY-9)
   │  2. insert payment_events (provider_event_id unique) — duplicate → 200, no effect   (R-MONEY-8)
   │  3. update payments.status / fee / net from the event
   │  4. enqueue confirm-enrollment(enrollmentId)                                        (R-API-15 pattern: side effects in jobs)
   ▼
confirm-enrollment job (idempotent, double-run safe)
   │  if enrollment already confirmed, or a compensation case for it exists → no-op
   │  one transaction (ADR 0010 D5, FR-PAYG-19), the branch decided by writing, not by reading:
   │     booking.confirmEnrollment(id)  →  hold converted by a conditional update (released_at IS NULL);
   │        status = confirmed only from pending_payment or cancelled, confirmed_at
   │     conversion matched no row (late payment) → release the expired holds on the slot and the student's
   │        own expired hold (their enrollments cancelled, D7), insert a new active hold for the enrollment
   │        on its slot, convert it
   │     sessions.generateForEnrollment(id)
   │  refused by the database — slot held by another student, the student holding another slot,
   │  or an overlapping session (ERD §15.17–19) → nothing of it kept; refusal branch, new transaction:
   │     release the hold if still active, enrollment = cancelled (slot_unavailable),
   │     moderation opens a compensation case, student notified — stop here
   │  notifications: both parties
   ▼
net proceeds settle to the teacher's payout account, gateway-side
   │
   ▼
client: after the hosted checkout returns, the app subscribes to enrollments.status through the API
        and renders "Payment successful" only on confirmed (FR-PAYG-17). Past the confirmation timeout
        it releases the student with a "Confirming" badge; the push resolves it (FR-PAYG-18, ADR 0008)
```

The gateway order expires at the checkout TTL; the slot hold outlives it by a grace ([ADR 0010](adr/0010-database-refuses-double-booking.md) D4). A failed or cancelled event marks that order failed and keeps the hold, so the student may Retry on it or choose another slot. A hold is released only by conversion, by its expiry, by the student's own new checkout (which releases the old hold first and then checks its orders; an order on it that is still payable (`created`) must first be cancelled by the gateway, `PaymentPort.cancelCheckout`, and a `paid` or `in_progress` answer writes nothing and refuses the new checkout, D6), or by the refusal branch above, and a release without conversion cancels its enrollment in the same transaction (D7). `expire-pending-payments` is keyed on the enrollment: a `pending_payment` enrollment whose hold has expired gets its hold released by a conditional update (`released_at IS NULL`) and is cancelled only from `pending_payment` (`payment_failed` if its last order failed, else `payment_expired`); the student starts again from package selection. `expire-holds` releases expired holds that carry no enrollment yet, its conditional update requiring `released_at IS NULL` and `enrollment_id IS NULL`. A paid event that still arrives takes the late-payment branch above. The database refuses a second active hold on a slot or for a student, and overlapping sessions for a teacher or a student (ERD §15.17–19).

### 8.2 Payout onboarding gate

Teachers apply with credentials only. After approval, `payout-setup` registers a recipient with the gateway through `PaymentPort.registerPayoutRecipient`; the platform stores the gateway's recipient reference encrypted plus `payout_configured_at`. When the gateway reports the recipient verified (signed `recipient_verified` event, or a poll on `getRecipientStatus`), `identity` sets `payout_verified_at`. Until then the teacher is invisible and unbookable: `payout_verified_at IS NOT NULL` is the fourth conjunct of the visibility predicate (SRS §3.7.1) and gates publishing packages and availability.

### 8.3 What is not here

No wallet, no balance, no escrow, no ledger, no per-session share, no commission, and no refund path in code. When a termination leaves paid-for sessions undelivered, `moderation` opens a compensation case automatically (FR-DISPUTE-5); an admin decides it in the moderation queue; Platform Administration executes any reimbursement through the gateway outside the platform's code path, and `payments` records the gateway's refunded event when it arrives (FR-DISPUTE-6). Reimbursement is never a negotiation between student and teacher. A "paid" state has exactly one write path (§8.1 step 4) and no manual override — not for the teacher, not for an admin (FR-PAYG-8, R-HONEST-1). Amounts on a `payments` row are what the gateway reported, never computed here (R-MONEY-5).

## 9. Time

Store UTC. Compute in the teacher's zone. Display in the viewer's zone.

`AvailabilitySlot` holds local wall-clock time + IANA timezone. `Session` holds its own local date, local start time and IANA zone, plus UTC instants derived from them (ADR 0009).

The DST trap. Wrong: add 7×24 hours per occurrence — across Egypt's transition every later session silently shifts an hour. Right: for each occurrence, resolve that week's local date + slot time in the teacher's zone to a UTC instant, independently.

Handle spring-forward gaps (shift forward) and autumn ambiguity (take the first) explicitly. Unit-test against real Cairo transition dates. All of it lives in `packages/time`.

A future instant is only as right as the time zone rules that produced it, and governments change those rules. So a session keeps what the teacher chose, its local date, local start time and IANA zone, and that is the schedule. Its UTC start and end are a derived cache, recomputed from the local fields whenever the server's time zone data changes, as calendar systems do ([ADR 0009](adr/0009-reresolve-sessions-on-tzdata-change.md), FR-SESS-20).

## 10. Gender enforcement

Every session is same-gender. Exactly one legal pairing.

- **Layer 1 — Data access.** Every teacher-returning query goes through a repository method taking the requester's gender and filtering in SQL. No unfiltered method exists to call.
- **Layer 2 — Service guards.** Booking and join re-assert from server-held records.
- **Layer 3 — Response shaping.** Forbidden profile returns 404, not 403. Counts and facets computed post-filter.

Adversarial suite, blocking in CI: profile by ID → 404 · crafted pagination → absent · count comparison → no inference · direct booking call → rejected · token replay → rejected · gender corrected mid-enrollment → handled · image renamed .pdf → rejected.

## 11. Session lifecycle

```
Scheduled ───► Cancelled-By-Agreement · Cancelled-By-Admin
   │  scheduled_end passes → worker evaluates
   ▼
   both ≥ threshold simultaneous       → Done
   student absent, teacher present     → Student-No-Show
   teacher absent, student present     → Teacher-No-Show
   neither present                     → Both-No-Show (= mutual cancellation)
   under threshold / provider outage   → Admin review
```

Attendance comes from provider webhooks written to `SessionParticipantEvent` — never from the client.

Simultaneous time accumulates across reconnections, so a dropped 4G connection costs nobody their session.

Evaluation is a scheduled job at `scheduled_end + 2m`, not a webhook reaction — so a session is always evaluated even if the final webhook never arrives.

## 12. Observability

Three people, no ops experience. Without this, your first production bug is a user saying "it didn't work" and no stack trace.

- **Error tracking:** Sentry (free tier) in API, worker, mobile and admin. Source maps uploaded on build.
- **Structured logging:** JSON, with a request ID threaded through every log line in a request. Never log full request bodies — payment payloads, OTPs and document URLs end up in logs, and logs end up in screenshots.
- **Health endpoints:** `/health` (process alive) and `/ready` (database and Redis reachable).
- **Alerts that matter at your size:** unhandled exception rate, failed job count, webhook signature failures (gateway and video), payments `paid` with the enrollment still `pending_payment` after five minutes. Four alerts you'll actually read beats forty you'll mute.

## 13. Testing

| Layer                | Requirement                                                           |
| -------------------- | --------------------------------------------------------------------- |
| Backend services     | Unit tests mandatory, no exceptions                                   |
| Repositories         | Integration tests against real Postgres in CI                         |
| Ports                | Fake adapters; no test touches a network                              |
| Frontend             | Component tests for logic and conditional rendering — not pure layout |
| Adversarial (gender) | Mandatory, blocking, every commit                                     |
| E2E                  | The eight use cases in SRS §9, at phase gates                         |
| Coverage floor       | Per path, never global (research R-13, ADR 0005 D7): 80% on `packages/money`, `packages/time` and the kernel's guard and error paths from Phase 0; each domain module joins the covered set when it is created. A floor is never lowered (R-PROC-10). |

No global coverage number — chasing coverage on config files teaches people to write worthless tests.

Vitest throughout. React Native Testing Library on mobile.

## 14. Security baseline — week one, before feature code

- GitHub push protection + secret scanning at org level.
- Gitleaks pre-commit and in CI. A key-shaped string does not land.
- `.env` gitignored from commit one; `.env.example` committed empty.
- Branch protection on `main` and `develop`: no direct pushes, one review, CI green. Feature branches (`specs/NNN-*` names) merge into `develop`; `develop` merges into `main` by release PR (ADR 0005 D9).
- Secrets in the host's secret manager, injected at runtime. Never in repo, Slack, Jira or a screenshot.
- If a key leaks: rotate first, investigate second. Runbook holds per-provider steps.

From day one: rate limiting on auth/OTP/search/payment initiation · Zod on every input · parameterised queries · signed expiring URLs · MFA on admin · audit log on every admin action · security headers and a CORS origin allowlist on every browser-facing surface (NFR-SEC-11) · Dependabot.

## 15. Local development

One command, a new machine runs, identical across all three of you.

Preventing schema drift: migrations committed and never edited after merge · nobody hand-edits their local schema · one `seed.ts` · a diverged database is reset, not patched.

Webhooks need a public URL. Cloudflare Tunnel or ngrok, treated as configuration. Without this, attendance cannot be built.

Test video on real devices over mobile data at least once per phase.

Hosting becomes mandatory at Week 14 — store reviewers open your app from their own network.

```
pnpm infra:up        # postgres · redis (docker compose)
pnpm dev             # api (request + worker processes) and admin — hot reload; mobile joins when the first task importing Expo declares it (tasks.md, note under T076)
```

## 16. Conventions

Files kebab-case.ts · classes PascalCase · functions camelCase · database snake_case · booleans as assertions (`is_minor`).

Every money variable ends `_piasters`. Every timestamp column ends `_at` and stores UTC (`timestamptz`); local wall-clock values end `_local` and always carry an IANA timezone alongside (ERD conventions).

Comments explain why, never what. One error shape everywhere: `{ code, message, details? }`.

**Definition of done:** implements the cited SRS requirement ID · unit tests on the service · adversarial tests updated if it touches gender, money or time · module README updated · no new lint or type errors · reviewed by one other person.

## 17. What we deliberately did not build

- No microservices. Modular monolith, boundaries drawn for later extraction.
- No schema-per-module in the database. One schema; joins stay simple.
- No ports for chat, search or domain modules. §3.2 explains why.
- No event bus beyond notifications and audit. Direct service calls.
- No GraphQL. tRPC gives the same safety with fewer concepts.
- No Redux. TanStack Query for server state; Zustand only for auth, locale, theme.
- No custom auth. Proven library.
- No shared design system between admin and mobile. Admin is a tool, not a product.
- No caching layer until something is measurably slow.
- No wallet, ledger, escrow or balance. The gateway settles directly to the teacher; the platform keeps a record and 0% (ADR 0007).

_End of document._
