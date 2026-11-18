// T006 of specs/005-certification: the `teacher.ijazahRequests` namespace (FR-603, FR-608, FR-627;
// contracts/app-surface.md, `teacher.ijazahRequests.*`). Thin: the teacher kind, so an anonymous
// caller and a student are refused before the service and a suspended or banned account is
// `ACCOUNT_RESTRICTED`; `preview` and `send` admit an approved teacher, `get` any teacher-role
// holder (a request outlives the teacher's standing, FR-628); one service call with the session's own
// account, never anything the input says of a party (M3); the output parsed by its schema, which
// strips the copy's key and the frozen chain (R-SEC-3). `send` is keyed (`idempotencyKey`) and
// counted under `rate_limit_ijazah_request`, the teacher as subject, failing closed. Another
// teacher's enrollment answers NOT_FOUND (R-GENDER-2's shape). Mounted under
// `teacher.ijazahRequests` by `app.router.ts` (the integration's line).
import {
  ijazahRequestsGetInput,
  ijazahRequestsGetOutput,
  ijazahRequestsPreviewInput,
  ijazahRequestsPreviewOutput,
  ijazahRequestsSendInput,
  ijazahRequestsSendOutput,
} from '@ijazah/contracts';

import { createAppRouter, teacherProcedure } from '../../surfaces/procedures.js';

export const ijazahRequestsRouter = createAppRouter({
  preview: teacherProcedure({
    admits: 'approved',
    input: ijazahRequestsPreviewInput,
    output: ijazahRequestsPreviewOutput,
  }).query(({ ctx, input }) =>
    ctx.services.certification.ijazahRequests.preview(ctx.caller.userId, input),
  ),

  send: teacherProcedure({
    admits: 'approved',
    input: ijazahRequestsSendInput,
    output: ijazahRequestsSendOutput,
    rateLimit: { key: 'rate_limit_ijazah_request', subject: 'caller' },
  }).mutation(({ ctx, input }) =>
    ctx.services.certification.ijazahRequests.send(ctx.caller.userId, input, ctx.live),
  ),

  get: teacherProcedure({
    admits: 'applicant',
    input: ijazahRequestsGetInput,
    output: ijazahRequestsGetOutput,
  }).query(({ ctx, input }) =>
    ctx.services.certification.ijazahRequests.get(ctx.caller.userId, input),
  ),
});
