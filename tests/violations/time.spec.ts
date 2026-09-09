// T024 — time, proved by resolving it in the wrong place (FR-017, SC-003).
//
// Each case is red until T132 implements `time/no-datetime-outside-package`. Do not weaken an
// assertion and do not mark a case skipped to make the suite green:
// `proc/no-focused-or-skipped-test` (R-PROC-10) exists so that route stays closed.
//
// R-TIME-1 names two things, `Date` arithmetic and datetime libraries outside the package, so
// each half carries its own fixture under one rule id, as T020 does for R-MOBILE-1.
//
// Neither fixture needs resolved types, so both are `fast`. Display formatting is deliberately
// absent: a date rendered for a human is R-MOBILE-9, and T022 owns its fixture.

import { describeViolations, type ViolationCase } from './harness';

const timeViolations: readonly ViolationCase[] = [
  {
    constitutionId: 'R-TIME-1',
    ruleId: 'time/no-datetime-outside-package',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/sessions/next-occurrence.ts',
    refuses: 'a session datetime constructed by Date arithmetic outside packages/time',
  },
  {
    constitutionId: 'R-TIME-1',
    ruleId: 'time/no-datetime-outside-package',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/sessions/uses-datetime-library.ts',
    refuses: 'a datetime library imported outside packages/time',
  },
];

describeViolations('T024 time violations', timeViolations);
