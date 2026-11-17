// T009 of specs/005-certification: the `certificates` namespace (FR-607, FR-609; research R-412;
// contracts/app-surface.md, `certificates.list` and `certificates.link`; D1 (a), DEC-72). Thin: the
// participant kind, so an anonymous caller is UNAUTHENTICATED and a suspended or banned account
// `ACCOUNT_RESTRICTED` before the service; either role is a party (the student, the granting
// teacher), which the service decides from the session's own account, never the input (R-GENDER-4).
// Anyone else is NOT_FOUND in R-GENDER-2's one shape; `link` answers `not_ready` until the sign-off
// and `revoked` after a revocation, with no link (R-HONEST-6). Both under the signed-in default
// limit; the output parsed by its schema, which strips a field it does not name (R-SEC-3). Mounted
// under `certificates` by `app.router.ts` (the integration's line).
import {
  certificatesLinkInput,
  certificatesLinkOutput,
  certificatesListOutput,
} from '@ijazah/contracts';
import { z } from 'zod';

import { createAppRouter, participantProcedure } from '../../surfaces/procedures.js';

export const certificatesRouter = createAppRouter({
  list: participantProcedure({ input: z.void(), output: certificatesListOutput }).query(({ ctx }) =>
    ctx.services.certification.certificates.list(ctx.caller.userId),
  ),

  link: participantProcedure({
    input: certificatesLinkInput,
    output: certificatesLinkOutput,
  }).query(({ ctx, input }) =>
    ctx.services.certification.certificates.link(ctx.caller.userId, input),
  ),
});
