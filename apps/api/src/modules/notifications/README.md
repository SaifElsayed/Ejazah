# notifications

## Owns

`notifications`, and since Phase 4 (T001 of specs/005-certification) `session_reminders`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Deliver push outside the queued job (R-API-15). Put personal content in a push payload; identifiers for deep-linking only (R-HONEST-5).

## Shape

`notification-writer.ts` holds the rule (T005 of specs/005-certification): `NotificationWriter.record(tx, …)` writes a row on its producer's transaction, for the seven v1.0 kinds only (by type) and identifiers only, and enqueues `deliver-notification` on the transaction's after-commit list, refusing a transaction with none bound. `notifications.repository.ts` holds every query (`insert`, `find`, `markPushed` only where `pushed_at` IS NULL). No router in v1.0: the notification centre is v1.1's (T029). `index.ts` is the only import path: `createNotificationWriter` (bound by `main.ts` with the producers, B48) and `createNotificationDeliveries` (the job's store, bound by `worker.ts`). The push itself is `jobs/deliver-notification.ts`'s (R-API-15).

## Requirement ids

FR-NOTIF-1, FR-NOTIF-3, FR-NOTIF-4; Phase 4's FR-619, FR-620, FR-621 (R-405, R-406).
