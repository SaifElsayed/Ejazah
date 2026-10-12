// T025 — the pairing rule, proved by handing a caller an unfiltered list (FR-005, SC-003).
//
// Red until T046 implements `gender/require-requester-gender`. Do not weaken the assertion and do
// not mark the case skipped to make the suite green: `proc/no-focused-or-skipped-test` (R-PROC-10)
// exists so that route stays closed. One case, because R-GENDER-5 states one prohibition. It is
// `typeAware` because a filtered and an unfiltered method are syntactically identical; that both
// directions of the predicate hold at runtime is T087's adversarial suite to prove, not a
// signature's.
//
// T159 adds R-GENDER-4's case: an input schema of packages/contracts that lets the client name its
// own gender. It is `fast`: a key's name is syntax.

import { describeViolations, type ViolationCase } from './harness';

const genderViolations: readonly ViolationCase[] = [
  {
    constitutionId: 'R-GENDER-5',
    ruleId: 'gender/require-requester-gender',
    ruleSet: 'typeAware',
    fixture: 'apps/api/src/modules/catalog/catalog.repository.ts',
    refuses: "a repository method returning teachers without the requester's gender",
  },
  {
    constitutionId: 'R-GENDER-4',
    ruleId: 'gender/no-authority-in-input',
    ruleSet: 'fast',
    fixture: 'packages/contracts/src/search-teachers.ts',
    refuses: 'an input schema that lets the client name its own gender (T159)',
  },
];

describeViolations('T025 and T159 gender violations', genderViolations);
