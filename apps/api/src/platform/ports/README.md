# ports

Seven ports, each named in the project's own domain terms and never a vendor's (R-API-5).
Each ships as an interface plus a stand-in. Only storage ships real implementations in Phase 0 (FR-055);
Phase 1 adds the sign-in port and the email port (`specs/002-identity/contracts/ports.md`, T022, T023).

| Port    | Interface                 | Entry (selects by)                                | Stand-in                                                                            | Real                                                    |
| ------- | ------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| payment | `payment/payment.port.ts` | `payment/index.ts` (`PAYMENT_GATEWAY`)            | `fake.adapter.ts` (signs and mis-signs events on demand)                            | Phase 2, gateway per OPEN-11                            |
| storage | `storage/storage.port.ts` | `storage/index.ts` (`STORAGE_DRIVER`)             | `in-memory.adapter.ts`                                                              | `local.adapter.ts`, `s3.adapter.ts`                     |
| video   | `video/video.port.ts`     | `video/index.ts` (`VIDEO_PROVIDER`)               | `fake.adapter.ts` (signs and mis-signs participant events on demand)                | Phase 3                                                 |
| push    | `push/push.port.ts`       | `push/index.ts` (`PUSH_PROVIDER`)                 | `fake.adapter.ts`                                                                   | Phase 4                                                 |
| sms     | `sms/sms.port.ts`         | `sms/index.ts` (`SMS_PROVIDER`)                   | `fake.adapter.ts`                                                                   | none: the stand-in only, called by no module (phone sign-up deferred, ADR 0012), so outside the hosted stand-in check (002:T177) |
| sign-in | `sign-in/sign-in.port.ts` | `sign-in/index.ts` (`SIGN_IN_PROVIDER`)           | `fake.adapter.ts` (the documented unsigned fake token; compares the nonce)          | `live.adapter.ts` (002:T148: Google's token against Google's JWK set, `node:crypto`; Apple refused until iOS) |
| email   | `email/email.port.ts`     | `email/index.ts` (`EMAIL_PROVIDER`, `EMAIL_FROM`) | `fake.adapter.ts` (records; writes each mail under `.storage/mail/` in development) | `resend.adapter.ts` (002:T177: Resend's API by `fetch`, `EMAIL_PROVIDER=resend` with `EMAIL_PROVIDER_KEY`; from `EMAIL_FROM` under `EMAIL_FROM_NAME`, replies to `SUPPORT_EMAIL`) |

`ports.module.ts` selects every port once, at startup, through each folder's entry (T121, FR-056): `selectPorts`
for storage, payment, messaging, video, sign-in and email, and `selectPushPort` for the worker's notification delivery
job only (R-API-15). `inbound-event.ts` holds the two refusals of an inbound provider event, `EventSignatureError` and
`MalformedEventError`, shared by the payment and video ports (T118), and the derivation of a stand-in's webhook
secret from `ENCRYPTION_KEY` when none is configured (T121). `storage/backup-objects.ts` is not an adapter and no
port selects it: it holds the S3 calls of the nightly backup script (`scripts/ops/backup.ts`, 002:T179), built from the
values the script is given.

Rules: modules depend on the port, never a concrete adapter (R-API-4); only a port's own folder names its adapters.
Selection is configuration, never a code change (FR-056). A stand-in records what it was asked and can be told to
fail (T122). The payment port has no balance, transfer or refund operation: the platform holds nothing (ADR 0007).
The whole suite passes with no credential present (SC-005).
