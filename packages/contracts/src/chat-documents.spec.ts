// T038 of specs/004-sessions — the chat documents' schemas of contracts/app-surface.md, "`chat`"
// (FR-489; R-SEC-3). Written before the schemas, and run red first.
//
// `POST /uploads/chat` takes two fields before its file, the enrollment and the document's name, and
// answers 201 with the message's id, its attachment (name and type, never a key) and its instant.
// `chat.attachmentLink` takes the message and answers a signed link and the instant it expires.
import { describe, expect, it } from 'vitest';

import {
  CHAT_FILENAME_MAX_LENGTH,
  chatAttachmentLinkInput,
  chatAttachmentLinkOutput,
  chatUploadFields,
  chatUploadOutput,
} from './chat.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000000e1';
const MESSAGE = '0199d0a0-0000-7000-8000-0000000000f1';
const SENT = '2026-11-11T10:00:00.000Z';

describe('POST /uploads/chat', () => {
  it('takes the enrollment and the name, trimmed', () => {
    expect(chatUploadFields.parse({ enrollmentId: ENROLLMENT, filename: '  تجويد.pdf ' })).toEqual({
      enrollmentId: ENROLLMENT,
      filename: 'تجويد.pdf',
    });
  });

  it.each([
    ['no name', { enrollmentId: ENROLLMENT }],
    ['a blank name', { enrollmentId: ENROLLMENT, filename: '   ' }],
    [
      'a name over the most characters',
      { enrollmentId: ENROLLMENT, filename: `${'ا'.repeat(CHAT_FILENAME_MAX_LENGTH)}.pdf` },
    ],
    ['a name with a path separator', { enrollmentId: ENROLLMENT, filename: '../a.pdf' }],
    ['a name with a backslash', { enrollmentId: ENROLLMENT, filename: 'c:\\a.pdf' }],
    ['a name with a control character', { enrollmentId: ENROLLMENT, filename: 'a\u0000.pdf' }],
    ['an enrollment that is not an id', { enrollmentId: 'mine', filename: 'a.pdf' }],
  ])('refuses %s', (_name, fields) => {
    expect(chatUploadFields.safeParse(fields).success).toBe(false);
  });

  it('answers the message, its attachment and its instant, stripping a key', () => {
    const answer = {
      messageId: MESSAGE,
      attachment: { filename: 'تجويد.pdf', mime: 'application/pdf' },
      sentAt: SENT,
    };
    expect(
      chatUploadOutput.parse({
        ...answer,
        attachmentKey: 'chat/x.pdf',
        attachment: { ...answer.attachment, key: 'chat/x.pdf' },
      }),
    ).toEqual(answer);
  });
});

describe('chat.attachmentLink', () => {
  it('takes the message', () => {
    expect(chatAttachmentLinkInput.parse({ messageId: MESSAGE })).toEqual({ messageId: MESSAGE });
    expect(chatAttachmentLinkInput.safeParse({ messageId: 'm1' }).success).toBe(false);
  });

  it('answers a link and its expiry', () => {
    const link = { url: 'https://files.invalid/chat/x.pdf?sig=1', expiresAt: SENT };
    expect(chatAttachmentLinkOutput.parse(link)).toEqual(link);
    expect(chatAttachmentLinkOutput.safeParse({ url: 'not a url', expiresAt: SENT }).success).toBe(
      false,
    );
  });
});
