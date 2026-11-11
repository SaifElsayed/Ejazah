// PUBLIC ENTRY of the chat module (T017). Other modules import this file and nothing below it (R-API-3).
export {};

/**
 * T039 of specs/004-sessions (FR-492, R-314): the chat purge `jobs/purge-chat.ts` runs daily, each
 * enrollment due purged under its lock, its files removed after the commit and retried by the next
 * run; its store, over chat's queries and the owners' entries, for the database spec.
 */
export {
  CHAT_RETENTION_SETTING,
  type ChatPurge,
  type ChatPurgeDependencies,
  type ChatPurged,
  type ChatPurgeStore,
  chatPurgeStore,
  chatRetentionDays,
  createChatPurge,
} from './purge.service.js';
export type { HeldChatFile, PurgedMessages } from './purge.repository.js';
