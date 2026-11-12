// T045 of specs/004-sessions (FR-427, FR-488 to FR-491; contracts/app-surface.md, `chat` and `live`;
// research R-324): the chat's reads and writes, the same for both roles (R-MOBILE-3).
//
// THE PAGES. `chat.list` answers `chat_page_size` messages newest first and `nextCursor` while older
// ones follow. The first page is its own query, under `chatFirstPageKey`, the one the live channel
// reads again on each (re)start (`LIVE_QUERY_ROOTS`, lib/live-channel.ts) and the one `chat` events
// merge into; the older pages are an infinite query from the first page's cursor, read only on the
// person's ask and never again by the channel, since no event changes them. When the first page is
// read again and its cursor moves, the older pages start afresh from the new cursor, so no message
// falls between them. Both keys hold the enrollment inside an object, so a `session` or
// `enrollment` signal, which reads the screens whose keys name its ids (`keyHoldsAny`), never reads
// the chat: its messages come carried, not signalled (the `chat` row of app-surface.md's `live`).
//
// THE MERGE. While a chat is open its merge is one of the channel's open chats (`onChatEvent`); an
// event of its enrollment, the answer to the person's own send and the message an upload became are
// all placed in the first page by `messageId` (`mergeChatMessage`), each once. A message that comes
// while the first page is not read yet, or is being read, reads the page again rather than being
// placed in an answer about to replace it.
//
// THE WRITES. `chat.send` takes a fresh idempotency key per text, the same key when the same text is
// sent again after a failure, and a new one once it has gone or the text has changed (the kernel
// refuses a key reused for another request). A failed send keeps its text where the person typed
// it; there is no «لم تُرسل» retry (the owner's decision of 2026-11-12, Q4). A document goes through
// `POST /uploads/chat` (lib/client.ts), the server deciding its type by content. A refusal
// `CHAT_CLOSED` reads the enrollment's screens again, so the screen becomes read-only as the server
// holds it. A document opens through `chat.attachmentLink`'s signed link in the system's browser.
import {
  CHAT_BODY_MAX_LENGTH,
  type ChatListOutput,
  chatListInput,
  type ChatMessage,
} from '@ijazah/contracts';
import {
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { openBrowserAsync } from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';
import { keyHoldsAny, onChatEvent } from '../../../lib/live-channel';
import { chatErrorMessage } from './errors';
import { chatMessagesOf, mergeChatMessage, messageOfUpload } from './messages';
import { pickChatDocument } from './pick';

/** The open chat's first page: the channel's (re)start reads it again (lib/live-channel.ts). */
export const chatFirstPageKey = (enrollmentId: string) =>
  ['chat', 'first', { enrollmentId }] as const;

/** The pages older than the first page's `cursor`, read on the person's ask. */
export const chatOlderPagesKey = (enrollmentId: string, cursor: string | undefined) =>
  ['chat', 'older', { enrollmentId, cursor }] as const;

/** Whether `enrollmentId` can name an enrollment at all (the procedure's own input). */
function isChatEnrollmentId(enrollmentId: string): boolean {
  return chatListInput.safeParse({ enrollmentId }).success;
}

/** Places `message` in the enrollment's first page, or reads the page again when it cannot. */
function placeMessage(queries: QueryClient, enrollmentId: string, message: ChatMessage): void {
  const key = chatFirstPageKey(enrollmentId);
  const state = queries.getQueryState<ChatListOutput>(key);
  if (state?.data === undefined || state.fetchStatus === 'fetching') {
    void queries.invalidateQueries({ queryKey: key, exact: true });
    return;
  }
  queries.setQueryData<ChatListOutput>(key, (first) =>
    first === undefined ? first : mergeChatMessage(first, message),
  );
}

/** What the chat shows of its pages. */
export interface ChatPages {
  /** The first page has been read. */
  readonly loaded: boolean;
  /** Newest first, each message once. */
  readonly messages: readonly ChatMessage[];
  /** The first page's read failed, with its error. */
  readonly failed: boolean;
  readonly error: unknown;
  retry(): void;
  /** Older messages follow the ones shown. */
  readonly hasOlder: boolean;
  readonly loadingOlder: boolean;
  /** The last read of an older page failed, with its error; null otherwise. */
  readonly olderError: unknown;
  loadOlder(): void;
}

/** The enrollment's chat, page by page, with the channel's `chat` events merged in. */
export function useChatPages(enrollmentId: string): ChatPages {
  const { client } = useApi();
  const queries = useQueryClient();
  const valid = isChatEnrollmentId(enrollmentId);
  const first = useQuery<ChatListOutput>({
    queryKey: chatFirstPageKey(enrollmentId),
    queryFn: () => client.api.chat.list.query({ enrollmentId }),
    enabled: valid,
  });
  const cursor = first.data?.nextCursor;
  const older = useInfiniteQuery({
    queryKey: chatOlderPagesKey(enrollmentId, cursor),
    queryFn: ({ pageParam }): Promise<ChatListOutput> =>
      client.api.chat.list.query({ enrollmentId, cursor: pageParam }),
    initialPageParam: cursor ?? '',
    getNextPageParam: (last) => last.nextCursor,
    // Read only when the person asks for older messages (`loadOlder`), never by itself.
    enabled: false,
  });
  useEffect(
    () =>
      onChatEvent((event) => {
        if (event.enrollmentId === enrollmentId) placeMessage(queries, enrollmentId, event.message);
      }),
    [queries, enrollmentId],
  );
  const hasOlder = cursor !== undefined && (older.data === undefined || older.hasNextPage);
  return {
    loaded: first.data !== undefined,
    messages: chatMessagesOf(first.data, older.data?.pages ?? []),
    failed: !valid || first.isError,
    error: first.error,
    retry: () => {
      if (valid) void first.refetch();
    },
    hasOlder,
    loadingOlder: older.isFetching,
    olderError: older.isError ? older.error : null,
    loadOlder: () => {
      if (hasOlder && !older.isFetching) void older.fetchNextPage();
    },
  };
}

/** An action's state: on its way, and the words of its last failure. */
export interface ChatAction {
  readonly busy: boolean;
  readonly error: ErrorMessage | null;
}

/** After a refusal `CHAT_CLOSED`, the enrollment's screens read again: the server has closed it. */
function useClosedReread(enrollmentId: string): (error: unknown) => void {
  const queries = useQueryClient();
  return (error) => {
    if (errorCodeOf(error) !== 'CHAT_CLOSED') return;
    void queries.invalidateQueries({
      predicate: (query) => keyHoldsAny(query.queryKey, [enrollmentId]),
    });
  };
}

export interface ChatSend extends ChatAction {
  /** Whether `body` can be sent at all: 1 to 2000 characters once trimmed (the contract's). */
  canSend(body: string): boolean;
  /** Sends `body`; true once it has gone, false when it was refused or never reached the server. */
  send(body: string): Promise<boolean>;
}

/** `chat.send` on the enrollment, keyed per text. */
export function useChatSend(enrollmentId: string): ChatSend {
  const { client } = useApi();
  const queries = useQueryClient();
  const closed = useClosedReread(enrollmentId);
  const pending = useRef<{ readonly key: string; readonly body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);
  const canSend = (body: string) => {
    const trimmed = body.trim();
    return trimmed.length > 0 && trimmed.length <= CHAT_BODY_MAX_LENGTH;
  };
  return {
    busy,
    error,
    canSend,
    async send(body) {
      const trimmed = body.trim();
      if (!canSend(trimmed)) return false;
      if (pending.current?.body !== trimmed) pending.current = { key: randomUUID(), body: trimmed };
      const { key } = pending.current;
      setBusy(true);
      setError(null);
      try {
        const sent = await client.api.chat.send.mutate({
          enrollmentId,
          body: trimmed,
          idempotencyKey: key,
        });
        pending.current = null;
        placeMessage(queries, enrollmentId, sent);
        return true;
      } catch (caught: unknown) {
        setError(chatErrorMessage(caught));
        closed(caught);
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

/** A PDF or a text document the person picks, sent to the enrollment's chat. */
export function useChatAttach(enrollmentId: string): ChatAction & { attach(): Promise<void> } {
  const { client } = useApi();
  const queries = useQueryClient();
  const closed = useClosedReread(enrollmentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);
  return {
    busy,
    error,
    async attach() {
      const picked = await pickChatDocument();
      if (picked === null) return;
      setBusy(true);
      setError(null);
      try {
        const uploaded = await client.uploadChatDocument(enrollmentId, picked.name, picked);
        placeMessage(queries, enrollmentId, messageOfUpload(uploaded));
      } catch (caught: unknown) {
        setError(chatErrorMessage(caught));
        closed(caught);
      } finally {
        setBusy(false);
      }
    },
  };
}

/** A message's document, opened through its signed link (R-SEC-3). */
export function useOpenAttachment(): ChatAction & { open(messageId: string): Promise<void> } {
  const { client } = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorMessage | null>(null);
  return {
    busy,
    error,
    async open(messageId) {
      setBusy(true);
      setError(null);
      try {
        const link = await client.api.chat.attachmentLink.query({ messageId });
        await openBrowserAsync(link.url);
      } catch (caught: unknown) {
        setError(genericErrorKey(caught, 'common.state.actionError'));
      } finally {
        setBusy(false);
      }
    },
  };
}
