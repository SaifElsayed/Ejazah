// T013 of specs/005-certification — `genderFlags.raise`'s attacks (`gender-flags.attacks.ts`) run on
// their own, in both directions, until the integration mounts `genderFlags` in `app.router.ts`; they
// then join `registered-attacks.ts` and the procedure harness's coverage, and this file goes (lane A's
// `reports.attacks.spec.ts` precedent, B46's `certificates.attacks.spec.ts`).
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { describeProcedureAttacks } from './procedure-harness.js';
import { genderFlagsAttacks } from './gender-flags.attacks.js';

describeProcedureAttacks(genderFlagsAttacks);
