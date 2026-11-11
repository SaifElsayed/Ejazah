// T037 of specs/004-sessions — the `chat` schemas of contracts/app-surface.md, "`chat`" (FR-488,
// FR-491). Written before the schemas, and run red first.
//
// The caller names the enrollment and nothing else (R-GENDER-4). A page of messages is newest first
// with a cursor while more follow; a message carries `mine` and nothing of the counterparty, and
// never a storage key. A purged message carries neither its body nor its attachment. A message sent
// is 1 to 2000 characters, never blank, keyed by the kernel's idempotency key. `chatMessage` is its
// own schema, which T066's live `chat` event reuses.
import { describe, expect, it } from 'vitest';

import {
  CHAT_BODY_MAX_LENGTH,
  chatListInput,
  chatListOutput,
  chatMessage,
  chatSendInput,
  chatSendOutput,
} from './chat.js';
import { isIdempotentProcedure } from './idempotent-procedures.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const MESSAGE = '0199d0a0-0000-7000-8000-0000000000f1';
const KEY = 'chat-send-0199d0a0-0000-7000';
const SENT = '2026-11-11T10:00:00.000Z';

describe('chat.list', () => {
  it('takes the enrollment and an optional cursor', () => {
    expect(chatListInput.parse({ enrollmentId: ENROLLMENT })).toEqual({ enrollmentId: ENROLLMENT });
    expect(chatListInput.parse({ enrollmentId: ENROLLMENT, cursor: MESSAGE })).toEqual({
      enrollmentId: ENROLLMENT,
      cursor: MESSAGE,
    });
  });

  it.each([
    ['an enrollment that is not an id', { enrollmentId: 'mine' }],
    ['a cursor that is not an id', { enrollmentId: ENROLLMENT, cursor: 'page-2' }],
    ['no enrollment', {}],
  ])('refuses %s', (_name, input) => {
    expect(chatListInput.safeParse(input).success).toBe(false);
  });

  it('answers the messages and the cursor while more follow', () => {
    const page = {
      messages: [
        { messageId: MESSAGE, mine: true, body: 'السلام عليكم', sentAt: SENT, purged: false },
      ],
      nextCursor: MESSAGE,
    };
    expect(chatListOutput.parse(page)).toEqual(page);
    expect(chatListOutput.parse({ messages: [] })).toEqual({ messages: [] });
  });
});

describe('chatMessage, the item T066 reuses', () => {
  it('carries an attachment as its name and one of the two types', () => {
    for (const mime of ['application/pdf', 'text/plain'] as const) {
      const item = {
        messageId: MESSAGE,
        mine: false,
        attachment: { filename: 'تجويد.pdf', mime },
        sentAt: SENT,
        purged: false,
      };
      expect(chatMessage.parse(item)).toEqual(item);
    }
  });

  it('refuses an attachment of any other type', () => {
    expect(
      chatMessage.safeParse({
        messageId: MESSAGE,
        mine: false,
        attachment: { filename: 'photo.png', mime: 'image/png' },
        sentAt: SENT,
        purged: false,
      }).success,
    ).toBe(false);
  });

  it('strips a storage key and a sender a careless service might add', () => {
    expect(
      chatMessage.parse({
        messageId: MESSAGE,
        mine: false,
        attachment: { filename: 'a.pdf', mime: 'application/pdf', key: 'chat/x.pdf' },
        attachmentKey: 'chat/x.pdf',
        senderUserId: ENROLLMENT,
        sentAt: SENT,
        purged: false,
      }),
    ).toEqual({
      messageId: MESSAGE,
      mine: false,
      attachment: { filename: 'a.pdf', mime: 'application/pdf' },
      sentAt: SENT,
      purged: false,
    });
  });

  it('carries a purged message with no body and no attachment', () => {
    const purged = { messageId: MESSAGE, mine: true, sentAt: SENT, purged: true };
    expect(chatMessage.parse(purged)).toEqual(purged);
  });
});

describe('chat.send', () => {
  it('takes the enrollment, the body trimmed and the idempotency key', () => {
    expect(
      chatSendInput.parse({
        enrollmentId: ENROLLMENT,
        body: '  جزاك الله خيرا  ',
        idempotencyKey: KEY,
      }),
    ).toEqual({ enrollmentId: ENROLLMENT, body: 'جزاك الله خيرا', idempotencyKey: KEY });
  });

  it('takes a body of exactly the most characters', () => {
    const body = 'ا'.repeat(CHAT_BODY_MAX_LENGTH);
    expect(chatSendInput.parse({ enrollmentId: ENROLLMENT, body, idempotencyKey: KEY }).body).toBe(
      body,
    );
  });

  it.each([
    ['an empty body', { enrollmentId: ENROLLMENT, body: '', idempotencyKey: KEY }],
    ['a blank body', { enrollmentId: ENROLLMENT, body: '  \n ', idempotencyKey: KEY }],
    [
      'a body over 2000 characters',
      { enrollmentId: ENROLLMENT, body: 'ا'.repeat(CHAT_BODY_MAX_LENGTH + 1), idempotencyKey: KEY },
    ],
    ['no idempotency key', { enrollmentId: ENROLLMENT, body: 'سلام' }],
    ['a short idempotency key', { enrollmentId: ENROLLMENT, body: 'سلام', idempotencyKey: 'k1' }],
    ['an enrollment that is not an id', { enrollmentId: 'x', body: 'سلام', idempotencyKey: KEY }],
  ])('refuses %s', (_name, input) => {
    expect(chatSendInput.safeParse(input).success).toBe(false);
  });

  it('answers the message as the list shows it', () => {
    const sent = { messageId: MESSAGE, mine: true, body: 'سلام', sentAt: SENT, purged: false };
    expect(chatSendOutput.parse(sent)).toEqual(sent);
  });

  it('is a keyed procedure of the user surface', () => {
    expect(CHAT_BODY_MAX_LENGTH).toBe(2000);
    expect(isIdempotentProcedure('chat.send')).toBe(true);
  });
});
