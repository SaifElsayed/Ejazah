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
import type { LiveBus, LiveMessage } from '../../platform/live/live-bus.js';
import { type LivePublisher, RequestLive } from '../../platform/live/live-publisher.js';
import { DOCUMENT_LINK_TTL_SETTING } from '../../platform/settings/keys.js';
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
// T038: the process's clock when a link is minted, and the link's life (`document_link_ttl_seconds`).
const NOW = new Date('2026-11-11T12:00:00.000Z');
const LINK_SECONDS = 300;
const DOCUMENT = '0199d0a0-0000-7000-8000-00000000f0d1';

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
/** T175: the messages the send wrote, by id, as the table holds them. */
let sentRows: Map<string, ChatMessageRow>;
/** Applied once the enrollment's lock is taken: what another transaction committed meanwhile. */
let underLock: (() => void) | undefined;
let pageSize: number;
// T038: the messages' attachments as `attachmentOf` reads them, and the links minted.
let attachments: Map<
  string,
  { enrollmentId: string; attachmentKey: string | null; purgedAt: Date | null }
>;
let links: unknown[][];
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
    if (key === DOCUMENT_LINK_TTL_SETTING) return schema.parse(LINK_SECONDS);
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
    const written: ChatMessageRow = {
      id: NEW_MESSAGE,
      senderUserId: row.senderUserId,
      body: row.body,
      attachmentFilename: null,
      attachmentMime: null,
      sentAt: row.sentAt,
      purgedAt: null,
    };
    sentRows.set(written.id, written);
    return written;
  },
  // T175: a sent message read again by its id, as a replay reads it.
  messageById: async (_tx, messageId) => {
    trace.push(`read message ${messageId}`);
    return sentRows.get(messageId) ?? null;
  },
  // T038.
  attachmentOf: async (_tx, messageId) => {
    trace.push(`read attachment of ${messageId}`);
    return attachments.get(messageId) ?? null;
  },
  insertAttachment: async () => {
    throw new Error('no upload in this spec');
  },
};

/** T038: the storage port's link, recorded. */
const storage = {
  temporaryLink: async (key: string, seconds: number) => {
    trace.push('link');
    links.push([key, seconds]);
    return `https://files.invalid/${key}?expires=${String(seconds)}`;
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
  sentRows = new Map();
  underLock = undefined;
  pageSize = 2;
  attachments = new Map();
  links = [];
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
    storage,
    now: () => NOW,
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

/** T066: the request's after-commit list, for a case that reads no event. */
const quiet: LivePublisher = { afterCommit: () => undefined };

const send = (
  userId: string,
  enrollmentId = ENROLLMENT,
  body = 'السلام عليكم',
  live: LivePublisher = quiet,
) => services.send({ userId }, { enrollmentId, body, idempotencyKey: KEY }, log, live);

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

// T038 of specs/004-sessions — `chat.attachmentLink` (FR-489, R-SEC-3; contracts/app-surface.md,
// "`chat`"; contracts/kernel.md, the row «`chat.list`, `chat.attachmentLink`»): the message and its
// enrollment's two parties read in one transaction with no lock, the genders compared, then a link
// valid `document_link_ttl_seconds` minted after the commit. A message that does not exist, one of an
// enrollment the caller is not a party of, one whose counterparty is of the other gender, a purged
// one and one with no document answer one NOT_FOUND, nothing minted.
describe('chat.attachmentLink (FR-489, R-SEC-3)', () => {
  const link = (userId: string, messageId = DOCUMENT) =>
    services.attachmentLink({ userId }, { messageId }, log);

  beforeEach(() => {
    attachments.set(DOCUMENT, {
      enrollmentId: ENROLLMENT,
      attachmentKey: 'chat/0199d0a0-0000-7000-8000-00000000f0d1.pdf',
      purgedAt: null,
    });
  });

  it.each([
    ['the student', STUDENT],
    ['the teacher', TEACHER],
  ])(
    '%s gets a link valid document_link_ttl_seconds, minted after the commit',
    async (_name, userId) => {
      expect(await link(userId)).toEqual({
        url: `https://files.invalid/chat/0199d0a0-0000-7000-8000-00000000f0d1.pdf?expires=${String(LINK_SECONDS)}`,
        expiresAt: '2026-11-11T12:05:00Z',
      });
      expect(trace).toEqual([
        `setting ${DOCUMENT_LINK_TTL_SETTING}`,
        'begin',
        `read attachment of ${DOCUMENT}`,
        `read enrollment ${ENROLLMENT}`,
        `read parties ${STUDENT},${TEACHER}`,
        'commit',
        'link',
      ]);
      expect(trace.some((step) => step.startsWith('lock'))).toBe(false);
    },
  );

  it.each([
    ['a stranger', STRANGER, DOCUMENT, 'not_a_party'],
    ['a message that does not exist', STUDENT, NOWHERE, 'no_message'],
  ])('%s answers NOT_FOUND, nothing minted', async (_name, userId, messageId, reason) => {
    const error = await refusalOf(link(userId, messageId));
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details).toBeUndefined();
    expect(links).toEqual([]);
    expect(refusalLines()).toEqual([
      {
        messageId,
        ...(messageId === DOCUMENT ? { enrollmentId: ENROLLMENT } : {}),
        userId,
        errorCode: 'NOT_FOUND',
        reason,
      },
    ]);
  });

  it.each([
    ['the student', STUDENT, TEACHER],
    ['the teacher', TEACHER, STUDENT],
  ])(
    '%s whose counterparty is of the other gender answers NOT_FOUND, after an administrator’s correction too',
    async (_name, caller, other) => {
      expect((await link(caller)).url).toContain('chat/');
      genders.set(other, 'male');
      const error = await refusalOf(link(caller));
      expect(error.code).toBe('NOT_FOUND');
      expect(links).toHaveLength(1);
    },
  );

  it('a purged message answers NOT_FOUND though its key is kept until its file is removed (T039)', async () => {
    attachments.set(DOCUMENT, {
      enrollmentId: ENROLLMENT,
      attachmentKey: 'chat/kept.pdf',
      purgedAt: new Date('2026-12-30T00:00:00.000Z'),
    });
    const error = await refusalOf(link(STUDENT));
    expect(error.code).toBe('NOT_FOUND');
    expect(links).toEqual([]);
    expect(refusalLines().map(({ reason }) => reason)).toEqual(['purged']);
  });

  it('a message with no document answers NOT_FOUND', async () => {
    attachments.set(DOCUMENT, { enrollmentId: ENROLLMENT, attachmentKey: null, purgedAt: null });
    expect((await refusalOf(link(TEACHER))).code).toBe('NOT_FOUND');
    expect(refusalLines().map(({ reason }) => reason)).toEqual(['no_attachment']);
  });

  it('a stranger is refused before the purge is told: NOT_FOUND, not_a_party', async () => {
    attachments.set(DOCUMENT, { enrollmentId: ENROLLMENT, attachmentKey: null, purgedAt: NOW });
    await refusalOf(link(STRANGER));
    expect(refusalLines().map(({ reason }) => reason)).toEqual(['not_a_party']);
  });
});

// T066 of specs/004-sessions — `chat.send`'s live event (FR-427, FR-496; research R-324, items 4 to
// 6; contracts/app-surface.md, `LiveEvent`; the note under T066, Q3 (a)): one `chat` event to each
// of the enrollment's two parties, read under the send's locks, the sender's other devices
// included, `mine` computed for each recipient; added inside the keyed effect, so a replay, which
// runs no effect, adds none; sent by the user kind once the handler resolves and dropped when it
// throws (`surfaces/procedures.ts`, emulated here by `asUserKind`); never the body in a log line.
describe('chat.send: the live event (T066)', () => {
  /** The user kind's after-commit point as `procedures.ts` runs it: flushed on an answer, dropped on a throw. */
  async function asUserKind<T>(call: (live: LivePublisher) => Promise<T>) {
    const published: LiveMessage[] = [];
    const bus: LiveBus = {
      publish: (message) => {
        trace.push('publish');
        published.push(message);
      },
      subscribe: () => () => undefined,
    };
    const live = new RequestLive(bus, { warn: () => undefined });
    const tracing: LivePublisher = {
      afterCommit: (to, event, scope) => {
        trace.push(`add ${event.type} for ${[...to].join(',')}`);
        live.afterCommit(to, event, scope);
      },
    };
    try {
      const answer = await call(tracing);
      live.flush();
      return { answer, error: undefined, published };
    } catch (error: unknown) {
      live.drop();
      return { answer: undefined, error, published };
    }
  }

  const sent = (mine: boolean, body = 'السلام عليكم') => ({
    type: 'chat',
    enrollmentId: ENROLLMENT,
    message: { messageId: NEW_MESSAGE, mine, body, sentAt: SENT.toISOString(), purged: false },
  });

  it('adds one chat event to each party inside the keyed transaction, mine for the sender only, sent once after the commit', async () => {
    const { published } = await asUserKind((live) =>
      send(STUDENT, ENROLLMENT, 'السلام عليكم', live),
    );
    expect(published).toEqual([
      { to: [STUDENT], event: sent(true) },
      { to: [TEACHER], event: sent(false) },
    ]);
    const added = trace.indexOf(`add chat for ${STUDENT}`);
    expect(added).toBeGreaterThan(trace.indexOf(`insert message by ${STUDENT}`));
    expect(added).toBeLessThan(trace.indexOf('commit'));
    expect(trace.indexOf('publish')).toBeGreaterThan(trace.indexOf('commit'));
  });

  it('the teacher’s message reaches the teacher’s devices as mine and the student’s as not', async () => {
    const { published } = await asUserKind((live) =>
      send(TEACHER, ENROLLMENT, 'السلام عليكم', live),
    );
    expect(published).toEqual([
      { to: [TEACHER], event: sent(true) },
      { to: [STUDENT], event: sent(false) },
    ]);
  });

  it.each([
    ['a refusal under the locks (CHAT_CLOSED)', STUDENT, () => setStatus('completed')],
    ['a stranger (NOT_FOUND)', STRANGER, () => undefined],
  ])(
    'sends nothing on %s: nothing added, the transaction rolled back',
    async (_name, caller, arrange) => {
      arrange();
      const { error, published } = await asUserKind((live) =>
        send(caller, ENROLLMENT, 'السلام عليكم', live),
      );
      expect(error).toBeInstanceOf(DomainError);
      expect(published).toEqual([]);
      expect(trace.some((step) => step.startsWith('add'))).toBe(false);
    },
  );

  it('sends nothing when the transaction fails after the insert: what was added is dropped', async () => {
    const failing = createChatServices({
      transactions,
      idempotency: {
        run: <T>(_request: IdempotentRequest, effect: (tx: Transaction) => Promise<T>) =>
          transactions.run(async (keyedTx) => {
            await effect(keyedTx);
            throw new Error('the commit failed');
          }),
      },
      settings,
      enrollments,
      store,
      storage,
      clock: async () => SENT,
    });
    const { error, published } = await asUserKind((live) =>
      failing.send(
        { userId: STUDENT },
        { enrollmentId: ENROLLMENT, body: 'نص', idempotencyKey: KEY },
        log,
        live,
      ),
    );
    expect(error).toBeInstanceOf(Error);
    expect(trace).toContain(`add chat for ${STUDENT}`);
    expect(published).toEqual([]);
  });

  it('a replay of the same key runs no effect and sends nothing', async () => {
    const outcomes = new Map<string, unknown>();
    const replaying = createChatServices({
      transactions,
      idempotency: {
        run: async <T>(request: IdempotentRequest, effect: (tx: Transaction) => Promise<T>) => {
          if (outcomes.has(request.key)) return outcomes.get(request.key) as T;
          const outcome = await transactions.run(effect);
          outcomes.set(request.key, outcome);
          return outcome;
        },
      },
      settings,
      enrollments,
      store,
      storage,
      clock: async () => SENT,
    });
    const call = (live: LivePublisher) =>
      replaying.send(
        { userId: STUDENT },
        { enrollmentId: ENROLLMENT, body: 'نص', idempotencyKey: KEY },
        log,
        live,
      );
    expect((await asUserKind(call)).published).toEqual([
      { to: [STUDENT], event: sent(true, 'نص') },
      { to: [TEACHER], event: sent(false, 'نص') },
    ]);
    const replay = await asUserKind(call);
    expect(replay.answer).toMatchObject({ messageId: NEW_MESSAGE, mine: true });
    expect(replay.published).toEqual([]);
  });

  it('writes no body in any log line, sent or refused', async () => {
    await asUserKind((live) => send(STUDENT, ENROLLMENT, 'نص سري لا يُكتب', live));
    setStatus('completed');
    await asUserKind((live) => send(STUDENT, ENROLLMENT, 'نص سري لا يُكتب', live));
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain('نص سري');
  });
});

// T175 (R1a; the note under T175, (1)): the key stores `{ messageId }` and never the body; a replay
// reads the message by its id, and a purged one answers `purged` with nothing of it.
describe('chat.send’s key holds no body (T175)', () => {
  const BODY = 'نص لا يبقى في المفتاح';
  const none: LivePublisher = { afterCommit: () => undefined };

  function keyedChat() {
    const outcomes = new Map<string, unknown>();
    const chat = createChatServices({
      transactions,
      idempotency: {
        run: async <T>(request: IdempotentRequest, effect: (tx: Transaction) => Promise<T>) => {
          if (outcomes.has(request.key)) return outcomes.get(request.key) as T;
          const outcome = await transactions.run(effect);
          outcomes.set(request.key, outcome);
          return outcome;
        },
      },
      settings,
      enrollments,
      store,
      storage,
      clock: async () => SENT,
    });
    const send = () =>
      chat.send(
        { userId: STUDENT },
        { enrollmentId: ENROLLMENT, body: BODY, idempotencyKey: KEY },
        log,
        none,
      );
    return { outcomes, send };
  }

  it('stores the message’s id only', async () => {
    const { outcomes, send } = keyedChat();
    await send();
    expect(outcomes.get(KEY)).toEqual({ messageId: NEW_MESSAGE });
    expect(JSON.stringify([...outcomes.values()])).not.toContain(BODY);
  });

  it('answers a replay with the message read by its id, as the first call answered it', async () => {
    const { send } = keyedChat();
    const first = await send();
    trace.length = 0;
    await expect(send()).resolves.toEqual(first);
    expect(trace).toContain(`read message ${NEW_MESSAGE}`);
  });

  it('answers a replay of a purged message purged, with no body', async () => {
    const { send } = keyedChat();
    await send();
    const row = sentRows.get(NEW_MESSAGE);
    if (row === undefined) throw new Error('no message written');
    sentRows.set(NEW_MESSAGE, { ...row, body: null, purgedAt: NOW });
    await expect(send()).resolves.toEqual({
      messageId: NEW_MESSAGE,
      mine: true,
      sentAt: SENT.toISOString(),
      purged: true,
    });
  });

  it('answers a replay NOT_FOUND when the message is gone, logged with the ids and its reason', async () => {
    const { send } = keyedChat();
    await send();
    sentRows.delete(NEW_MESSAGE);
    lines.length = 0;
    const refusal = await refusalOf(send());
    expect(refusal.code).toBe('NOT_FOUND');
    expect(lines).toMatchObject([
      { messageId: NEW_MESSAGE, userId: STUDENT, errorCode: 'NOT_FOUND', reason: 'no_message' },
    ]);
  });
});
