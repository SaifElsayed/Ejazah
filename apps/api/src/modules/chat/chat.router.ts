// T037 of specs/004-sessions: the `chat` namespace's `chat.list` and `chat.send`
// (contracts/app-surface.md, "`chat`"; FR-488, FR-491). Thin: the participant kind, so an anonymous
// caller and a suspended or banned account are refused before the service is reached; the input
// validated, one service call with the caller's own account, never anything the input says
// (R-GENDER-4), and the output parsed by its schema, which strips a field it does not name.
// `chat.send` is keyed by the kernel's idempotency in the service and counted under its own limit,
// `rate_limit_chat_message`, per caller (FR-491); `chat.list` under the signed-in default (T062).
// Mounted under `chat` by `app.router.ts`.
import { chatListInput, chatListOutput, chatSendInput, chatSendOutput } from '@ijazah/contracts';

import type { RateLimitKey } from '../../platform/guards/rate-limit.guard.js';
import { createAppRouter, participantProcedure } from '../../surfaces/procedures.js';

/** The settings key of the chat message limit (SRS §3.14 «Chat message rate limit», FR-491). */
export const CHAT_MESSAGE_RATE_LIMIT = 'rate_limit_chat_message' satisfies RateLimitKey;

export const chatRouter = createAppRouter({
  list: participantProcedure({ input: chatListInput, output: chatListOutput }).query(
    ({ ctx, input }) => ctx.services.chat.list({ userId: ctx.caller.userId }, input, ctx.log),
  ),

  send: participantProcedure({
    input: chatSendInput,
    output: chatSendOutput,
    rateLimit: { key: CHAT_MESSAGE_RATE_LIMIT, subject: 'caller' },
  }).mutation(({ ctx, input }) =>
    ctx.services.chat.send({ userId: ctx.caller.userId }, input, ctx.log),
  ),
});
