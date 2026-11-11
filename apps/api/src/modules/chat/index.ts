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

// T038 of specs/004-sessions: `POST /uploads/chat` (FR-489, FR-490; research R-314), the upload
// route's third use, which `main.ts` mounts at `CHAT_UPLOAD_PATH`.
export {
  CHAT_UPLOAD_PATH,
  type ChatUploadDependencies,
  createChatUploadRoute,
} from './chat-upload.controller.js';
