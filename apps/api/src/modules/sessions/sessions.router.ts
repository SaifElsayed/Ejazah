// T011 of specs/004-sessions: the `sessions` namespace's first two procedures (contracts/app-surface.md,
// "`sessions`"; FR-431, FR-432, FR-434, FR-435). Thin: the participant kind, so an anonymous caller
// and a suspended or banned account are refused before the service is reached; the input
// validated, one service call with the session's own account, never anything the input says
// (R-GENDER-4), and the output parsed by its schema, which strips a field it does not name
// (R-HONEST-4). A session the caller is not a party of answers NOT_FOUND with no field. `join` is a
// mutation: it creates the provider's room. Mounted under `sessions` by `app.router.ts`.
//
// T021: `sessions.cancellation.request` (keyed by the kernel's idempotency) and `.answer`, the same
// kind, one service call each with the caller's own account (contracts/app-surface.md,
// "`sessions.cancellation`"). T026: `sessions.dispute.raise`, below.
import {
  sessionsCancellationAnswerInput,
  sessionsCancellationAnswerOutput,
  sessionsCancellationRequestInput,
  sessionsCancellationRequestOutput,
  sessionsDisputeRaiseInput,
  sessionsDisputeRaiseOutput,
  sessionsGetInput,
  sessionsGetOutput,
  sessionsJoinInput,
  sessionsJoinOutput,
} from '@ijazah/contracts';

import { createAppRouter, participantProcedure } from '../../surfaces/procedures.js';

// T026 (contracts/app-surface.md, "`sessions.dispute`"; FR-473, FR-474): `sessions.dispute.raise`,
// a keyed mutation of the participant kind, with no limit of its own (the signed-in default counts
// it, T062); the caller's own account and the input handed to one service call.
const disputeRouter = createAppRouter({
  raise: participantProcedure({
    input: sessionsDisputeRaiseInput,
    output: sessionsDisputeRaiseOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.sessions.raiseDispute({ userId: ctx.caller.userId }, input, ctx.log),
  ),
});

export const sessionsRouter = createAppRouter({
  get: participantProcedure({ input: sessionsGetInput, output: sessionsGetOutput }).query(
    ({ ctx, input }) => ctx.services.sessions.get({ userId: ctx.caller.userId }, input, ctx.log),
  ),

  join: participantProcedure({ input: sessionsJoinInput, output: sessionsJoinOutput }).mutation(
    ({ ctx, input }) => ctx.services.sessions.join({ userId: ctx.caller.userId }, input, ctx.log),
  ),

  // T021.
  cancellation: createAppRouter({
    request: participantProcedure({
      input: sessionsCancellationRequestInput,
      output: sessionsCancellationRequestOutput,
    }).mutation(({ ctx, input }) =>
      ctx.services.sessions.cancellation.request({ userId: ctx.caller.userId }, input, ctx.log),
    ),
    answer: participantProcedure({
      input: sessionsCancellationAnswerInput,
      output: sessionsCancellationAnswerOutput,
    }).mutation(({ ctx, input }) =>
      ctx.services.sessions.cancellation.answer({ userId: ctx.caller.userId }, input, ctx.log),
    ),
  }),

  // T026.
  dispute: disputeRouter,
});
