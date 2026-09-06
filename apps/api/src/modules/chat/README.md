# chat

## Owns

`chat_messages`

Listed in `packages/config/module-tables.json`. Reaching a table outside this list fails the build citing R-API-6.

## Never

Sit behind a port; it is built in-house (ARCHITECTURE section 3.2). Accept an attachment without content sniffing (R-SEC-4).

## Shape

`chat.service.ts` holds every rule. `chat.repository.ts` holds every query. `chat.router.ts` is thin: validate, call one service method, return. `index.ts` is the only import path. Arrives with the phase that first needs it (see PLAN.md).

## Requirement ids

_Filled as SRS requirements land in this module._
