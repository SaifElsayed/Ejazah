# ports

Five ports, each named in the project's own domain terms and never a vendor's (R-API-5).
Each ships as an interface plus a stand-in. Only storage ships real implementations in Phase 0 (FR-055).

| Port | Interface | Stand-in | Real |
|---|---|---|---|
| payment | `payment/payment.port.ts` | `fake.adapter.ts` (signs and mis-signs events on demand) | Phase 2, gateway per OPEN-11 |
| storage | `storage/storage.port.ts` | `in-memory.adapter.ts` | `local.adapter.ts`, `s3.adapter.ts` |
| video | `video/video.port.ts` | `fake.adapter.ts` | Phase 3 |
| push | `push/push.port.ts` | `fake.adapter.ts` | Phase 4 |
| sms | `sms/sms.port.ts` | `fake.adapter.ts` | Phase 1 |

Rules: modules depend on the port token, never a concrete adapter (R-API-4). Selection is configuration in
`ports.module.ts`, never a code change (FR-056). A stand-in records what it was asked and can be told to fail (T122).
The payment port has no balance, transfer or refund operation: the platform holds nothing (ADR 0007).
The whole suite passes with no credential present (SC-005).
