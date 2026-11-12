// T045 of specs/004-sessions (FR-427, FR-488; contracts/app-surface.md, `chat` and `live`): the chat's
// messages as both roles see them. A `chat` event of the live channel is merged into the open chat's
// first page by `messageId`: a message already there is not added twice, and one that arrives out
// of order takes its place by `sentAt`, newest first as `chat.list` answers (a tie by `messageId`,
// UUID v7, time-ordered). The first page and the older pages are shown as one list, each message
// once. The chat is written in only while the enrollment is `confirmed`; it is read from its
// confirmation, read-only once the enrollment has ended (FR-488).
import type { ChatListOutput, ChatMessage, EnrollmentStatus } from '@ijazah/contracts';
import { describe, expect, it } from '@jest/globals';

import {
  chatMessagesOf,
  chatReachable,
  chatWritable,
  mergeChatMessage,
  messageOfUpload,
} from './messages';

const id = (n: number) => `0193a6f0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;

function message(n: number, sentAt: string, of: Partial<ChatMessage> = {}): ChatMessage {
  return { messageId: id(n), mine: false, body: `رسالة ${n}`, sentAt, purged: false, ...of };
}

const TEN = message(10, '2026-11-12T10:00:00.000Z');
const ELEVEN = message(11, '2026-11-12T11:00:00.000Z');
const TWELVE = message(12, '2026-11-12T12:00:00.000Z');

const page = (messages: ChatMessage[], nextCursor?: string): ChatListOutput =>
  nextCursor === undefined ? { messages } : { messages, nextCursor };

const ids = (listed: { readonly messages: readonly ChatMessage[] } | readonly ChatMessage[]) =>
  ('messages' in listed ? listed.messages : listed).map(({ messageId }) => messageId);

describe('mergeChatMessage (T045)', () => {
  it('puts a new message at the head of the first page, newest first', () => {
    const thirteen = message(13, '2026-11-12T13:00:00.000Z', { mine: true });
    expect(ids(mergeChatMessage(page([TWELVE, ELEVEN]), thirteen))).toEqual([
      id(13),
      id(12),
      id(11),
    ]);
  });

  it('never adds a message already there twice, a duplicate event leaving the page as it is', () => {
    const first = page([TWELVE, ELEVEN, TEN], id(10));
    const merged = mergeChatMessage(mergeChatMessage(first, ELEVEN), { ...TWELVE });
    expect(ids(merged)).toEqual([id(12), id(11), id(10)]);
    expect(merged.nextCursor).toBe(id(10));
  });

  it('places an event that arrives out of order by its sentAt', () => {
    const merged = mergeChatMessage(page([TWELVE, TEN]), ELEVEN);
    expect(ids(merged)).toEqual([id(12), id(11), id(10)]);
  });

  it('orders two messages of the same instant by their id, the later id first', () => {
    const same = '2026-11-12T11:00:00.000Z';
    const merged = mergeChatMessage(page([message(14, same), TEN]), message(13, same));
    expect(ids(merged)).toEqual([id(14), id(13), id(10)]);
  });

  it('puts an event older than the whole page at its end, the cursor kept', () => {
    const merged = mergeChatMessage(page([TWELVE, ELEVEN], id(11)), TEN);
    expect(ids(merged)).toEqual([id(12), id(11), id(10)]);
    expect(merged.nextCursor).toBe(id(11));
  });

  it('leaves the page it was given unchanged', () => {
    const first = page([TWELVE, TEN]);
    mergeChatMessage(first, ELEVEN);
    expect(ids(first)).toEqual([id(12), id(10)]);
  });
});

describe('chatMessagesOf (T045)', () => {
  it('shows the first page then the older pages, newest first, each message once', () => {
    const shown = chatMessagesOf(page([TWELVE, ELEVEN], id(11)), [page([ELEVEN, TEN])]);
    expect(ids(shown)).toEqual([id(12), id(11), id(10)]);
  });
});

describe('messageOfUpload (T045)', () => {
  it('is the caller’s own message holding the document, with no body', () => {
    expect(
      messageOfUpload({
        messageId: id(15),
        attachment: { filename: 'ملاحظات.txt', mime: 'text/plain' },
        sentAt: '2026-11-12T15:00:00.000Z',
      }),
    ).toEqual({
      messageId: id(15),
      mine: true,
      attachment: { filename: 'ملاحظات.txt', mime: 'text/plain' },
      sentAt: '2026-11-12T15:00:00.000Z',
      purged: false,
    });
  });
});

describe('the chat by the enrollment’s status (FR-488)', () => {
  const statuses: readonly EnrollmentStatus[] = [
    'pending_payment',
    'confirmed',
    'completed',
    'terminated_no_show',
    'cancelled',
  ];

  it('is written in only while the enrollment is confirmed: read-only once it has ended', () => {
    expect(statuses.filter(chatWritable)).toEqual(['confirmed']);
  });

  it('is reached from the confirmation: never while the enrollment awaits payment', () => {
    expect(statuses.filter(chatReachable)).toEqual([
      'confirmed',
      'completed',
      'terminated_no_show',
      'cancelled',
    ]);
  });
});
