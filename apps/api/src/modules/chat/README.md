# chat

## Owns

`chat_messages`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Sit behind a port; it is built in-house (ARCHITECTURE section 3.2). Accept an attachment without content sniffing (R-SEC-4).

## Shape

`chat.service.ts` holds every rule. `chat.repository.ts` holds every query. `chat.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

`SRS-CHT-*`: FR-SESS-6, FR-SESS-7, FR-SESS-8, FR-SESS-13 (SRS §2 traceability).

- FR-488, FR-491, FR-499, R-GENDER-1/2 (`chat.list`, newest first in keyset pages of `chat_page_size`, readable until purged, never a storage key, read with no lock; `chat.send` by a party of a `confirmed` enrollment, 1 to 2000 characters, keyed, under `rate_limit_chat_message`, `CHAT_CLOSED` otherwise, the sender's `users` row and the enrollment locked first; the other gender by the server's records answers `NOT_FOUND`; T037 of specs/004-sessions): `chat.service.ts`, `chat.repository.ts`, `chat.router.ts`.
- FR-489, FR-490, R-SEC-3, R-SEC-4, R-SEC-5, SC-408 (`POST /uploads/chat`, the upload route's third use: a PDF or UTF-8 text by content, any image refused by content or extension, an SVG included; `chat.attachmentLink`, a signed link valid `document_link_ttl_seconds`; T038 of specs/004-sessions): `chat-upload.controller.ts`, `chat.service.ts`, the `chat` kind in `platform/guards/upload.middleware.ts`.
- FR-492, FR-SESS-13 (`purge-chat`'s rules: an ended enrollment's chat once its last disputable session's end plus `dispute_window_hours` and `chat_retention_days` has passed with nothing open on it, under the enrollment's lock, the key kept until its file is removed; T039 of specs/004-sessions): `purge.service.ts`, `purge.repository.ts`.
- FR-475 (the chat page an administrator reads inside an open matter, with the sender's role, through sessions' `DisputeChat` port; T040 of specs/004-sessions): `dispute-chat.ts`.
