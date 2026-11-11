// T040 of specs/004-sessions/tasks.md (FR-475; research R-301, R-314; contracts/kernel.md, "The
// composition root") — chat's `createDisputeChat()`, the binding of sessions' `DisputeChat` port,
// over a recorded `ChatEnrollments` and a recorded `messagePage`:
//
//   - the page `chat.list` answers: `chat_page_size` messages newest first, keyset on the cursor,
//     `nextCursor` while more follow; each sender named by its role in the enrollment, never `mine`;
//     a purged message with neither body nor attachment, and no storage key ever;
//   - the enrollment's parties read with no lock, no gender compared (the administrator is no party);
//   - null for an enrollment no ordinary read finds, no page read.
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { ChatMessageRow, ChatPageQuery } from './chat.repository.js';
import type { ChatEnrollmentTerms } from './chat.service.js';
import { createDisputeChat } from './dispute-chat.js';

const tx = {} as Transaction;
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000800';
const STUDENT = '0199d0a0-0000-7000-8000-000000000901';
const TEACHER = '0199d0a0-0000-7000-8000-000000000902';
const id = (n: number) => `0199d0a0-0000-7000-8000-0000000c${String(n).padStart(4, '0')}`;
/** Each message's instant by its number. */
const SENT_AT: Readonly<Record<number, Date>> = {
  1: new Date('2026-11-01T09:00:00.000Z'),
  2: new Date('2026-11-02T09:00:00.000Z'),
  3: new Date('2026-11-03T09:00:00.000Z'),
  4: new Date('2026-11-04T09:00:00.000Z'),
  5: new Date('2026-11-05T09:00:00.000Z'),
};

const settings: SettingsReader = {
  async read(key, schema) {
    if (key !== 'chat_page_size') throw new SettingError(key, 'missing');
    return schema.parse(2);
  },
};

const TERMS: ChatEnrollmentTerms = {
  id: ENROLLMENT,
  status: 'cancelled',
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
};

function row(n: number, sender: string, extra: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: id(n),
    senderUserId: sender,
    body: `message ${n}`,
    attachmentFilename: null,
    attachmentMime: null,
    sentAt: SENT_AT[n] ?? new Date(Number.NaN),
    purgedAt: null,
    ...extra,
  };
}

function world(rows: ChatMessageRow[], terms: ChatEnrollmentTerms | null = TERMS) {
  const calls: unknown[][] = [];
  const chat = createDisputeChat({
    enrollments: {
      enrollmentFor: async (_tx, enrollmentId) => {
        calls.push(['enrollmentFor', enrollmentId]);
        return terms;
      },
    },
    settings,
    store: {
      messagePage: async (_tx, query: ChatPageQuery) => {
        calls.push(['messagePage', query]);
        return rows.slice(0, query.take);
      },
    },
  });
  return { chat, calls };
}

describe('createDisputeChat (FR-475, R-314)', () => {
  it('answers chat.list’s page with each sender named by its role, never mine', async () => {
    const { chat, calls } = world([
      row(3, TEACHER),
      row(2, STUDENT, {
        body: null,
        attachmentFilename: 'تسميع.pdf',
        attachmentMime: 'application/pdf',
      }),
    ]);
    expect(await chat.chatPage(tx, ENROLLMENT, undefined)).toEqual({
      messages: [
        {
          messageId: id(3),
          senderRole: 'teacher',
          body: 'message 3',
          sentAt: '2026-11-03T09:00:00.000Z',
          purged: false,
        },
        {
          messageId: id(2),
          senderRole: 'student',
          attachment: { filename: 'تسميع.pdf', mime: 'application/pdf' },
          sentAt: '2026-11-02T09:00:00.000Z',
          purged: false,
        },
      ],
    });
    expect(calls).toEqual([
      ['enrollmentFor', ENROLLMENT],
      ['messagePage', { enrollmentId: ENROLLMENT, before: undefined, take: 3 }],
    ]);
  });

  it('pages by chat_page_size after the cursor, nextCursor while more follow', async () => {
    const { chat, calls } = world([row(5, STUDENT), row(4, TEACHER), row(3, STUDENT)]);
    const page = await chat.chatPage(tx, ENROLLMENT, id(6));
    expect(page?.messages.map(({ messageId }) => messageId)).toEqual([id(5), id(4)]);
    expect(page?.nextCursor).toBe(id(4));
    expect(calls[1]).toEqual(['messagePage', { enrollmentId: ENROLLMENT, before: id(6), take: 3 }]);
  });

  it('a purged message keeps its id, sender and instant only', async () => {
    const { chat } = world([
      row(1, STUDENT, {
        body: null,
        attachmentFilename: null,
        attachmentMime: null,
        purgedAt: new Date('2026-12-01T00:00:00.000Z'),
      }),
    ]);
    expect((await chat.chatPage(tx, ENROLLMENT, undefined))?.messages).toEqual([
      { messageId: id(1), senderRole: 'student', sentAt: '2026-11-01T09:00:00.000Z', purged: true },
    ]);
  });

  it('answers null for an enrollment no ordinary read finds, reading no page', async () => {
    const { chat, calls } = world([row(1, STUDENT)], null);
    expect(await chat.chatPage(tx, ENROLLMENT, undefined)).toBeNull();
    expect(calls).toEqual([['enrollmentFor', ENROLLMENT]]);
  });
});
