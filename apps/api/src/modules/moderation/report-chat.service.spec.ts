// 005:T034 (R1a; SRS FR-SESS-13 as amended, DEC-100; contracts/admin-surface.md, `reports.chat`; the
// note under T034) — an administrator's read of an enrollment's chat under a report, over a store and
// a `ReportChat` port held in memory. Written before the service, and run red first.
//
// - An open session or chat report opens its enrollment's chat: the port is asked with the report's
//   enrollment (never the input's) and the cursor, and the answer names the enrollment the router
//   audits `chat.read` on.
// - Refused before the port is asked: an unknown report NOT_FOUND; a report no longer open (actioned
//   or dismissed) CONFLICT with `details.cause` `not_open`; a profile report, which names no
//   enrollment, NOT_FOUND; an enrollment other than the report's NOT_FOUND. An enrollment the port no
//   longer answers is NOT_FOUND. As `disputes.chat` refuses (`dispute-matter.service.ts`).
// - Each refusal one info line of ids and its reason, marked «logged»; never the reporter's words.
import { beforeEach, describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import { isRefusalLogged } from '../../platform/errors/logged-refusal.js';
import type { ReportChat, ReportChatPage } from './report-chat.port.js';
import { createReportChat } from './report-chat.service.js';
import type { UserReportRow } from './user-report.repository.js';

const ADMIN = '0199d0a0-0000-7000-8000-00000000c2b9';
const REPORT = '0199d0a0-0000-7000-8000-00000000c2f1';
const MISSING = '0199d0a0-0000-7000-8000-00000000c2ff';
const STUDENT = '0199d0a0-0000-7000-8000-00000000c2a1';
const TEACHER = '0199d0a0-0000-7000-8000-00000000c2a2';
const SESSION = '0199d0a0-0000-7000-8000-00000000c2d1';
const ENROLLMENT = '0199d0a0-0000-7000-8000-00000000c2e1';
const OTHER_ENROLLMENT = '0199d0a0-0000-7000-8000-00000000c2e2';
const MESSAGE = '0199d0a0-0000-7000-8000-00000000c2c1';
const REASON = 'كلام جارح في المحادثة: سرّ لا يُكتب في السجل';

const TX = {} as Transaction;

const PAGE: ReportChatPage = {
  messages: [
    {
      messageId: MESSAGE,
      senderRole: 'teacher',
      body: 'السلام عليكم',
      sentAt: '2026-11-18T09:00:00.000Z',
      purged: false,
    },
  ],
  nextCursor: MESSAGE,
};

let rows: Map<string, UserReportRow>;
let asked: { enrollmentId: string; cursor: string | undefined }[];
let pageAnswer: ReportChatPage | null;
let lines: { fields: Record<string, unknown>; message: string }[];

beforeEach(() => {
  rows = new Map();
  asked = [];
  pageAnswer = PAGE;
  lines = [];
});

const log = {
  info: (fields: Record<string, unknown>, message: string) => void lines.push({ fields, message }),
};

const chat: ReportChat = {
  chatPage: async (_tx, enrollmentId, cursor) => {
    asked.push({ enrollmentId, cursor });
    return pageAnswer;
  },
};

const service = createReportChat({
  chat,
  store: { reportOf: async (_tx, reportId) => rows.get(reportId) ?? null },
});

function reportRow(change: Partial<UserReportRow> = {}): UserReportRow {
  return {
    id: REPORT,
    context: 'chat',
    status: 'open',
    reporterUserId: STUDENT,
    reportedUserId: TEACHER,
    sessionId: null,
    enrollmentId: ENROLLMENT,
    reason: REASON,
    createdAt: new Date('2026-11-18T08:00:00.000Z'),
    resolutionNotes: null,
    resolvedAt: null,
    resolvedByAdminId: null,
    ...change,
  };
}

const RESOLVED = {
  resolutionNotes: 'تم',
  resolvedAt: new Date('2026-11-18T10:00:00.000Z'),
  resolvedByAdminId: ADMIN,
};

async function refused(input: { reportId: string; enrollmentId: string }): Promise<DomainError> {
  const thrown: unknown = await service.chat(TX, ADMIN, input, log).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(DomainError);
  return thrown as DomainError;
}

describe('reports.chat: an open report opens its enrollment’s chat (005:T034)', () => {
  it('answers a chat report’s page, asking the port with the report’s enrollment and the cursor', async () => {
    rows.set(REPORT, reportRow());
    const read = await service.chat(
      TX,
      ADMIN,
      { reportId: REPORT, enrollmentId: ENROLLMENT, cursor: MESSAGE },
      log,
    );
    expect(read).toEqual({ enrollmentId: ENROLLMENT, page: PAGE });
    expect(asked).toEqual([{ enrollmentId: ENROLLMENT, cursor: MESSAGE }]);
    expect(lines).toEqual([]);
  });

  it('answers a session report’s page the same way, the first page with no cursor', async () => {
    rows.set(REPORT, reportRow({ context: 'session', sessionId: SESSION }));
    const read = await service.chat(TX, ADMIN, { reportId: REPORT, enrollmentId: ENROLLMENT }, log);
    expect(read).toEqual({ enrollmentId: ENROLLMENT, page: PAGE });
    expect(asked).toEqual([{ enrollmentId: ENROLLMENT, cursor: undefined }]);
  });
});

describe('reports.chat: refused, the port never asked (005:T034)', () => {
  it('refuses an unknown report NOT_FOUND', async () => {
    const error = await refused({ reportId: MISSING, enrollmentId: ENROLLMENT });
    expect(error.code).toBe('NOT_FOUND');
    expect(asked).toEqual([]);
    expect(lines[0]?.fields).toMatchObject({
      adminId: ADMIN,
      reportId: MISSING,
      reason: 'no_report',
    });
  });

  it.each(['actioned', 'dismissed'] as const)(
    'refuses a report %s, no longer open, CONFLICT not_open',
    async (status) => {
      rows.set(REPORT, reportRow({ status, ...RESOLVED }));
      const error = await refused({ reportId: REPORT, enrollmentId: ENROLLMENT });
      expect(error.code).toBe('CONFLICT');
      expect(error.details).toEqual([{ path: 'cause', code: 'not_open' }]);
      expect(asked).toEqual([]);
      expect(lines[0]?.fields).toMatchObject({ reportId: REPORT, reason: 'not_open' });
    },
  );

  it('refuses a profile report, which names no enrollment, NOT_FOUND no_enrollment', async () => {
    rows.set(REPORT, reportRow({ context: 'profile', enrollmentId: null }));
    const error = await refused({ reportId: REPORT, enrollmentId: ENROLLMENT });
    expect(error.code).toBe('NOT_FOUND');
    expect(asked).toEqual([]);
    expect(lines[0]?.fields).toMatchObject({ reportId: REPORT, reason: 'no_enrollment' });
  });

  it('refuses an enrollment other than the report’s NOT_FOUND', async () => {
    rows.set(REPORT, reportRow());
    const error = await refused({ reportId: REPORT, enrollmentId: OTHER_ENROLLMENT });
    expect(error.code).toBe('NOT_FOUND');
    expect(asked).toEqual([]);
    expect(lines[0]?.fields).toMatchObject({
      reportId: REPORT,
      enrollmentId: OTHER_ENROLLMENT,
      reason: 'other_enrollment',
    });
  });

  it('refuses NOT_FOUND when the port no longer answers the enrollment', async () => {
    rows.set(REPORT, reportRow());
    pageAnswer = null;
    const error = await refused({ reportId: REPORT, enrollmentId: ENROLLMENT });
    expect(error.code).toBe('NOT_FOUND');
    expect(lines[0]?.fields).toMatchObject({ reportId: REPORT, reason: 'no_enrollment' });
  });

  it('marks each refusal logged, one line of ids, never the reporter’s words', async () => {
    rows.set(REPORT, reportRow({ status: 'dismissed', ...RESOLVED }));
    const error = await refused({ reportId: REPORT, enrollmentId: ENROLLMENT });
    expect(isRefusalLogged(error)).toBe(true);
    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines)).not.toContain('سرّ');
  });
});
