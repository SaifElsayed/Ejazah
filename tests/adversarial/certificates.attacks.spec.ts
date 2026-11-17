// T009 of specs/005-certification — `certificates.list` and `certificates.link` attacked in both
// directions (`certificates.attacks.ts`; contracts/app-surface.md, «Adversarial suite»; R-413).
// They join `registeredAttacks` (`registered-attacks.ts`) in the integration's commit that mounts
// `certificates` in `app.router.ts`: until then the harness's coverage, which reads the real
// `appRouter`, would list them as harness entries no surface serves. Until that commit they run
// here, as `ijazah-requests.attacks.spec.ts` runs T006's.
// @module-tag database (T124: skipped unless IJAZAH_DB_SPECS=1)
import { certificatesAttacks } from './certificates.attacks.js';
import { describeProcedureAttacks } from './procedure-harness.js';

describeProcedureAttacks(certificatesAttacks);
