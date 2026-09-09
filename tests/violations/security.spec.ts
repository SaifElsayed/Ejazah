// T026 — the secrets and the escape hatches, proved by taking them (FR-008, FR-009, FR-010,
// FR-044, SC-003).
//
// Each case is red until T040 (R-SEC-2, R-SEC-11, R-DB-6) and T041 (R-API-10, R-PROC-7,
// R-PROC-8, R-PROC-10) implement the rule it names. Do not weaken an assertion and do not mark a
// case skipped to make the suite green: `proc/no-focused-or-skipped-test` (R-PROC-10) is in this
// very file so that route stays closed, and silencing it would be the joke that writes itself.
//
// Four of these seven prohibitions name two things, and a fixture proving one proves nothing
// about the other — the reason T024 split R-TIME-1 and T020 split the mobile walls. So each half
// carries its own fixture under one rule id:
//
//   R-API-10   `any` (no-explicit-any) and `@ts-ignore` (ban-ts-comment)
//   R-PROC-8   a bare marker, and a block of commented-out code
//   R-PROC-10  a focused test, and a skipped one
//
// R-API-10 and R-PROC-7 both refuse an undocumented escape hatch and are deliberately separate
// rules against separate prohibitions (contracts/lint-rules.md, "Two notes on identifier
// traceability"): a message can end with only one identifier. Their fixtures are kept apart for
// the same reason — no `eslint-disable` in the R-API-10 fixtures, no `any` or `@ts-ignore` in the
// R-PROC-7 one.
//
// R-SEC-11 carries one prohibition stated once, so it carries one fixture. The constitution names
// `rejectUnauthorized: false`; how far "and equivalents" reaches is T040's to decide and is
// recorded in the fixture rather than guessed at here.
//
// Every case is `fast`: not one of these needs a resolved type, which is why they can run in the
// editor and in the pre-commit hook (research R-10).
//
// The two R-PROC-10 fixtures are real `*.spec.ts` files, because that is what the rule must
// recognise. The root `vitest.config.ts` excludes `tests/violations/fixtures/**` from collection
// so the runner never executes them — a fixture containing `.only` that the runner collected
// would silence the rest of this suite, which is the prohibition itself.

import { describeViolations, type ViolationCase } from './harness';

const securityViolations: readonly ViolationCase[] = [
  {
    constitutionId: 'R-SEC-2',
    ruleId: 'sec/no-body-logging',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/identity/otp-request-log.ts',
    refuses: 'a logger call handed the raw request body',
  },
  {
    constitutionId: 'R-SEC-11',
    ruleId: 'sec/no-disabled-tls',
    ruleSet: 'fast',
    fixture: 'apps/api/src/platform/ports/sms/sms.transport.ts',
    refuses: 'transport security verification switched off',
  },
  {
    constitutionId: 'R-DB-6',
    ruleId: 'db/no-weak-random',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/certification/certificate-number.ts',
    refuses: 'a public certificate number drawn from non-cryptographic randomness',
  },
  {
    constitutionId: 'R-API-10',
    ruleId: 'api/require-escape-hatch-reason',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/notifications/payload-cast.ts',
    refuses: 'an `any` cast with no justification comment and no ticket',
  },
  {
    constitutionId: 'R-API-10',
    ruleId: 'api/require-escape-hatch-reason',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/moderation/report-count.ts',
    refuses: 'a `@ts-ignore` with no justification comment and no ticket',
  },
  {
    constitutionId: 'R-PROC-7',
    ruleId: 'proc/require-suppression-reason',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/verification/review-code.ts',
    refuses: 'an eslint-disable carrying no justification and no ticket',
  },
  {
    constitutionId: 'R-PROC-8',
    ruleId: 'proc/no-bare-marker',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/booking/hold-expiry.ts',
    refuses: 'a bare TODO carrying no ticket reference',
  },
  {
    constitutionId: 'R-PROC-8',
    ruleId: 'proc/no-bare-marker',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/chat/attachment-filter.ts',
    refuses: 'a block of commented-out code left in the file',
  },
  {
    constitutionId: 'R-PROC-10',
    ruleId: 'proc/no-focused-or-skipped-test',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/reviews/reviews.service.spec.ts',
    refuses: 'a test marked exclusive, which stops every other case in the file',
  },
  {
    constitutionId: 'R-PROC-10',
    ruleId: 'proc/no-focused-or-skipped-test',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/notifications/notifications.service.spec.ts',
    refuses: 'a test marked skipped instead of fixed',
  },
];

describeViolations('T026 security and process violations', securityViolations);
