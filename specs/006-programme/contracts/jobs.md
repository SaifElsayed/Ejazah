# Jobs: the programme

Each job follows the jobs README: identifiers-only payloads; settings read on every run; a double-run spec through
`runOnceAndTwice` (R-API-14).

| Job | Kind | Schedule | What it does | Idempotent by |
|---|---|---|---|---|
| `advance-programmes` | sweep | every minute | per programme, under its row lock, one transaction each: (1) lapse past `pay_by`; (2) mark the next month due at the paid month's last session's end and, with a saved card, start `chargeSavedCard`; (3) retry a soft decline at the configured days, at most 4; (4) pause when the next occurrence starts unpaid. One log line of ids and a reason per action | each step reads the state it moves from |
| `confirm-enrollment` (changed) | on demand | — | a paid order of an expected kind confirms or extends the programme: `assessment` → session 0 and `awaiting_offer`; `rest_in_full` → sessions 1..N; `instalment` m → its sessions from the next occurrence, `paused_at` cleared, an open stop request withdrawn. A second paid order for a paid month → `duplicate_payment` case | today's replay checks (`confirm-enrollment.ts:240-246`) |
| `release-teacher-shares` (changed) | sweep | hourly at :35 | adds the `assessment` and `programme_stopped` milestones, and the programme's half on the offer's total (R-512) | `@@unique([enrollmentId, milestone])` |
| `reencrypt-columns` (changed) | sweep | as built | covers `programme_cards.token_encrypted` | as built |
