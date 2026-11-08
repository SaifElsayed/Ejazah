// T011 of specs/004-sessions: the `sessions` namespace's first two procedures (contracts/app-surface.md,
// "`sessions`"; FR-431, FR-432, FR-434, FR-435). Thin: the participant kind, so an anonymous caller
// and a suspended or banned account are refused before the service is reached; the input
// validated, one service call with the session's own account, never anything the input says
// (R-GENDER-4), and the output parsed by its schema, which strips a field it does not name
// (R-HONEST-4). A session the caller is not a party of answers NOT_FOUND with no field. `join` is a
// mutation: it creates the provider's room. Mounted under `sessions` by `app.router.ts`.
import {
  sessionsGetInput,
  sessionsGetOutput,
  sessionsJoinInput,
  sessionsJoinOutput,
} from '@ijazah/contracts';

import { createAppRouter, participantProcedure } from '../../surfaces/procedures.js';

export const sessionsRouter = createAppRouter({
  get: participantProcedure({ input: sessionsGetInput, output: sessionsGetOutput }).query(
    ({ ctx, input }) => ctx.services.sessions.get({ userId: ctx.caller.userId }, input, ctx.log),
  ),

  join: participantProcedure({ input: sessionsJoinInput, output: sessionsJoinOutput }).mutation(
    ({ ctx, input }) => ctx.services.sessions.join({ userId: ctx.caller.userId }, input, ctx.log),
  ),
});
