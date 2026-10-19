// T021 — the layers, proved by collapsing them (FR-005, FR-071, SC-003).
//
// Each case is red until T036 (R-API-1, R-API-2), T047 (R-API-6) and T042 (R-API-15) implement the
// rule it names.
// Do not weaken an assertion and do not mark a case skipped to make the suite green:
// `proc/no-focused-or-skipped-test` (R-PROC-10) exists so that route stays closed.
//
// Two things this file deliberately does not decide, because no Phase 0 document decides them:
//
//   The complexity ceiling on `*.router.ts`. The constitution and lint-rules.md both say
//   "complexity ceiling" and name no number. The fixture therefore does not aim just past a
//   guessed threshold — it carries more than twenty independent decisions in one procedure,
//   which is over any ceiling a reviewer would defend. T036 picks the number.
//
//   The specifier the generated database client is imported by. The generator writes to
//   `node_modules/.prisma/client` (prisma/schema/base.prisma), and no repository file exists yet
//   to establish the import a repository actually writes. The fixture uses `@prisma/client`, the
//   canonical name; if T036 settles on a different specifier, this fixture follows it.
//
// R-API-6 is type-aware (research R-10), so its fixture is a real file under a TypeScript program
// — `tests/violations/fixtures/tsconfig.json` — rather than a string. The rule has to resolve the
// query target against packages/config/module-tables.json, and there is nothing to resolve in a
// string that no program has ever seen.

import { describeViolations, type ViolationCase } from './harness';

const layerViolations: readonly ViolationCase[] = [
  {
    constitutionId: 'R-API-1',
    ruleId: 'api/no-logic-in-router',
    ruleSet: 'fast',
    fixture: 'apps/api/src/surfaces/booking.router.ts',
    refuses: 'a router procedure deciding instead of dispatching to one service method',
  },
  {
    constitutionId: 'R-API-2',
    ruleId: 'api/no-orm-outside-repository',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/booking/booking.service.ts',
    refuses: 'the database client imported by a service rather than a repository',
  },
  {
    // `reviews` belongs to the reviews module in packages/config/module-tables.json; the
    // fixture queries it from booking's repository. The table is money-free on purpose, so
    // `boundaries/no-money-vocabulary` (R-MONEY-6) has nothing to say about the fixture and
    // this case cannot go green on the wrong rule once T035 lands.
    constitutionId: 'R-API-6',
    ruleId: 'api/table-ownership',
    ruleSet: 'typeAware',
    fixture: 'apps/api/src/modules/booking/booking.repository.ts',
    refuses: "one module's repository querying a table another module owns",
  },
  {
    // Added with T027 (PR for T027, 2026-09-09): the contract publishes `api/no-push-outside-job`
    // and no T020–T026 line named R-API-15, so the completeness check could never go green.
    // The fixture imports the push port's public entry, not an adapter, so `boundaries/
    // no-adapter-import` (R-API-4) stays silent and inline delivery is the only thing refused.
    constitutionId: 'R-API-15',
    ruleId: 'api/no-push-outside-job',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/booking/notify-inline.ts',
    refuses: 'a module sending a notification inline instead of enqueueing the delivery job',
  },
  {
    // Added with T026 (Phase 1, research R-116). The query is on `enrollments`, booking's table in
    // packages/config/module-tables.json, so `api/table-ownership` (R-API-6) has nothing to say.
    constitutionId: 'R-DB-3',
    ruleId: 'db/no-unfiltered-relation-read',
    ruleSet: 'fast',
    fixture: 'apps/api/src/modules/booking/enrollment-sessions.repository.ts',
    refuses: 'a relation to a soft-deletable model read with the deleted rows',
  },
];

describeViolations('T021 layer violations', layerViolations);
