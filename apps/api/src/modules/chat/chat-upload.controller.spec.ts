// T038 of specs/004-sessions — `POST /uploads/chat` (FR-489, FR-490; R-SEC-3, R-SEC-4, R-SEC-5;
// research R-314; contracts/app-surface.md, "`chat`"; contracts/kernel.md, the row «`chat.send`,
// `POST /uploads/chat`»; the notes under T038). Written before the route, and run red first.
//
// Over real HTTP, through the upload route helper, with the in-memory storage stand-in and a store
// and an enrollment side that record what they are asked, in order:
//
//   - a party of a `confirmed` enrollment sends a PDF or UTF-8 text: the fields validated before any
//     read, the name checked for an image's extension after the content, the enrollment and its
//     parties read with no lock before anything is stored, the file stored under a private minted
//     key, then the sender's `users` row and the enrollment locked and read again before the insert
//     (L-B); the answer the message, its attachment and its instant, never the key;
//   - an image by content or by name, an SVG, a file that is not text: ATTACHMENT_REFUSED, nothing
//     stored, one log line with exactly `{ userId, enrollmentId, cause }`, never the name; a
//     malformed enrollment id logged as absent;
//   - a stranger, a nonexistent enrollment and the other gender NOT_FOUND, an ended enrollment
//     CHAT_CLOSED, nothing stored; an end committed after the file was stored, read under the
//     locks, CHAT_CLOSED and the stored file removed; a failed insert removes it too.
import { Writable } from 'node:stream';

import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../app.module.js';
import type { Transaction } from '../../platform/db/prisma.repository.js';
import type { Transactions } from '../../platform/db/transaction.repository.js';
import { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import type { LiveBus, LiveMessage } from '../../platform/live/live-bus.js';
import { createLogger } from '../../platform/logging/logger.js';
import { SettingError, type SettingsReader } from '../../platform/settings/settings-reader.js';
import type { UserSession } from '../../surfaces/context.js';
import {
  unusedAdminServices,
  unusedBookingServices,
  unusedCatalogServices,
  unusedChatServices,
  unusedCheckoutServices,
  unusedDiscoveryServices,
  unusedIdentityServices,
  unusedSessionsServices,
  unusedTeacherProfileServices,
  unusedVerificationServices,
} from '../../surfaces/services.fixtures.js';
import { multipart, pdfBytes, storageStub } from '../../surfaces/upload-fixtures.js';
import { CHAT_UPLOAD_PATH, createChatUploadRoute } from './chat-upload.controller.js';
import type { NewChatAttachment } from './chat.repository.js';
import type { ChatEnrollments, ChatEnrollmentTerms } from './chat.service.js';

const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000e001';
const NOWHERE = '0199d0a0-0000-7000-8000-00000000e0ff';
const STUDENT = '0199d0a0-0000-7000-8000-00000000c001';
const TEACHER = '0199d0a0-0000-7000-8000-00000000c002';
const STRANGER = '0199d0a0-0000-7000-8000-00000000c003';
const MESSAGE = '0199d0a0-0000-7000-8000-00000000f0ff';
const SENT = new Date('2026-11-11T10:00:00.000Z');

// A real 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const TEXT = Buffer.from('بسم الله الرحمن الرحيم\nملاحظات الدرس\n', 'utf8');
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');

const settings: SettingsReader = {
  read: async (key, schema) => {
    if (key === 'upload_max_bytes') return schema.parse(65_536);
    if (key === 'rate_limit_upload') return schema.parse({ limit: 1000, window_seconds: 60 });
    throw new SettingError(key, 'missing');
  },
};
const rateLimiter = new RateLimiter({
  settings,
  counter: { hit: async () => 1 },
  subjectKey: Buffer.alloc(32, 4),
});

function session(userId: string, accountStatus: UserSession['accountStatus']): UserSession {
  return {
    userId,
    sessionId: `session-${userId}`,
    role: userId === TEACHER ? 'teacher' : 'student',
    gender: 'female',
    preferredLanguage: 'ar',
    accountStatus,
  };
}
const bearers: Readonly<Record<string, UserSession>> = {
  't-student': session(STUDENT, 'active'),
  't-teacher': session(TEACHER, 'active'),
  't-stranger': session(STRANGER, 'active'),
  't-suspended': session(STUDENT, 'suspended'),
};
const sessions = {
  user: async (bearer: string) => bearers[bearer] ?? null,
  admin: async () => null,
};
const administration = {
  transactions: { run: () => Promise.reject(new Error('no administrative call is expected here')) },
  auditWriter: {
    write: () => Promise.reject(new Error('no administrative call is expected here')),
  },
};
const services = {
  settings,
  publicConfig: { supportEmail: 'support@ijazah.invalid' },
  subjects: { listActive: async () => [] },
  identity: unusedIdentityServices,
  verification: unusedVerificationServices,
  catalog: unusedCatalogServices,
  teacherProfile: unusedTeacherProfileServices,
  discovery: unusedDiscoveryServices,
  booking: unusedBookingServices,
  checkout: unusedCheckoutServices,
  sessions: unusedSessionsServices,
  chat: unusedChatServices,
};

let lines: Record<string, unknown>[] = [];
let raw: string[] = [];
const log = createLogger({
  level: 'info',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      raw.push(chunk.toString('utf8'));
      lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
      done();
    },
  }),
});

let trace: string[] = [];
let terms = new Map<string, ChatEnrollmentTerms>();
let genders = new Map<string, 'male' | 'female'>();
let inserted: NewChatAttachment[] = [];
let underLock: (() => void) | undefined;
let insertFails = false;
const storage = storageStub();
// T066: what the route's after-commit list sent, through the process's bus.
let published: LiveMessage[] = [];
const liveBus: LiveBus = {
  publish: (message) => {
    trace.push('publish');
    published.push(message);
  },
  subscribe: () => () => undefined,
};

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
const store = {
  partiesOf: async (_tx: Transaction, userIds: readonly string[]) => {
    trace.push(`read parties ${[...userIds].join(',')}`);
    return new Map(
      userIds.flatMap((id) => {
        const gender = genders.get(id);
        return gender === undefined ? [] : [[id, { gender }] as const];
      }),
    );
  },
  lockSender: async (_tx: Transaction, userId: string) => {
    trace.push(`lock users ${userId}`);
  },
  insertAttachment: async (_tx: Transaction, row: NewChatAttachment) => {
    trace.push(`insert attachment by ${row.senderUserId}`);
    if (insertFails) throw new Error('the insert failed');
    inserted.push(row);
    return {
      id: MESSAGE,
      senderUserId: row.senderUserId,
      body: null,
      attachmentFilename: row.attachmentFilename,
      attachmentMime: row.attachmentMime,
      sentAt: row.sentAt,
      purgedAt: null,
    };
  },
};

let application: INestApplication;
let origin: string;

beforeAll(async () => {
  application = await createApplication({
    log,
    readiness: { databaseReachable: async () => {} },
    securityHeaders: { allowedOrigins: [], mode: 'test' },
    maxRequestBodyBytes: 1024,
    administration,
    rateLimiter,
    sessions,
    services,
    adminServices: unusedAdminServices,
    routes: {
      [CHAT_UPLOAD_PATH]: createChatUploadRoute({
        sessions: sessions.user,
        guard: { settings, rateLimiter },
        log,
        live: liveBus,
        storage,
        transactions,
        enrollments,
        store,
        clock: async () => {
          trace.push('clock');
          return SENT;
        },
      }),
    },
  });
  await application.listen(0, '127.0.0.1');
  origin = (await application.getUrl()).replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await application.close();
});

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
  inserted = [];
  underLock = undefined;
  insertFails = false;
  published = [];
  storage.calls.length = 0;
  lines = [];
  raw = [];
});

interface Sent {
  readonly bearer?: string;
  readonly enrollmentId?: string;
  readonly filename?: string;
  readonly bytes: Buffer;
}

function upload({ bearer = 't-student', enrollmentId = ENROLLMENT, filename, bytes }: Sent) {
  const payload = multipart([
    { name: 'enrollmentId', value: enrollmentId },
    ...(filename === undefined ? [] : [{ name: 'filename', value: filename }]),
    // The part's own name and declared type say nothing: the content decides (R-SEC-4).
    { name: 'file', filename: 'upload.bin', type: 'application/pdf', bytes },
  ]);
  return fetch(`${origin}${CHAT_UPLOAD_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': payload.contentType },
    body: new Uint8Array(payload.body),
  });
}

/** The chat route's refusal lines, without the logger's own fields. */
function documentRefusals(): Record<string, unknown>[] {
  return lines
    .filter((line) => line['msg'] === 'A chat document was refused')
    .map(
      ({
        msg: _msg,
        level: _level,
        time: _time,
        pid: _pid,
        hostname: _host,
        correlationId: _correlation,
        clientAddress: _client,
        ...rest
      }) => rest,
    );
}

const stored = () => storage.calls.filter(({ operation }) => operation === 'put');
const removed = () => storage.calls.filter(({ operation }) => operation === 'remove');

describe('POST /uploads/chat: accepted (FR-489)', () => {
  it('stores a PDF under a private minted key, inserts its message under the locks, and answers no key', async () => {
    const response = await upload({ filename: 'تجويد.pdf', bytes: pdfBytes() });
    expect(response.status).toBe(201);
    const answer = (await response.json()) as Record<string, unknown>;
    expect(answer).toEqual({
      messageId: MESSAGE,
      attachment: { filename: 'تجويد.pdf', mime: 'application/pdf' },
      sentAt: SENT.toISOString(),
    });
    const [put] = stored();
    const key = String(put?.args[0]);
    expect(key).toMatch(/^chat\/[0-9a-f-]{36}\.pdf$/);
    expect(put?.args[2]).toBe('application/pdf');
    expect(JSON.stringify(answer)).not.toContain(key);
    expect(inserted).toEqual([
      {
        enrollmentId: ENROLLMENT,
        senderUserId: STUDENT,
        attachmentKey: key,
        attachmentFilename: 'تجويد.pdf',
        attachmentMime: 'application/pdf',
        sentAt: SENT,
      },
    ]);
    expect(trace).toEqual([
      'begin',
      `read enrollment ${ENROLLMENT}`,
      `read parties ${STUDENT},${TEACHER}`,
      'commit',
      'begin',
      `read enrollment ${ENROLLMENT}`,
      `lock users ${STUDENT}`,
      `lock enrollments ${ENROLLMENT}`,
      `read enrollment ${ENROLLMENT}`,
      `read parties ${STUDENT},${TEACHER}`,
      'clock',
      `insert attachment by ${STUDENT}`,
      'commit',
      // T066: the two parties' events, sent once the handler resolved.
      'publish',
      'publish',
    ]);
  });

  // 004:T045's follow-up (PR #134's review, round 1, follow-up 3; B41's Q7 (a)): a remote store's
  // signed link serves the object under the type it was stored with, so a text document is stored
  // naming its character set, which the guard has already checked is UTF-8; the column keeps the
  // bare type (rule 47) and the answer says `text/plain`.
  it('stores UTF-8 text from the teacher as text/plain; charset=utf-8 under a .txt key, the column text/plain', async () => {
    const response = await upload({ bearer: 't-teacher', filename: 'ملاحظات.txt', bytes: TEXT });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      attachment: { filename: 'ملاحظات.txt', mime: 'text/plain' },
    });
    expect(String(stored()[0]?.args[0])).toMatch(/^chat\/[0-9a-f-]{36}\.txt$/);
    expect(stored()[0]?.args[2]).toBe('text/plain; charset=utf-8');
    expect(inserted[0]?.attachmentMime).toBe('text/plain');
    expect(inserted[0]?.senderUserId).toBe(TEACHER);
  });
});

describe('POST /uploads/chat: an image or not a document (FR-490, R-SEC-5)', () => {
  it.each([
    ['an image by its content, named as a PDF', PNG, 'scan.pdf', 'image_content'],
    ['an image by its content, named as text', PNG, 'notes.txt', 'image_content'],
    ['an SVG named as text', SVG, 'notes.txt', 'image_content'],
    ['a PDF named as an image', pdfBytes(), 'photo.png', 'image_extension'],
    ['text named as an SVG', TEXT, 'drawing.svg', 'image_extension'],
    [
      'text carrying a binary byte',
      Buffer.concat([TEXT, Buffer.from([0x00])]),
      'n.txt',
      'not_text',
    ],
  ])(
    'refuses %s ATTACHMENT_REFUSED, nothing stored, one line with exactly the ids and the cause',
    async (_name, bytes, filename, cause) => {
      const response = await upload({ filename, bytes });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: 'ATTACHMENT_REFUSED', message: 'This file cannot be sent in the chat.' },
      });
      expect(stored()).toEqual([]);
      expect(inserted).toEqual([]);
      expect(documentRefusals()).toEqual([{ userId: STUDENT, enrollmentId: ENROLLMENT, cause }]);
      expect(raw.join('')).not.toContain(filename);
    },
  );

  it('logs a malformed enrollment id as absent, never echoed', async () => {
    const response = await upload({ enrollmentId: 'not-an-id', filename: 'a.pdf', bytes: PNG });
    expect(response.status).toBe(400);
    await response.arrayBuffer();
    expect(documentRefusals()).toEqual([{ userId: STUDENT, cause: 'image_content' }]);
    expect(raw.join('')).not.toContain('not-an-id');
  });
});

describe('POST /uploads/chat: refused before anything is stored', () => {
  it.each([
    ['no name', {}],
    ['a name that is a path', { filename: '../a.pdf' }],
    ['an enrollment that is not an id', { enrollmentId: 'mine', filename: 'a.pdf' }],
  ] as const satisfies readonly (readonly [string, Omit<Sent, 'bytes'>])[])(
    'refuses %s VALIDATION_FAILED before any read',
    async (_name, fields) => {
      const response = await upload({ ...fields, bytes: pdfBytes() });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      });
      expect(trace).toEqual([]);
      expect(stored()).toEqual([]);
    },
  );

  it.each([
    ['a stranger', 't-stranger', ENROLLMENT],
    ['a nonexistent enrollment', 't-student', NOWHERE],
  ])('%s answers NOT_FOUND with no field, nothing stored', async (_name, bearer, enrollmentId) => {
    const response = await upload({ bearer, enrollmentId, filename: 'a.pdf', bytes: pdfBytes() });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found.' },
    });
    expect(stored()).toEqual([]);
    expect(trace.some((step) => step.startsWith('lock'))).toBe(false);
  });

  it.each([
    ['the student', 't-student', TEACHER],
    ['the teacher', 't-teacher', STUDENT],
  ])(
    '%s whose counterparty is of the other gender answers NOT_FOUND, nothing stored',
    async (_name, bearer, other) => {
      genders.set(other, 'male');
      const response = await upload({ bearer, filename: 'a.pdf', bytes: pdfBytes() });
      expect(response.status).toBe(404);
      await response.arrayBuffer();
      expect(stored()).toEqual([]);
    },
  );

  it.each(['pending_payment', 'completed', 'terminated_no_show', 'cancelled'] as const)(
    'a party on an enrollment %s answers CHAT_CLOSED, nothing stored',
    async (status) => {
      terms.set(ENROLLMENT, { ...(terms.get(ENROLLMENT) as ChatEnrollmentTerms), status });
      const response = await upload({ filename: 'a.pdf', bytes: pdfBytes() });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: { code: 'CHAT_CLOSED' } });
      expect(stored()).toEqual([]);
    },
  );

  it('refuses a suspended account ACCOUNT_RESTRICTED before the body is read', async () => {
    const response = await upload({ bearer: 't-suspended', filename: 'a.pdf', bytes: pdfBytes() });
    expect(response.status).toBe(403);
    await response.arrayBuffer();
    expect(trace).toEqual([]);
  });
});

describe('POST /uploads/chat: refused under the locks, the stored file removed', () => {
  it('an end committed before the lock answers CHAT_CLOSED and removes the file', async () => {
    underLock = () =>
      terms.set(ENROLLMENT, {
        ...(terms.get(ENROLLMENT) as ChatEnrollmentTerms),
        status: 'completed',
      });
    const response = await upload({ filename: 'a.pdf', bytes: pdfBytes() });
    expect(response.status).toBe(409);
    await response.arrayBuffer();
    expect(inserted).toEqual([]);
    expect(removed().map(({ args }) => args[0])).toEqual(stored().map(({ args }) => args[0]));
    expect(removed()).toHaveLength(1);
  });

  it('a gender corrected before the lock answers NOT_FOUND and removes the file', async () => {
    underLock = () => genders.set(TEACHER, 'male');
    const response = await upload({ filename: 'a.pdf', bytes: pdfBytes() });
    expect(response.status).toBe(404);
    await response.arrayBuffer();
    expect(removed()).toHaveLength(1);
  });

  it('a failed insert removes the stored file', async () => {
    insertFails = true;
    const response = await upload({ filename: 'a.pdf', bytes: pdfBytes() });
    expect(response.status).toBe(500);
    await response.arrayBuffer();
    expect(removed().map(({ args }) => args[0])).toEqual(stored().map(({ args }) => args[0]));
  });
});

// T066 of specs/004-sessions — the chat document's live event (FR-427, FR-496; research R-324,
// items 4 to 6; the note under T066, Q3 (a)): one `chat` event to each of the enrollment's two
// parties, read under the insert's locks, `mine` computed for each recipient, added through the
// upload's own after-commit list (`AcceptedUpload.live`) inside the insert's transaction and sent by
// the route once the handler resolves, nothing when it throws; never the document's name in a log.
describe('POST /uploads/chat: the live event (T066)', () => {
  const document = (mine: boolean) => ({
    type: 'chat',
    enrollmentId: ENROLLMENT,
    message: {
      messageId: MESSAGE,
      mine,
      attachment: { filename: 'تجويد.pdf', mime: 'application/pdf' },
      sentAt: SENT.toISOString(),
      purged: false,
    },
  });

  it.each([
    ['the student', 't-student', STUDENT, TEACHER],
    ['the teacher', 't-teacher', TEACHER, STUDENT],
  ])(
    'a document from %s reaches both parties once, after the commit, mine for the sender only',
    async (_name, bearer, sender, other) => {
      const response = await upload({ bearer, filename: 'تجويد.pdf', bytes: pdfBytes() });
      expect(response.status).toBe(201);
      await response.arrayBuffer();
      expect(published).toEqual([
        { to: [sender], event: document(true) },
        { to: [other], event: document(false) },
      ]);
      expect(trace.indexOf('publish')).toBeGreaterThan(trace.lastIndexOf('commit'));
    },
  );

  it.each([
    [
      'an end committed before the lock (CHAT_CLOSED)',
      () => {
        underLock = () =>
          terms.set(ENROLLMENT, {
            ...(terms.get(ENROLLMENT) as ChatEnrollmentTerms),
            status: 'completed',
          });
      },
    ],
    [
      'a gender corrected before the lock (NOT_FOUND)',
      () => {
        underLock = () => genders.set(TEACHER, 'male');
      },
    ],
    [
      'a failed insert',
      () => {
        insertFails = true;
      },
    ],
    [
      'a stranger',
      () =>
        terms.set(ENROLLMENT, {
          ...(terms.get(ENROLLMENT) as ChatEnrollmentTerms),
          studentUserId: STRANGER,
        }),
    ],
  ])('sends nothing on %s', async (_name, arrange) => {
    arrange();
    const response = await upload({ filename: 'تجويد.pdf', bytes: pdfBytes() });
    expect(response.status).toBeGreaterThanOrEqual(400);
    await response.arrayBuffer();
    expect(published).toEqual([]);
  });

  it('writes the document’s name in no log line', async () => {
    const response = await upload({ filename: 'اسم-سري.pdf', bytes: pdfBytes() });
    await response.arrayBuffer();
    insertFails = true;
    const failed = await upload({ filename: 'اسم-سري.pdf', bytes: pdfBytes() });
    await failed.arrayBuffer();
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.join('')).not.toContain('اسم-سري');
  });
});
