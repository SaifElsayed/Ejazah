# Implementation Plan: Phase 0 — Foundations

**Branch**: `001-foundations` | **Date**: 2026-08-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-foundations/spec.md`

## Summary

Build the repository, the complete but empty data model, and the platform kernel
that Phases 1 through 5 are constructed inside — and, more importantly, build the
machinery that refuses to let those phases break the constitution. Roughly 88% of
the project's 99 prohibitions are assigned to a machine rather than to a
reviewer's memory; this phase is where those machines are built, and its output is
measured by what it makes impossible rather than by what it makes possible.

The technical approach, from [research.md](./research.md), rests on four
decisions that shape everything else:

1. **Nominal typing for money.** A branded type makes piasters and plain numbers
   mutually unassignable, and a type-aware lint rule bans arithmetic on the brand
   outside its package. An alias would compile away and protect nothing.
2. **A time library whose defaults are the rule.** Temporal expresses gap and
   ambiguity handling as a call parameter whose default behaviour is exactly what
   R-TIME-7 mandates, and it distinguishes wall-clock-in-a-zone from instant as
   separate types — the same distinction the data model draws between an
   availability slot and a session.
3. **Two database roles.** The role that owns the schema is not the role the
   application connects as, because a role cannot meaningfully revoke a privilege
   from itself. This is what turns "nothing that matters is hard-deleted" (R-DB-3)
   from a convention into a property of the system.
4. **Lint rules named after constitution rules.** Every custom rule is named for
   the prohibition it enforces and every message ends with that identifier, so
   FR-011's traceability is structural rather than a matter of writing good error
   text.

Scope is bounded deliberately: no user-facing capability, and no adapter against
a real third-party provider except storage. Every other port ships as an
interface with a stand-in and meets its provider in the phase that first calls it.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict` plus `noUncheckedIndexedAccess`, on Node 24 LTS. Nine constitution rules are enforced by the compiler, so anything less than strict weakens tier `TYPE` across the board.

**Primary Dependencies**: pnpm workspaces; tRPC over Nest for the backend request surface; Prisma with a multi-file schema; Expo Router for the mobile application; Vite for the admin web application; BullMQ over Redis for queued work; `@js-temporal/polyfill` confined to `packages/time`; Vitest; ESLint with the internal rule plugin `eslint-plugin-ijazah`, whose six `boundaries/*` rules carry the wall and read their data from `packages/config/eslint.boundaries.js`; Zod for input schemas; Gitleaks; Sentry.

**Storage**: PostgreSQL 18 as the system of record, with native time-ordered UUID generation for primary keys per the data model's conventions. Redis for queueing and rate limiting only — never for anything whose loss would diverge from the database. Object storage behind the storage port, with a local implementation for development and a remote one for deployed environments.

**Testing**: Vitest, with coverage thresholds declared per path rather than globally. The 80% floor applies in this phase to `packages/money`, `packages/time`, and the kernel's guard and error paths, widening to each domain module as that module is created. Property-based testing for share splitting; fixed-date tests against real Cairo daylight-saving transitions; integrity probes executed as the application database role against a live database.

**Target Platform**: iOS and Android for the user application; evergreen browsers for the admin application; Linux containers for the backend. One always-on staging environment reachable from outside the team's network, deployed automatically on merge.

**Project Type**: Mobile application plus web application plus backend — three deployables from one monorepo, with the queue worker running as a second process of the backend rather than as a fourth application.

**Performance Goals**: None set in this phase. PLAN.md assigns performance verification to Phase 6 (NFR-PERF), and no Phase 0 decision depends on a latency target. The one timing commitment is operational: a merged change is live on staging within fifteen minutes (SC-008).

**Constraints**: The complete test suite must pass with no third-party credential present (FR-054), which rules out any design where a code path can only be exercised against a real provider. Arabic is the source locale and right-to-left is the default direction, so no layout primitive may assume a physical direction. Money is integer piasters everywhere — database, wire and interface.

**Scale/Scope**: 33 tables across 12 module domains plus the platform kernel (ERD v1.3, ADR 0007, ADR 0008); 3 applications; 4 shared packages; 12 backend modules; 5 ports each with a stand-in; roughly 40 machine-enforced constitution rules to implement and prove. No user-load target — the system has no users until Phase 1.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

This phase is unusual: it does not merely comply with the constitution, it
*builds* the compliance machinery. The gates below therefore ask two questions of
each rule family — is this phase's own work compliant, and does this phase
deliver the mechanism the rule is assigned?

| Rule family | This phase's own compliance | Mechanism delivered here | Gate |
|---|---|---|---|
| R-MONEY | No money is held, ever (ADR 0007); the branded type, the payment port stand-in and the two gateway-record tables are built | Branded type (FR-012), arithmetic ban (FR-013), suffix rule (FR-014), money-vocabulary confinement (FR-016), event replay safety (FR-073), signature guard (FR-074), payout readiness columns (FR-075) | **PASS** |
| R-TIME | No sessions exist; the package and its DST tests are built | Single construction point (FR-017), per-occurrence recurrence (FR-018), gap and ambiguity handling (FR-019), schema conventions (FR-023, FR-024) | **PASS** |
| R-GENDER | No teacher data exists to leak | Server-held context (FR-046), repository signature rule (FR-005/R-10), adversarial suite wired as a blocking gate (FR-064) | **PASS** — with the note below |
| R-MOBILE | No screens are built; primitives and trees are established | Boundary rules, token rules, direction rules, i18n rules (FR-004, FR-006, FR-007) | **PASS** |
| R-API | Routers are empty; the kernel and both surfaces are established | Layer rules (FR-005), error shape (FR-041), audit-writing admin path (FR-049), disjoint surfaces (FR-048), contract snapshot (FR-063) | **PASS** |
| R-DB | The schema is created (33 tables); no data exists | Two roles (FR-025), delete revocation and soft deletion (FR-026), constraints (FR-030), hashing and encryption (FR-031), derived-value ceiling (FR-033), index restriction (FR-035), checksums (FR-037) | **PASS** |
| R-SEC | Secret scanning precedes the first feature commit | Scanning in two places (FR-059), signed URLs (FR-055), sniffing (FR-044), rate limiting (FR-043), separate identities (FR-032), TLS rule (FR-009) | **PASS** |
| R-SESS | No sessions run | Attendance modelled as provider events with no client-writable field (FR-036) | **PASS** |
| R-HONEST | Nothing is displayed | Output-schema discipline established; the surfaces that could mislead arrive in later phases | **PASS** |
| R-PROC | Spec, clarification and plan precede code (R-PROC-1) | Branch gate (FR-061), review gates (FR-058), checklist (FR-065), coverage floor (FR-062), generated-file check (FR-062) | **PASS** |

**Note on R-GENDER-1/2/3.** The constitution's enforcement map assigns the
adversarial suite's gate to Phase 0, while PLAN.md assigns the suite's substance
to Phase 2. Both are honoured: the gate, its harness and its failure semantics
are built here and block from the first commit, and its case coverage grows when
there is teacher data to attack. An empty suite that runs is materially different
from a suite that does not exist, because the second one has to be introduced
past code that already violates it.

**Review-only tier.** The twelve `REVIEW`-only rules cannot be gated by this
plan; FR-065 puts them on the pull request template verbatim and nothing else
alongside them. Of the twelve, three are live during this phase — R-DB-2 (was a
local schema hand-edited), R-DB-9 (is this index backed by a measured slow query)
and R-PROC-3 (was a business rule invented at the keyboard). The rest have no
subject matter until later phases.

**Gate result: PASS.** No unjustified violation. Two structural costs are
recorded in Complexity Tracking below.

## Project Structure

### Documentation (this feature)

```text
specs/001-foundations/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 19 decisions
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/           # Phase 1 output
│   ├── README.md
│   ├── ports.md         # The five port interfaces, in domain terms
│   ├── kernel.md        # Error shape, context, caller kinds, health signals
│   └── lint-rules.md    # Rule id to constitution id mapping
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
apps/
├── mobile/                      # User application: students and teachers
│   └── src/
│       ├── app/                 # File tree is the nav tree; route groups are guard boundaries
│       ├── design/              # Tokens, primitives, theme — the only source of colour
│       ├── features/
│       │   ├── student/         # Sealed against teacher/
│       │   ├── teacher/         # Sealed against student/
│       │   └── shared/          # Imports from neither side
│       ├── i18n/                # ar.json and en.json, parity-checked
│       └── lib/                 # Client, secure storage, formatters, direction
│
├── admin/                       # Administrator web application
│   └── src/
│
└── api/                         # Backend, serving both applications
    └── src/
        ├── main.ts              # Request process entrypoint
        ├── worker.ts            # Queue process entrypoint — same modules, no second copy of a rule
        ├── modules/             # Twelve modules, one per data-model domain (identity, verification, catalog, booking, payments, sessions, chat, certification, reviews, moderation, notifications, admin)
        │   └── <module>/        # service, repository, router, spec, index, README
        ├── platform/            # The kernel
        │   ├── config/          # Validated at startup; refuses traffic on failure
        │   ├── logging/         # Redaction list declared here
        │   ├── errors/          # One shape out
        │   ├── guards/          # Rate limiting, sniffing, crypto-random ids, security headers
        │   ├── crypto/          # Column encryption, hashing
        │   ├── db/              # The one database client; the only place runtime raw SQL is written
        │   ├── idempotency/     # Keyed in Postgres, not Redis
        │   └── ports/           # Five ports (payment, storage, video, push, sms): interface plus stand-in; storage also has real ones
        ├── surfaces/
        │   ├── app.router.ts    # User surface
        │   └── admin.router.ts  # Administrator surface — mounted separately
        └── jobs/

packages/
├── contracts/                   # The only shared type surface
├── money/                       # Branded piasters; the only place money arithmetic happens
├── time/                        # The only place a domain datetime is constructed
└── config/                      # tsconfig, prettier, eslint base, boundaries, internal rule plugin

prisma/
├── schema/                      # One file per module, twelve files plus platform.prisma and base
└── migrations/                  # Immutable once merged; checksum-verified

.github/workflows/               # Pipeline stages, ordered by how fast they fail
```

**Structure Decision**: Three applications from one monorepo, matching the
product's actual shape — a React Native application for students and teachers, a
web application for administrators, and one backend serving both. The queue
worker is a second process of `apps/api` rather than a fourth application: it
imports the same modules, which is what stops a background job from carrying its
own divergent copy of a rule. `packages/` holds the four shared libraries; the
two that contain real logic (money, time) are the two carrying the coverage
floor in this phase. Backend modules map one-to-one onto the twelve domains in
the data model, which is what makes the table-ownership lint rule (R-API-6)
mechanically checkable rather than a matter of judgement.

## Complexity Tracking

> Two structural costs that a simpler design would avoid, recorded because both
> are deliberate and both will look like over-engineering to a reader who does
> not know which rule they serve.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Two database roles and two connection strings, rather than one role | R-DB-3 places non-deletion in tier `DB`, meaning "physically impossible". A role that owns a table can always grant itself back a privilege it revoked, so the guarantee only exists if the constrained role is not the owning role (research R-5). It is also what makes SC-004 an honest test rather than a test against a role nobody uses. | A single role with triggers raising exceptions on UPDATE and DELETE: triggers are objects the owning role can drop, degrading the guarantee from "impossible" to "impossible until someone runs one statement" — precisely the class of argument tier `DB` exists to end. |
| Type-aware linting, which requires a full type-check per lint run and roughly doubles lint time | Four rules cannot be written against syntax alone: arithmetic on the money brand (R-MONEY-5), money-carrying identifier naming (R-MONEY-2), repository signatures that omit requester gender (R-GENDER-5), and per-module table ownership (R-API-6). Without resolved types these four fall back to human review, and R-GENDER-5 in particular guards the failure the constitution calls "a screenshot, not a bug ticket". | Syntax-only linting with naming conventions and directory patterns as a proxy: catches the honest mistakes and none of the ones that matter, since an unfiltered repository method looks identical to a filtered one at the syntax level. Mitigated rather than accepted — the rules are split so editors and the pre-commit hook run only the fast set (research R-10, R-13). |

## Phase Outputs

- **Phase 0 — Research**: [research.md](./research.md). Nineteen decisions; two (staging host, data residency) are recommendations awaiting confirmation and block provisioning rather than design.
- **Phase 1 — Design**: [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).
- **Phase 2 — Tasks**: not created by this command. Run `/speckit-tasks`.

## Post-Design Constitution Re-Check

Re-evaluated after the Phase 1 artefacts were written. No gate changed from PASS,
and the design surfaced three points worth recording:

1. **The migration workflow looks like it violates R-PROC-9** (never edit a
   generated file), because migrations are generated and then extended by hand
   with the raw SQL of research R-6. It does not: R-PROC-9 protects artefacts
   that are regenerated from a source of truth, whereas a migration *becomes* the
   source of truth when it is created, and R-DB-1 then makes it immutable. This
   is the one place two rules appear to disagree, so the runbook must state the
   distinction rather than leaving each reader to resolve it.

2. **Encryption forecloses uniqueness**, which the design absorbs rather than
   works around. A fresh initialisation vector per write makes ciphertext
   non-deterministic, so an encrypted column cannot carry a unique constraint.
   Where one is needed — the device push token — a separate hash column carries
   it (research R-9). No rule is bent; the cost is one extra column.

3. **The derived-value ceiling is now testable.** With the three stored derived
   values removed from the model in ERD v1.1, R-DB-4's "exactly two" is a
   countable assertion (SC-014) rather than a judgement call at review time.

4. **ADR 0005 (post-plan).** Managed escrow was withdrawn as a business
   decision after this plan was written; share splitting, the ledger and the
   wallet are gone for good. The worker, router directory and module list in
   this plan were confirmed and the older documents corrected to match.

5. **ADR 0007 (post-plan).** Direct gateway checkout with 0% commission and
   zero custody. The payment port and a `payments` module return, with two
   tables that record what the gateway did (never a balance), a webhook
   signature guard in the kernel, and payout readiness columns on the teacher
   profile. This phase ships the port's stand-in, the schema and the guard; the
   real adapter and the confirmation flow are Phase 2.

**Re-check result: PASS.**
