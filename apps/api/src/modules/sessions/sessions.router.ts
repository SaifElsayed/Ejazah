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
// "`sessions.cancellation`"); T066: each hands the service the request's after-commit list
// (`ctx.live`), which the kind sends once the handler resolves and drops when it throws. T026:
// `sessions.dispute.raise`, below. T031 and T032: `sessions.remedy`, below.
import {
  sessionsCancellationAnswerInput,
  sessionsCancellationAnswerOutput,
  sessionsCancellationRequestInput,
  sessionsCancellationRequestOutput,
  sessionsComplaintRaiseInput,
  sessionsComplaintRaiseOutput,
  sessionsDisputeRaiseInput,
  sessionsDisputeRaiseOutput,
  sessionsGetInput,
  sessionsGetOutput,
  sessionsJoinInput,
  sessionsJoinOutput,
  sessionsRemedyAcceptInput,
  sessionsRemedyAcceptOutput,
  sessionsRemedyAnswerCounterInput,
  sessionsRemedyAnswerCounterOutput,
  sessionsRemedyChooseInput,
  sessionsRemedyChooseOutput,
  sessionsRemedyCounterInput,
  sessionsRemedyCounterOptionsInput,
  sessionsRemedyCounterOptionsOutput,
  sessionsRemedyCounterOutput,
} from '@ijazah/contracts';

import { createAppRouter, participantProcedure } from '../../surfaces/procedures.js';

// T060 (contracts/app-surface.md, "`sessions.complaint`"; FR-452; the note under T060, F2):
// `sessions.complaint.raise`, a mutation of the participant kind, the service deciding the caller
// is the enrollment's student, under its own declared limit, `rate_limit_absence_complaint`, the
// student as subject, applied by the kind after the input and before any transaction, apart from
// the one-open rule (R-321, item 6). The caller's own account and the input handed to one call.
const complaintRouter = createAppRouter({
  raise: participantProcedure({
    input: sessionsComplaintRaiseInput,
    output: sessionsComplaintRaiseOutput,
    rateLimit: { key: 'rate_limit_absence_complaint', subject: 'caller' },
  }).mutation(({ ctx, input }) =>
    ctx.services.sessions.complaint.raise({ userId: ctx.caller.userId }, input, ctx.log),
  ),
});

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

// T031 (contracts/app-surface.md, "`sessions.remedy`"; FR-463 to FR-466): the student's four, the
// participant kind (the teacher's refusal is the service's `NOT_FOUND`), with no limit of their own
// (the signed-in default counts them, T062); `counterOptions` a read, the other three mutations,
// `counter` keyed by the client's idempotency key. The caller's own account and the input handed to
// one service call each.
const remedyRouter = createAppRouter({
  choose: participantProcedure({
    input: sessionsRemedyChooseInput,
    output: sessionsRemedyChooseOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.sessions.remedy.choose({ userId: ctx.caller.userId }, input, ctx.log),
  ),
  accept: participantProcedure({
    input: sessionsRemedyAcceptInput,
    output: sessionsRemedyAcceptOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.sessions.remedy.accept({ userId: ctx.caller.userId }, input, ctx.log),
  ),
  counterOptions: participantProcedure({
    input: sessionsRemedyCounterOptionsInput,
    output: sessionsRemedyCounterOptionsOutput,
  }).query(({ ctx, input }) =>
    ctx.services.sessions.remedy.counterOptions({ userId: ctx.caller.userId }, input, ctx.log),
  ),
  counter: participantProcedure({
    input: sessionsRemedyCounterInput,
    output: sessionsRemedyCounterOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.sessions.remedy.counter({ userId: ctx.caller.userId }, input, ctx.log),
  ),
  // T032: the teacher's answer to the pending counter-proposal, a mutation of the same kind (the
  // student's refusal is the service's `NOT_FOUND`).
  answerCounter: participantProcedure({
    input: sessionsRemedyAnswerCounterInput,
    output: sessionsRemedyAnswerCounterOutput,
  }).mutation(({ ctx, input }) =>
    ctx.services.sessions.remedy.answerCounter({ userId: ctx.caller.userId }, input, ctx.log),
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
      ctx.services.sessions.cancellation.request(
        { userId: ctx.caller.userId },
        input,
        ctx.log,
        ctx.live,
      ),
    ),
    answer: participantProcedure({
      input: sessionsCancellationAnswerInput,
      output: sessionsCancellationAnswerOutput,
    }).mutation(({ ctx, input }) =>
      ctx.services.sessions.cancellation.answer(
        { userId: ctx.caller.userId },
        input,
        ctx.log,
        ctx.live,
      ),
    ),
  }),

  // T026.
  dispute: disputeRouter,

  // T031.
  remedy: remedyRouter,

  // T060.
  complaint: complaintRouter,
});
