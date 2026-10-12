# jobs

Queued work executed by `src/worker.ts`. Arrives with the phase that needs it:
`expire-idempotency-keys` (Phase 0, with T102), `reencrypt-columns` (Phase 0, with T155), `expire-holds`, `expire-pending-payments`, `confirm-enrollment` (Phase 2), `evaluate-session`, `purge-chat`, `send-reminder` (Phase 3),
`render-certificate`, `deliver-notification` (Phase 4).

Every job is idempotent and proves it with a double-run assertion in its own test (R-API-14, FR-052).
Push delivery is reachable only from the queued notification job (R-API-15).

## Shape (T112)

- `queue.ts` — the one BullMQ queue, `jobs`, over `REDIS_URL`: the producer side, sweep registration and the worker.
- `job.ts` — `defineJob({ name, payload, schedule?, run })`. The name is kebab-case, as the file. The payload is identifiers only, checked by its schema before `run`. A sweep carries a cron `schedule` and no payload.
- `double-run.ts` — `runOnceAndTwice({ world, run, observe })`. A job's spec calls the handler directly, no queue, and asserts `expect(twice).toEqual(once)`.

A job reads and writes through the modules' public entries and the kernel; it never queries a table itself (R-API-6).
