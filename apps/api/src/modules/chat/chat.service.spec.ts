// T037 of specs/004-sessions — `chat.list` and `chat.send` as the service decides them (FR-488,
// FR-491, FR-499; research R-314; plan.md decisions 8 and 11; contracts/app-surface.md, "`chat`";
// contracts/kernel.md, the rows «`chat.send`, `POST /uploads/chat`» and «`chat.list`,
// `chat.attachmentLink`»). Written before the service, and run red first.
//
// Over a store and an enrollment side that record what they are asked, in order, beside the
// transaction's begin and commit, so the spec reads the order the kernel's rows name:
//
//   - `chat.list` reads the enrollment and its two parties in one transaction with no lock (the note
//     under T037, Q3 (a)); a page of `chat_page_size` messages newest first, the cursor while more
//     follow; `mine` from the sender, a purged message with no body and no attachment, never a key;
//   - `chat.send` keyed by the kernel's idempotency under scope `chat.send`, the input without its
//     key; the enrollment read with no lock to learn its parties, then the sender's `users` row
//     locked, then the enrollment, its status and parties read again under them (L-B), the sent
//     instant the database's clock read after them;
//   - a non-party, a nonexistent enrollment and a counterparty of the other gender by the server's
//     records answer one NOT_FOUND, both procedures, an administrator's correction included (the
//     records read at the call); a party's send on any status but `confirmed` CHAT_CLOSED (F17),
//     nothing written; what another transaction committed before the lock is what the send reads;
//   - every refusal one info line with the ids, the code and the reason, nothing else.
import { Writable } from 'node:stream';

import { addSeconds } from '@ijazah/time';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { IdempotentRequest } from '../../platform/idempotency/idempotency.service.js';
import { createLogger, type Logger } from '../../platform/logging/logger.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { ChatMessageRow } from './chat.repository.js';
import {
  CHAT_PAGE_SIZE_SETTING,
  type ChatEnrollments,
  type ChatEnrollmentTerms,
  type ChatServices,
  type ChatStore,
  createChatServices,
} from './chat.service.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e001';
const NOWHERE = '0199d0a0-0000-7000-8000-00000000e0ff';
const STUDENT = '0199d0a0-0000-7000-8000-00000000c001';
const TEACHER = '0199d0a0-0000-7000-8000-00000000c002';
const STRANGER = '0199d0a0-0000-7000-8000-00000000c003';
const NEW_MESSAGE = '0199d0a0-0000-7000-8000-00000000f0ff';
const KEY = 'chat-send-0199d0a0-0000-7000';
const SENT = new Date('2026-11-11T10:00:00.000Z');

const message = (n: number, overrides: Partial<ChatMessageRow> = {}): ChatMessageRow => ({
  id: `0199d0a0-0000-7000-8000-00000000f0${String(n).padStart(2, '0')}`,
  senderUserId: n % 2 === 0 ? STUDENT : TEACHER,
  body: `رسالة ${n}`,
  attachmentFilename: null,
  attachmentMime: null,
  sentAt: new Date(addSeconds(SENT, n)),
  purgedAt: null,
  ...overrides,
});

let trace: string[];
let terms: Map<string, ChatEnrollmentTerms>;
let genders: Map<string, 'male' | 'female'>;
let messages: ChatMessageRow[];
let inserted: unknown[];
/** Applied once the enrollment's lock is taken: what another transaction committed meanwhile. */
let underLock: (() => void) | undefined;
let pageSize: number;
let keyed: IdempotentRequest[];
let lines: Record<string, unknown>[];
let log: Logger;
let services: ChatServices;

const tx = {} as Transaction;

const transactions: Transactions = {
  run: async (work) => {
    trace.push('begin');
    try {
      const answer = await work(tx);
      trace.push('commit');
      return answer;
    } catch (error) {
      trace.push('rollback');
      throw error;
    }
  },
};

/** The kernel's idempotency as the service sees it: the key recorded, the effect in a transaction. */
const idempotency = {
  run: <T>(keyedRequest: IdempotentRequest, effect: (tx: Transaction) => Promise<T>) => {
    keyed.push(keyedRequest);
    return transactions.run(effect);
  },
};

const settings: SettingsReader = {
  read: async (key, schema) => {
    trace.push(`setting ${key}`);
    if (key !== CHAT_PAGE_SIZE_SETTING) throw new Error(`unexpected setting ${key}`);
    return schema.parse(pageSize);
  },
};

const enrollments: ChatEnrollments = {
  enrollmentFor: async (_tx, id) => {
    trace.push(`read enrollment ${id}`);
    return terms.get(id) ?? null;
  },
  lockEnrollments: async (_tx, ids) => {
    trace.push(`lock enrollments ${[...ids].join(',')}`);
    underLock?.();
  },
};

const store: ChatStore = {
  partiesOf: async (_tx, userIds) => {
    trace.push(`read parties ${[...userIds].join(',')}`);
    return new Map(
      userIds.flatMap((id) => {
        const gender = genders.get(id);
        return gender === undefined ? [] : [[id, { gender }] as const];
      }),
    );
  },
  lockSender: async (_tx, userId) => {
    trace.push(`lock users ${userId}`);
  },
  messagePage: async (_tx, { enrollmentId, before, take }) => {
    trace.push(`read page of ${enrollmentId} before ${String(before)} take ${take}`);
    return [...messages]
      .sort((a, b) => b.id.localeCompare(a.id))
      .filter((row) => before === undefined || row.id < before)
      .slice(0, take);
  },
  insertMessage: async (_tx, row) => {
    trace.push(`insert message by ${row.senderUserId}`);
    inserted.push(row);
    return {
      id: NEW_MESSAGE,
      senderUserId: row.senderUserId,
      body: row.body,
      attachmentFilename: null,
      attachmentMime: null,
      sentAt: row.sentAt,
      purgedAt: null,
    };
  },
};

beforeEach(() => {
  trace = [];
  terms = new Map([
    [
      ENROLLMENT,
      { id: ENROLLMENT, status: 'confirmed', studentUserId: STUDENT, teacherUserId: TEACHER },
    ],
  ]);
  genders = new Map([
    [STUDENT, 'female'],
    [TEACHER, 'female'],
    [STRANGER, 'female'],
  ]);
  messages = [];
  inserted = [];
  underLock = undefined;
  pageSize = 2;
  keyed = [];
  lines = [];
  log = createLogger({
    level: 'info',
    destination: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
        done();
      },
    }),
  });
  services = createChatServices({
    transactions,
    idempotency,
    settings,
    enrollments,
    store,
    clock: async () => {
      trace.push('clock');
      return SENT;
    },
  });
});

/** The refusal `call` threw, marked «logged» where it was logged (PR #130's review, Minor 4). */
async function refusalOf(call: Promise<unknown>): Promise<DomainError> {
  try {
    await call;
  } catch (error) {
    if (error instanceof DomainError) {
      expect(isRefusalLogged(error), `${error.code} marked «logged»`).toBe(true);
      return error;
    }
    throw error;
  }
  throw new Error('answered where it must be refused');
}

/** The log lines that name a refusal, without the logger's own fields. */
function refusalLines(): Record<string, unknown>[] {
  return lines
    .filter((line) => typeof line['errorCode'] === 'string')
    .map(({ msg: _msg, level: _level, time: _time, pid: _pid, hostname: _host, ...rest }) => rest);
}

const list = (userId: string, enrollmentId = ENROLLMENT, cursor?: string) =>
  services.list({ userId }, { enrollmentId, ...(cursor === undefined ? {} : { cursor }) }, log);

const send = (userId: string, enrollmentId = ENROLLMENT, body = 'السلام عليكم') =>
  services.send({ userId }, { enrollmentId, body, idempotencyKey: KEY }, log);

const setStatus = (status: ChatEnrollmentTerms['status']) => {
  const found = terms.get(ENROLLMENT);
  if (found !== undefined) terms.set(ENROLLMENT, { ...found, status });
};

describe('chat.list (FR-488, FR-491)', () => {
  it('answers a page of chat_page_size newest first, mine by the sender, the cursor while more follow', async () => {
    messages = [message(1), message(2), message(3)];
    const first = await list(STUDENT);
    expect(first).toEqual({
      messages: [
        {
          messageId: message(3).id,
          mine: false,
          body: 'رسالة 3',
          sentAt: message(3).sentAt.toISOString(),
          purged: false,
        },
        {
          messageId: message(2).id,
          mine: true,
          body: 'رسالة 2',
          sentAt: message(2).sentAt.toISOString(),
          purged: false,
        },
      ],
      nextCursor: message(2).id,
    });
    const rest = await list(STUDENT, ENROLLMENT, first.nextCursor);
    expect(rest).toEqual({
      messages: [
        {
          messageId: message(1).id,
          mine: false,
          body: 'رسالة 1',
          sentAt: message(1).sentAt.toISOString(),
          purged: false,
        },
      ],
    });
  });

  it('reads with no lock: the setting, then one transaction reading the enrollment, the parties and the page', async () => {
    await list(TEACHER);
    expect(trace).toEqual([
      `setting ${CHAT_PAGE_SIZE_SETTING}`,
      'begin',
      `read enrollment ${ENROLLMENT}`,
      `read parties ${STUDENT},${TEACHER}`,
      `read page of ${ENROLLMENT} before undefined take 3`,
      'commit',
    ]);
    expect(trace.some((step) => step.startsWith('lock'))).toBe(false);
  });

  it('answers a document as its name and type, never its key, and a purged message with neither body nor attachment', async () => {
    messages = [
      message(1, {
        body: null,
        attachmentFilename: 'تجويد.pdf',
        attachmentMime: 'application/pdf',
      }),
      message(2, { body: null, purgedAt: new Date('2026-12-30T00:00:00.000Z') }),
    ];
    const page = await list(STUDENT);
    expect(page.messages).toEqual([
      {
        messageId: message(2).id,
        mine: true,
        sentAt: message(2).sentAt.toISOString(),
        purged: true,
      },
      {
        messageId: message(1).id,
        mine: false,
        attachment: { filename: 'تجويد.pdf', mime: 'application/pdf' },
        sentAt: message(1).sentAt.toISOString(),
        purged: false,
      },
    ]);
    expect(JSON.stringify(page)).not.toMatch(/key/i);
  });

  it('stays readable once the enrollment has ended, until the purge (decision 11)', async () => {
    for (const status of ['completed', 'terminated_no_show', 'cancelled'] as const) {
      setStatus(status);
      messages = [message(1)];
      expect((await list(STUDENT)).messages).toHaveLength(1);
    }
  });
});

describe('chat.list: refused (R-GENDER-2, FR-432)', () => {
  it.each([
    ['a stranger', STRANGER, ENROLLMENT, 'not_a_party'],
    ['a nonexistent enrollment', STUDENT, NOWHERE, 'not_a_party'],
  ])('%s answers NOT_FOUND with no field', async (_name, userId, enrollmentId, reason) => {
    const error = await refusalOf(list(userId, enrollmentId));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details).toBeUndefined();
    expect(refusalLines()).toEqual([{ enrollmentId, userId, errorCode: 'NOT_FOUND', reason }]);
  });

  it.each([
    ['the student', STUDENT, TEACHER],
    ['the teacher', TEACHER, STUDENT],
  ])(
    '%s whose counterparty is of the other gender by the records answers NOT_FOUND',
    async (_name, caller, other) => {
      genders.set(other, 'male');
      const error = await refusalOf(list(caller));
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
      expect(refusalLines()).toEqual([
        {
          enrollmentId: ENROLLMENT,
          userId: caller,
          errorCode: 'NOT_FOUND',
          reason: 'gender_differs',
        },
      ]);
    },
  );

  it("after an administrator's gender correction the next read answers NOT_FOUND", async () => {
    messages = [message(1)];
    expect((await list(STUDENT)).messages).toHaveLength(1);
    genders.set(STUDENT, 'male');
    expect((await refusalOf(list(STUDENT))).code).toBe('NOT_FOUND');
    expect((await refusalOf(list(TEACHER))).code).toBe('NOT_FOUND');
  });
});

describe('chat.send (FR-488, FR-491)', () => {
  it('a party sends, keyed under scope chat.send with the input without its key, and is answered the message', async () => {
    expect(await send(TEACHER)).toEqual({
      messageId: NEW_MESSAGE,
      mine: true,
      body: 'السلام عليكم',
      sentAt: SENT.toISOString(),
      purged: false,
    });
    expect(keyed).toEqual([
      {
        scope: 'chat.send',
        key: KEY,
        actorId: TEACHER,
        input: { enrollmentId: ENROLLMENT, body: 'السلام عليكم' },
      },
    ]);
    expect(inserted).toEqual([
      { enrollmentId: ENROLLMENT, senderUserId: TEACHER, body: 'السلام عليكم', sentAt: SENT },
    ]);
  });

  it("locks the sender's users row, then the enrollment, then reads it and the parties again (kernel.md, L-B)", async () => {
    await send(STUDENT);
    expect(trace).toEqual([
      'begin',
      `read enrollment ${ENROLLMENT}`,
      `lock users ${STUDENT}`,
      `lock enrollments ${ENROLLMENT}`,
      `read enrollment ${ENROLLMENT}`,
      `read parties ${STUDENT},${TEACHER}`,
      'clock',
      `insert message by ${STUDENT}`,
      'commit',
    ]);
  });

  it.each(['pending_payment', 'completed', 'terminated_no_show', 'cancelled'] as const)(
    'a party sending on an enrollment %s answers CHAT_CLOSED, nothing written (decision 11, F17)',
    async (status) => {
      setStatus(status);
      const error = await refusalOf(send(STUDENT));
      expect(error.code).toBe('CHAT_CLOSED');
      expect(inserted).toEqual([]);
      expect(trace.at(-1)).toBe('rollback');
      expect(refusalLines()).toEqual([
        {
          enrollmentId: ENROLLMENT,
          userId: STUDENT,
          errorCode: 'CHAT_CLOSED',
          reason: 'not_confirmed',
        },
      ]);
    },
  );

  it('reads the status under the locks: an end committed before the lock answers CHAT_CLOSED', async () => {
    underLock = () => setStatus('completed');
    expect((await refusalOf(send(TEACHER))).code).toBe('CHAT_CLOSED');
    expect(inserted).toEqual([]);
  });

  it.each([
    ['a stranger', STRANGER, ENROLLMENT],
    ['a nonexistent enrollment', STUDENT, NOWHERE],
  ])(
    '%s answers NOT_FOUND before any lock, nothing written',
    async (_name, userId, enrollmentId) => {
      const error = await refusalOf(send(userId, enrollmentId));
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
      expect(inserted).toEqual([]);
      expect(trace.some((step) => step.startsWith('lock'))).toBe(false);
      expect(refusalLines()).toEqual([
        { enrollmentId, userId, errorCode: 'NOT_FOUND', reason: 'not_a_party' },
      ]);
    },
  );

  it('a stranger answers NOT_FOUND even on an ended enrollment, never CHAT_CLOSED', async () => {
    setStatus('completed');
    expect((await refusalOf(send(STRANGER))).code).toBe('NOT_FOUND');
  });

  it.each([
    ['the student', STUDENT, TEACHER],
    ['the teacher', TEACHER, STUDENT],
  ])(
    '%s whose counterparty is of the other gender answers NOT_FOUND, read under the locks, nothing written',
    async (_name, caller, other) => {
      underLock = () => genders.set(other, 'male');
      const error = await refusalOf(send(caller));
      expect(error.code).toBe('NOT_FOUND');
      expect(error.details).toBeUndefined();
      expect(inserted).toEqual([]);
      expect(refusalLines()).toEqual([
        {
          enrollmentId: ENROLLMENT,
          userId: caller,
          errorCode: 'NOT_FOUND',
          reason: 'gender_differs',
        },
      ]);
    },
  );

  it('the other gender answers NOT_FOUND before CHAT_CLOSED on an ended enrollment', async () => {
    setStatus('completed');
    genders.set(TEACHER, 'male');
    expect((await refusalOf(send(STUDENT))).code).toBe('NOT_FOUND');
  });
});
