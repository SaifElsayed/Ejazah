# Phase 3 Contracts

**Feature**: `specs/004-sessions/` · **Date**: 2026-11-05

The procedures that run, settle, cancel, make up and dispute a session, the chat, the administrator's queues, the video
provider's boundary, and what changes in the kernel. As in Phases 1 and 2: every procedure is additive-only once merged
(R-API-9), declared through a caller kind with its input and its **output** schema (`.output(schema)`, the owner's
decision of 2026-10-10), and, where it can be flooded, its rate limit; every output is exactly its schema's fields
(R-HONEST-4); every non-public user-surface procedure has a refusal test naming it (`pnpm check:authz`); every change
passes `pnpm contract:snapshot --check --base origin/develop`.

| Document | Contract |
|---|---|
| [app-surface.md](./app-surface.md) | The user surface: a session, its join, cancellation, remedies, disputes; chat; Phase 2's lists' additive fields |
| [admin-surface.md](./admin-surface.md) | The administrator surface: the monitor, the review queue, outages, disputes, cases, a student's standing |
| [video.md](./video.md) | The video port as this phase calls it, the webhook, the LiveKit adapter, the stand-in and its harness |
| [kernel.md](./kernel.md) | Locks, database refusals, the composition root, the jobs, the gates |

## Conventions

- **Names.** `namespace.verb` in camelCase. New namespaces on the user surface: `sessions` (with `cancellation`,
  `remedy`, `dispute`), `chat`. On the administrator surface: `sessions` (with `monitor`, `review`, `outages`),
  `disputes`, `cases`, `students`.
- **Callers.** "participant" is the user kind admitting an active student, or an approved teacher whose account is
  active, who is one of the two people of the session or enrollment named; anyone else answers `NOT_FOUND` with the
  shape a nonexistent id gets (R-GENDER-2, FR-432). A restricted account is `ACCOUNT_RESTRICTED` before the service.
- **Ids in inputs.** `sessionId`, `enrollmentId`, `requestId`, `slotId`, `messageId`, `disputeId`, `caseId`,
  `userId` (admin only): never `gender` or `role`, and a user procedure never takes a `userId` (R-GENDER-4).
- **Errors.** Added: `JOIN_NOT_OPEN` (with `opensAt` in details), `JOIN_CLOSED`, `SESSION_NOT_SCHEDULED`,
  `CANCELLATION_PENDING` (the other party's request is open; with `requestId`), `CANCELLATION_EXPIRED`,
  `DISPUTE_WINDOW_CLOSED`, `DISPUTE_OPEN`, `SESSION_UNDER_REVIEW`, `REMEDY_NOT_OPEN`, `CHOICE_NOT_ALLOWED` (a refund
  where only a make-up is owed), `SLOT_NOT_OFFERED` (a counter outside the options), `MAKEUP_REFUSED` (the database
  refused the booking; the remedy stays open), `ATTACHMENT_REFUSED` (an image, or a type the chat does not take),
  `CHAT_CLOSED`. Every refusal writes nothing.
- **Time.** Instants as ISO-8601 UTC strings; a session as its local date, local start and zone plus its instants,
  shown twice by the client (ADR 0009 D5, FR-494); nothing client-supplied is an instant (R-TIME-6): the outage window
  is local date, time and zone.
- **A deleted party** (T090, FR-426): `{ displayName: string | null, deleted: boolean }`; the apps show the stand-in.
- **What is not here.** No amount, share, commission, refund or payout (FR-497, T104, T105). No review, report,
  notification, reminder or certificate (Phase 4). No rescheduling and no cancellation of a whole enrollment by a
  student (FR-461). No gender dispute (Phase 4).
