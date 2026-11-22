# jobs

Queued work executed by `src/worker.ts`. Arrives with the phase that needs it:
`expire-idempotency-keys` (Phase 0, with T102), `reencrypt-columns` (Phase 0, with T155), `purge-otp-codes`,
`purge-stale-push-tokens`, `purge-expired-sessions` (Phase 1, with T025; research R-118), `purge-unreferenced-documents` (Phase 1, T093), `erase-deleted-files` (Phase 1, B16: a deleted person's files whose removal after the deletion failed), `expire-holds`,
`expire-pending-payments`, `confirm-enrollment` (Phase 2), `reresolve-session-instants` (Phase 2, T048: the time zone re-resolution of ADR 0009 D3, at worker start and daily), `evaluate-sessions`, `advance-remedies`,
`expire-cancellation-requests` (every minute), `purge-chat` (daily), `close-slot-holds` (hourly, T074), `erase-kept-data` (daily at 04:25, T077 ⚠️ automatic and final) (Phase 3, `specs/004-sessions/contracts/kernel.md`),
`send-reminder`, `render-certificate`, `deliver-notification` (Phase 4; `send-reminder` moved from Phase 3 with the
reminders, `specs/004-sessions/spec.md` Assumptions, amended 2026-11-05), `erase-identity-documents` (daily at
04:40, R1a `specs/002-identity/tasks.md` T176 ⚠️ automatic: an identity document on a live account marked erased
`identity_document_retention_days` after its decision, a teacher once approved excepted, its file then removed by
`erase-deleted-files`).

`advance-remedies` (every minute; T028 and T032 of specs/004-sessions) runs sessions' remedy sweep through the
module's entry: remedies offered and frozen ones offered again, the completion check, then the windows' ends (a
counter left unanswered handed to a case; a proposal booked at the choice window's end, retried while it starts at
least the remedy's lead away, then handed to a `makeup_refused` case and reported once). Each item is on its own
transaction and its failure caught on its own; every read is paged.

`purge-chat` (daily; T039 of specs/004-sessions, FR-492) runs chat's purge through the module's entry: first the
purged messages whose file a previous run could not remove, then each ended enrollment whose last disputable
session's end plus `dispute_window_hours` and `chat_retention_days` has passed with no open dispute, case or
complaint, each in its own transaction under its enrollment's lock; the files removed after the commit, the key kept
until then, so a failed removal is retried by the next run. It deletes for good: the bodies, the attachments' names
and types, and the files.

Every job is idempotent and proves it with a double-run assertion in its own test (R-API-14, FR-052).
Push delivery is reachable only from the queued notification job (R-API-15).

## Shape (T112)

- `queue.ts` — the one BullMQ queue, `jobs`, over `REDIS_URL`: the producer side, sweep registration and the worker.
- `job.ts` — `defineJob({ name, payload, schedule?, run })`. The name is kebab-case, as the file. The payload is identifiers only, checked by its schema before `run`. A sweep carries a cron `schedule` and no payload.
- `double-run.ts` — `runOnceAndTwice({ world, run, observe })`. A job's spec calls the handler directly, no queue, and asserts `expect(twice).toEqual(once)`.

A job reads and writes through the modules' public entries and the kernel; it never queries a table itself (R-API-6).
A sweep that deletes rows declares the store it needs (`purge-otp-codes.ts`'s `OtpCodePurgeStore`), the owning module
implements it over its table and exports a factory from its entry, and `worker.ts` hands the store in; the admin
module's store is handed in the same way, since a job may not import `modules/admin`
(`boundaries/no-upward-admin-import`). A window is a settings key, read on every run (FR-034), and the instant
arithmetic goes through `packages/time` (`window.ts`, R-TIME-1).

## Retry, bounded failure and concurrency (T171)

`queue.ts` exports `defaultJobOptions`, the options every job and every sweep is added with:
`attempts: 3` with exponential `backoff` from one second (`delay: 1000`), safe because every job is
idempotent; `removeOnComplete: true`, so finished work does not accumulate in Redis; and
`removeOnFail: { count: 1000 }`, so a delivery that fails every attempt stays for an operator while the
failed set stays bounded. The worker runs `QUEUE_CONCURRENCY` deliveries at once (`.env.example`; a positive
integer, 4 unless set), handed in by `worker.ts`. These numbers are the queue's own operation, kept in the
kernel: the magic-number gate governs `modules/`, where every operational number is a setting.
