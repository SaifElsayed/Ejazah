# jobs

Queued work executed by `src/worker.ts`. Arrives with the phase that needs it:
`expire-idempotency-keys` (Phase 0, with T102), `expire-holds`, `expire-pending-payments`, `confirm-enrollment` (Phase 2), `evaluate-session`, `purge-chat`, `send-reminder` (Phase 3),
`render-certificate`, `deliver-notification` (Phase 4).

Every job is idempotent and proves it with a double-run assertion in its own test (R-API-14, FR-052).
Push delivery is reachable only from the queued notification job (R-API-15).
