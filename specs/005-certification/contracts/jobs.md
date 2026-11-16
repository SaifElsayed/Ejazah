# Jobs: Phase 4 additions

Each job follows the jobs README: identifiers-only payloads; stores from module entries; windows read from settings on
every run; a double-run spec through `runOnceAndTwice` (R-API-14).

| Job | Kind | Payload / schedule | What it does | Idempotent by |
|---|---|---|---|---|
| `render-certificate` | on demand | `{ ijazahId, generation }`, `jobId` = ijazah id and generation | renders the PDF with the Typst CLI (R-401), puts it in storage, sets `ijazahs.rendered_at` for that generation (the administrators' queue shows it ready to sign off) | `rendered_at` set, or a newer generation → no write |
| `deliver-notification` | on demand | `{ notificationId }` | sends to each of the user's device tokens through `PushPort`, sets `pushed_at`, removes stale tokens | `pushed_at` set → skip |
| `send-reminder` | sweep, every minute | none | records `session_reminder` for each (session, user, offset) whose `scheduled_start_at - offset <= now < scheduled_start_at` and that has no row yet, so a run after downtime catches up; skips sessions no longer scheduled; read through ERD §14's `sessions (scheduled_end_at) WHERE status = 'scheduled'` index, bounded by end time; a session booked inside an offset's window gets that reminder on the next run (R-407) | `session_reminders` primary key |

`reresolve-session-instants`' hook (`:181-182`) is reworded to point here: the sweep reads the committed instants, so
nothing is rescheduled (R-407).

The lint rule `no-push-outside-job` already confines `PushPort` to jobs; its allowed file becomes
`deliver-notification.ts` (its spec names `send-reminder.ts` today, `tests/lint-plugin/no-push-outside-job.spec.ts:89`).
