// T025 — the pairing rule, proved by handing a caller an unfiltered list (FR-005, SC-003).
//
// The case is red until T046 implements `gender/require-requester-gender`. Do not weaken the
// assertion and do not mark it skipped to make the suite green: `proc/no-focused-or-skipped-test`
// (R-PROC-10) exists so that route stays closed.
//
// One case, because R-GENDER-5 states one prohibition: a repository method returning teachers
// must take the requester's gender. Both directions of the predicate — a male requester never
// receiving female teacher data and the reverse (SRS §3.7.1, NFR-SEC-4) — are a runtime property
// of the filter, proved by the adversarial suite T087 wires at `tests/adversarial/gender.spec.ts`,
// not by a method signature.
//
// The rule is type-aware (research R-10) because a filtered and an unfiltered method are
// syntactically identical; only the resolved return type says the method returns teachers. Its
// fixture is therefore a real file inside the fixture TypeScript program, as T021's R-API-6
// fixture is.

import { describeViolations, type ViolationCase } from './harness';

const genderViolations: readonly ViolationCase[] = [
  {
    constitutionId: 'R-GENDER-5',
    ruleId: 'gender/require-requester-gender',
    ruleSet: 'typeAware',
    fixture: 'apps/api/src/modules/catalog/catalog.repository.ts',
    refuses: "a repository method returning teachers without the requester's gender",
  },
];

describeViolations('T025 gender violations', genderViolations);
