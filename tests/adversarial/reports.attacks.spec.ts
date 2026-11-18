// T011 of specs/005-certification — `reports.create`'s attacks (`reports.attacks.ts`) run on their
// own, in both directions, until the integration mounts `reports` in `app.router.ts`; they then join
// `registered-attacks.ts` and the procedure harness's coverage, and this file goes (B46's
// `certificates.attacks.spec.ts` precedent).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { describeProcedureAttacks } from './procedure-harness.js';
import { reportsAttacks } from './reports.attacks.js';

describeProcedureAttacks(reportsAttacks);
