// T020 — the walls, proved by crossing them (FR-004, SC-003).
//
// Each case is red until T035 implements the rule it names. Do not weaken an assertion and do
// not mark a case skipped to make the suite green: `proc/no-focused-or-skipped-test` (R-PROC-10)
// exists so that route stays closed.
//
// R-MOBILE-1 and R-MOBILE-2 are symmetric prohibitions, so each carries a case per direction —
// a rule that refuses student -> teacher and shrugs at teacher -> student is half a wall.
//
// R-API-4 carries two prohibitions under one identifier, and two rules cite it
// (contracts/lint-rules.md, "Two notes on identifier traceability"): never import upward into
// admin, and never import a concrete adapter outside its port folder. The identifier alone does
// not say which half broke, so both cases are declared and each names its own rule id.

import { describeViolations, type ViolationCase } from './harness';

const boundaryViolations: readonly ViolationCase[] = [
  {
    constitutionId: 'R-MOBILE-1',
    ruleId: 'boundaries/no-cross-role-import',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/student/imports-teacher-tree.ts',
    refuses: 'a student feature file importing the teacher tree',
  },
  {
    constitutionId: 'R-MOBILE-1',
    ruleId: 'boundaries/no-cross-role-import',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/teacher/imports-student-tree.ts',
    refuses: 'a teacher feature file importing the student tree',
  },
  {
    constitutionId: 'R-MOBILE-2',
    ruleId: 'boundaries/no-role-import-in-shared',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/shared/imports-student-tree.ts',
    refuses: 'a shared feature file importing the student tree',
  },
  {
    constitutionId: 'R-MOBILE-2',
    ruleId: 'boundaries/no-role-import-in-shared',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/shared/imports-teacher-tree.ts',
    refuses: 'a shared feature file importing the teacher tree',
  },
  {
    constitutionId: 'R-API-3',
    ruleId: 'boundaries/no-deep-module-import',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/booking/imports-catalog-internals.ts',
    refuses: 'one module importing another below its public index.ts',
  },
  {
    constitutionId: 'R-API-4',
    ruleId: 'boundaries/no-adapter-import',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/payments/imports-adapter.ts',
    refuses: 'a module naming a concrete adapter instead of its port',
  },
  {
    constitutionId: 'R-API-4',
    ruleId: 'boundaries/no-upward-admin-import',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/booking/imports-admin.ts',
    refuses: 'a domain module importing upward into the administrative module',
  },
];

describeViolations('T020 boundary violations', boundaryViolations);
