// T022 — the design and localisation wall, proved by climbing it (FR-006, FR-007, SC-003).
//
// Each case is red until T037 (R-MOBILE-4/5/6), T038 (R-MOBILE-7/8/9) and T039 (R-MOBILE-10/11)
// implement the rule it names. Do not weaken an assertion and do not mark a case skipped to make
// the suite green: `proc/no-focused-or-skipped-test`
// (R-PROC-10) exists so that route stays closed.
//
// Every rule here decides from the file's path — a literal is legal in `design/`, a manual
// format is legal in `lib/`, an AsyncStorage import is legal in `lib/storage` — so the fixtures
// sit under `apps/mobile/src/features/{student,teacher,shared}/`, spread across all three trees
// so a rule anchored to one of them stays red. Two support files under `design/` and `i18n/`
// give the fixtures a legal primitive and a legal `t()` to reference, so the only thing wrong in
// each file is the one prohibition it exists for.
//
// Three fixtures are `.tsx` because the prohibition is stated in terms of a view: R-MOBILE-7 is
// about a text position, and R-MOBILE-5 and R-MOBILE-6 about what a rendered element is composed
// from. The fast rule set parses JSX (`packages/config/eslint.base.js`, `ecmaFeatures.jsx`), and
// all eight cases are `fast`, so none of them needs the fixture TypeScript program — whose
// `include` is `**/*.ts` and therefore does not cover them.

import { describeViolations, type ViolationCase } from './harness';

const mobileViolations: readonly ViolationCase[] = [
  {
    constitutionId: 'R-MOBILE-4',
    ruleId: 'mobile/no-raw-color',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/student/teacher-card-styles.ts',
    refuses: 'a raw hex colour in a feature file instead of a design token',
  },
  {
    constitutionId: 'R-MOBILE-5',
    ruleId: 'mobile/no-physical-direction',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/teacher/lesson-row.tsx',
    refuses: 'a physical direction utility where a logical one is required',
  },
  {
    constitutionId: 'R-MOBILE-6',
    ruleId: 'mobile/no-raw-control',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/shared/search-field.tsx',
    refuses: 'a raw platform control in a feature instead of a shared primitive',
  },
  {
    constitutionId: 'R-MOBILE-7',
    ruleId: 'mobile/no-literal-string',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/student/empty-state.tsx',
    refuses: 'a user-facing string literal in a view text position',
  },
  {
    constitutionId: 'R-MOBILE-8',
    ruleId: 'mobile/no-translated-concat',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/shared/greeting.ts',
    refuses: 'a sentence assembled by concatenating translated fragments',
  },
  {
    constitutionId: 'R-MOBILE-9',
    ruleId: 'mobile/no-manual-format',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/teacher/session-date.ts',
    refuses: 'a date formatted for display by hand outside the shared formatting layer',
  },
  {
    constitutionId: 'R-MOBILE-10',
    ruleId: 'mobile/no-insecure-storage',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/student/session-token.ts',
    refuses: 'a session token written to plain AsyncStorage outside the secure layer',
  },
  {
    constitutionId: 'R-MOBILE-11',
    ruleId: 'mobile/no-direct-network',
    ruleSet: 'fast',
    fixture: 'apps/mobile/src/features/teacher/roster-refresh.ts',
    refuses: 'a direct network call bypassing the shared client',
  },
];

describeViolations('T022 design and localisation violations', mobileViolations);
