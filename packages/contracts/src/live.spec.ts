// T063 of specs/004-sessions — the live channel's events (contracts/app-surface.md, "`live`";
// research R-324, item 4): a discriminated union on `type`, a signal carrying its ids and nothing
// else, so a field a producer adds by mistake (a message body, a name) is stripped before it is sent.
// T066: the `chat` member, `{ enrollmentId, message }`, the message in `chat.list`'s item shape.
import { describe, expect, it } from 'vitest';

import { liveEvent } from './live.js';

const SESSION = '0199d0a0-0000-7000-8000-0000000051a1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e1a1';
const MESSAGE = '0199d0a0-0000-7000-8000-00000000f1a1';
const SENT_AT = '2026-11-11T10:00:00.000Z';

describe('liveEvent (T063)', () => {
  it('parses each of its three members', () => {
    for (const event of [
      { type: 'session', sessionId: SESSION, enrollmentId: ENROLLMENT },
      { type: 'enrollment', enrollmentId: ENROLLMENT },
      { type: 'account' },
    ]) {
      expect(liveEvent.parse(event)).toEqual(event);
    }
  });

  it('strips every field a member does not name', () => {
    expect(
      liveEvent.parse({ type: 'enrollment', enrollmentId: ENROLLMENT, body: 'a message', name: 'x' }),
    ).toEqual({ type: 'enrollment', enrollmentId: ENROLLMENT });
    expect(liveEvent.parse({ type: 'account', userId: SESSION })).toEqual({ type: 'account' });
  });

  it('refuses an unknown type, a missing id and an id that is not one', () => {
    expect(liveEvent.safeParse({ type: 'other', enrollmentId: ENROLLMENT }).success).toBe(false);
    expect(liveEvent.safeParse({ type: 'session', sessionId: SESSION }).success).toBe(false);
    expect(liveEvent.safeParse({ type: 'enrollment', enrollmentId: 'not an id' }).success).toBe(
      false,
    );
  });
});

describe('liveEvent: the chat member (T066, R-324 item 4)', () => {
  const message = {
    messageId: MESSAGE,
    mine: false,
    body: 'السلام عليكم',
    sentAt: SENT_AT,
    purged: false,
  };

  it('parses a message in chat.list’s item shape, a document’s name and type included', () => {
    const text = { type: 'chat', enrollmentId: ENROLLMENT, message };
    expect(liveEvent.parse(text)).toEqual(text);
    const document = {
      type: 'chat',
      enrollmentId: ENROLLMENT,
      message: {
        messageId: MESSAGE,
        mine: true,
        attachment: { filename: 'واجب.pdf', mime: 'application/pdf' },
        sentAt: SENT_AT,
        purged: false,
      },
    };
    expect(liveEvent.parse(document)).toEqual(document);
  });

  it('strips what the message does not name: never a storage key, never a sender', () => {
    expect(
      liveEvent.parse({
        type: 'chat',
        enrollmentId: ENROLLMENT,
        message: { ...message, attachmentKey: 'chat/x.pdf', senderUserId: MESSAGE },
        userId: MESSAGE,
      }),
    ).toEqual({ type: 'chat', enrollmentId: ENROLLMENT, message });
  });

  it('refuses a chat event with no message, no enrollment, or a message missing `mine`', () => {
    expect(liveEvent.safeParse({ type: 'chat', enrollmentId: ENROLLMENT }).success).toBe(false);
    expect(liveEvent.safeParse({ type: 'chat', message }).success).toBe(false);
    const { mine: _mine, ...withoutMine } = message;
    expect(
      liveEvent.safeParse({ type: 'chat', enrollmentId: ENROLLMENT, message: withoutMine }).success,
    ).toBe(false);
  });
});
