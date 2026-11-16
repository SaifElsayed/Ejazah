# Implementation Plan: Phase 4 — Certification, reports and notifications (lightened)

**Branch**: `Ejazah_app/004-sessions/T057` (the cycle); batches as `Ejazah_app/005-certification/<task ids>`, cut from `develop` after T057's PR merges (`tracks-coordination.md` §1) | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-certification/spec.md` (clarified 2026-11-16)

## Summary

v1.0's Phase 4, as SRS DEC-70 and DEC-71 cut it:
- the ijazah request, its review and issue, with the certificate rendered by Typst in the worker;
- revocation and the bar;
- user reports;
- gender flags, the correction and the fraud ban;
- push for seven notification kinds through a queued delivery job;
- the administrators' settings page.

The schema already holds most tables (init migration). This phase adds `ijazah_requests`, `session_reminders`, six
columns on `ijazahs` and two compensation reasons. It writes the code that the empty `certification` and
`notifications` modules, and moderation's `gender_flags` and `user_reports`, have waited for.

Every decision is in [research.md](research.md) (R-401 to R-413). Four wait for the owner (P1–P4,
`ejazah-tools\b43\t057-plan-questions.md`), with the recommended option written in place.

## Technical Context

- **Language and dependencies:** TypeScript (strict). NestJS API with tRPC; Prisma 7 on PostgreSQL; BullMQ on Redis;
  Expo SDK 58 phone app; React (Vite) admin panel; zod contracts; vitest and jest. All as in Phases 1 to 3.
- **New dependencies (Open).** Nothing is added without the owner's word typed in the implementing session:
  - the Typst CLI 0.15.1 binary (P1 (a));
  - `expo-notifications` in `apps/mobile`, with FCM credentials in EAS (P2 (a)).
- **Storage:**
  - PostgreSQL: the tables above;
  - object storage through `StoragePort`: certificates, signatures, the request's signature copy, all by signed link.
- **Testing:**
  - full TDD (red first, named mutants) for gender, security and time: requests, bars, flags, the correction and fraud,
    reminders;
  - lighter specs for ordinary screens (the owner's lighter gates of 2026-11-15);
  - DB specs on `ijazah_integrity` only.
- **Target platform:** Android first (SRS DEC-62); the panel in a desktop browser.
- **Performance and scale:** one certificate render per issue (seconds, in the worker); one sweep a minute for
  reminders; MVP scale (hundreds of teachers).
- **Constraints:**
  - no money behaviour (ADR 0007);
  - no PII in a push payload (R-HONEST-5);
  - no render or push inside a request (R-API-13, R-API-15);
  - additive contracts (R-API-9);
  - gender rules on every new read (R-GENDER-1, 2, 5, 6).

## Constitution Check

| Rule | How this plan holds it |
|---|---|
| R-MONEY-6, ADR 0007 | No amount anywhere. Gender cases are Phase 3's `openCompensationCase`, with no amount. B43's T053 specs cover the new modules unchanged |
| R-MONEY-12 | Six new rate-limit settings and `reminder_offsets_minutes`. The registry (R-410) declares bounds. No literal beyond a named constant |
| R-GENDER-1, 2 | Every new user read is registered in the adversarial harness, both ways. A profile not visible to the reporter answers NOT_FOUND |
| R-GENDER-4, 6 | No gender, role or user id from input decides anything. No self-service gender change (a CI test asserts its absence) |
| R-API-1…6 | Thin routers; services decide; repositories query only their module's tables (`module-tables.json`); cross-module calls go through `index.ts` |
| R-API-12 | Every admin mutation records its audit entry, its target as a kind word and an id |
| R-API-13, 15 | `render-certificate` and `deliver-notification` are jobs. The push port is used only in the delivery job (lint `no-push-outside-job`) |
| R-API-14 | Each job has its double-run spec |
| R-SEC-3, 4 | Certificates, signatures and the request's copy only by signed link. The signature upload is sniffed |
| R-HONEST-5, 6 | The push payload holds UUIDs only (`assertPushPayload`). A revoked ijazah is never shown as valid (list, link, record) |
| R-DB-6, 7 | The certificate number and token come from `platform/guards/identifiers.ts` (crypto randomness). The token is stored only hashed |
| R-PROC-1 | This spec folder; batch branches named `Ejazah_app/005-certification/<ids>` |

**Gate: passes.** The two open dependency questions are recorded (P1, P2): neither breaks a rule, and both need the
owner's word to install.

## Project Structure

### Documentation (this feature)

```text
specs/005-certification/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/ (app-surface.md, admin-surface.md, jobs.md)
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
apps/api/src/
├── modules/certification/   # requests, issue, revoke, bar, certificates reads; template/ (Typst, Amiri)
├── modules/notifications/   # NotificationWriter, delivery, reminders' store
├── modules/moderation/      # + user reports, gender flags (decisions call identity, booking, sessions entries)
├── modules/catalog/         # + teacher signatures
├── modules/identity/        # + certificate name, push-token register/remove, gender change (admin path only)
├── modules/admin/           # + settings writer; settings.list/update
├── platform/settings/registry.ts
├── platform/ports/push/expo.adapter.ts
└── jobs/                    # render-certificate, deliver-notification, send-reminder
packages/contracts/src/      # certificates, reports, gender-flags, push; admin/{ijazahs,reports,gender-flags,settings}
prisma/                      # migration(s), seed block
apps/mobile/src/features/    # teacher: signature, request sheet, request status; student: certificate name, certificates; shared: report sheet, flag, push permission
apps/admin/src/pages/        # ijazah-requests, ijazahs, reports, gender, settings
tests/                       # adversarial registrations, db-integrity probes, job double-runs, template spec
```

**Structure decision.** The existing monorepo layout: each feature lives in the module that owns its table
(`module-tables.json`). The integration wires them in `surfaces/context.ts`, `admin.router.ts`, `app.router.ts`,
`main.ts` and `worker.ts`.

## Batches (track 1, 11/17–11/19; at most six tasks each; ids in tasks.md)

| Batch | When | Tasks (summary) |
|---|---|---|
| B45 | 11/17 | Migration and seed; settings registry; signature upload; certificate name; notifications writer and `deliver-notification` with the Expo adapter (stand-in until P2's acts); push-token procedures |
| B46 | 11/17–11/18 | Requests (send, preview, freeze); the admin queue (approve, reject); `render-certificate` and the template; certificates reads and links; revoke and bar |
| B47 | 11/18 | Reports (create, queue, resolve, chat retention); gender flags (raise, queue, dismiss, correct, fraud ban) with their locks and cases |
| B48 | 11/18–11/19 | Push producers (cancellation request and answer, payment results); the `send-reminder` sweep; phone screens (request, status, signature, certificate name, certificates, report, flag, push permission) |
| B49 | 11/19 | Panel pages (ijazah requests, ijazahs, reports, gender, settings); adversarial registrations for every new procedure; quickstart run |

The settings page (R-410) is a light item: if track 2 frees first, the owner may give it to track 2 by name.

## Complexity Tracking

None: no constitution rule is broken. Two new dependencies wait for the owner's word (P1, P2).
