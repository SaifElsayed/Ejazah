// PUBLIC ENTRY of the chat module (T017). Other modules import this file and nothing below it (R-API-3).
export {};

// T037 of specs/004-sessions: `chat.list` and `chat.send` (FR-488, FR-491; research R-314), the
// router `app.router.ts` mounts under `chat` and the services `main.ts` composes over booking's
// `createEnrollmentSide()` (R-301) and the kernel's idempotency.
export { CHAT_MESSAGE_RATE_LIMIT, chatRouter } from './chat.router.js';
export {
  CHAT_PAGE_SIZE_SETTING,
  type ChatDependencies,
  type ChatEnrollments,
  type ChatEnrollmentTerms,
  type ChatServices,
  createChatServices,
} from './chat.service.js';

// T040 of specs/004-sessions: the binding of sessions' `DisputeChat` port (`disputes.chat`; FR-475,
// research R-301, R-314), which `main.ts` hands the administrator's services.
export { createDisputeChat, type DisputeChatDependencies } from './dispute-chat.js';
