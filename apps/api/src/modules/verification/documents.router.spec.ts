// T068 — the administrator surface's `documents` and `users` namespaces as they are served
// (admin-surface.md "`documents`"; FR-160, FR-166, NFR-SEC-3). Every procedure is the administrator
// kind (refusals, one transaction, the entry with the session's actor, nothing of a refused call).
// Viewing a document is audited as `document.view` on the document; the identity request's three
// actions on the person (with the reason and the new request) and on the request (with the note).
// What the requests do is `verification-request.service.spec.ts`'s.
import type { UsersGetOutput, UsersListOutput } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { RateLimiter } from '../../platform/guards/rate-limit.guard.js';
import { publisherOn } from '../../platform/live/live-publisher.js';
import { createLogger } from '../../platform/logging/logger.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import { type AdminSurfaceServices, createAdminContext } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { documentsRouter, usersRouter } from './documents.router.js';

const callerFor = createAdminCallerFactory(
  createAdminRouter({ documents: documentsRouter, users: usersRouter }),
);

const DOCUMENT = '0199d0a0-0000-7000-8000-0000000000d1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000e1';
const PERSON = '0199d0a0-0000-7000-8000-0000000000c1';
/** T081 of specs/004-sessions: an administrator's deletion at the owner's request. */
const DELETION = {
  targetUserId: PERSON,
  reason: 'طلب صاحب الحساب الحذف عبر الدعم',
  idempotencyKey: 'users-delete-key-0001',
};
const NEXT_REQUEST = '0199d0a0-0000-7000-8000-0000000000e2';

// T058 of specs/004-sessions: what the user directory's stand-in answers.
const USERS_PAGE: UsersListOutput = {
  items: [
    {
      userId: PERSON,
      displayName: 'مريم',
      deleted: false,
      role: 'student',
      accountStatus: 'active',
    },
  ],
  nextCursor: PERSON,
};
const USER_RECORD: UsersGetOutput = {
  userId: PERSON,
  profile: {
    displayName: 'مريم',
    email: null,
    joinedAt: '2026-09-01T08:00:00.000Z',
    deleted: false,
  },
  role: 'student',
  gender: 'female',
  isMinor: true,
  verificationStatus: null,
  accountStatus: 'active',
  cancellationRequests: { total: 2, recent: 1 },
  // T072 of specs/004-sessions: the hold's end, none here (rule d).
  enrollmentsSlotHeldUntil: null,
  // B42b, T075 of specs/004-sessions (rule d): the ban restore window's days (Q-O2 (a)).
  banRestoreWindowDays: 14,
};

function surface() {
  const reached: unknown[][] = [];
  const record =
    <T>(name: string, answer: T) =>
    async (...args: unknown[]): Promise<T> => {
      reached.push([name, ...args.slice(1)]);
      return answer;
    };
  const documents: AdminSurfaceServices['documents'] = {
    link: record('link', {
      url: `https://storage.ijazah.test/${DOCUMENT}`,
      expiresAt: '2026-10-22T10:05:00.000Z',
    }),
    requireIdentity: record('requireIdentity', { requestId: REQUEST }),
    accept: record('accept', { userId: PERSON }),
    requestAnother: record('requestAnother', {
      userId: PERSON,
      requestId: NEXT_REQUEST,
      documentId: DOCUMENT,
    }),
  };
  // T058 of specs/004-sessions: the user directory, answering a page and a record.
  const users: AdminSurfaceServices['users'] = {
    list: record('users.list', USERS_PAGE),
    get: record('users.get', USER_RECORD),
    // T081 of specs/004-sessions: the administrator's deletion, its first run.
    delete: record('users.delete', { replayed: false }),
  };
  const contexts = adminContextsOver({ documents, users });
  return {
    reached,
    written: contexts.written,
    as: (session: Parameters<typeof contexts.contextFor>[0]) =>
      callerFor(contexts.contextFor(session)),
  };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

type Caller = ReturnType<typeof callerFor>;

/** T081 of specs/004-sessions: a deletion no case of the directory reaches. */
const unusedDeletion = async (): Promise<never> => {
  throw new Error('users.delete is not reached here');
};

const CALLS: Record<string, (caller: Caller) => Promise<unknown>> = {
  'documents.link': (caller) => caller.documents.link({ documentId: DOCUMENT }),
  'users.requireIdentity': (caller) =>
    caller.users.requireIdentity({ targetUserId: PERSON, reason: 'بلاغ من طالب' }),
  'documents.accept': (caller) => caller.documents.accept({ requestId: REQUEST }),
  'documents.requestAnother': (caller) =>
    caller.documents.requestAnother({ requestId: REQUEST, note: 'الوجه الخلفي غير واضح' }),
  'users.list': (caller) => caller.users.list({ name: 'مر' }),
  'users.get': (caller) => caller.users.get({ targetUserId: PERSON }),
  // T081 of specs/004-sessions.
  'users.delete': (caller) => caller.users.delete(DELETION),
};

describe('the administrator kind', () => {
  it.each(Object.keys(CALLS))(
    '%s refuses an anonymous caller and an unverified second factor, writing nothing',
    async (path) => {
      const { as, written, reached } = surface();
      const call = CALLS[path]!;
      expect(await codeOf(call(as(null)))).toBe('UNAUTHENTICATED');
      expect(await codeOf(call(as({ ...VERIFIED, mfaVerified: false })))).toBe('MFA_REQUIRED');
      expect(written).toEqual([]);
      expect(reached).toEqual([]);
    },
  );
});

describe('the audit entries', () => {
  it('documents.link answers the signed link and audits document.view on the document', async () => {
    const { as, written, reached } = surface();
    expect(await CALLS['documents.link']!(as(VERIFIED))).toEqual({
      url: `https://storage.ijazah.test/${DOCUMENT}`,
      expiresAt: '2026-10-22T10:05:00.000Z',
    });
    expect(reached).toEqual([['link', SPEC_ADMIN, DOCUMENT]]);
    expect(written).toEqual([
      { adminId: SPEC_ADMIN, action: 'document.view', targetType: 'document', targetId: DOCUMENT },
    ]);
  });

  it('users.requireIdentity audits on the person with the reason and the new request', async () => {
    const { as, written } = surface();
    await CALLS['users.requireIdentity']!(as(VERIFIED));
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'user.require_identity',
        targetType: 'user',
        targetId: PERSON,
        reason: 'بلاغ من طالب',
        after: { requestId: REQUEST },
      },
    ]);
  });

  it('documents.accept and requestAnother audit on the request, with the note', async () => {
    const { as, written } = surface();
    await as(VERIFIED).documents.accept({ requestId: REQUEST, note: 'مطابقة' });
    await CALLS['documents.requestAnother']!(as(VERIFIED));
    const target = { adminId: SPEC_ADMIN, targetType: 'verification_request', targetId: REQUEST };
    expect(written).toEqual([
      { ...target, action: 'verification_request.accept', reason: 'مطابقة' },
      {
        ...target,
        action: 'verification_request.request_another',
        reason: 'الوجه الخلفي غير واضح',
        before: { documentId: DOCUMENT },
        after: { requestId: NEXT_REQUEST },
      },
    ]);
  });
});

describe('the inputs', () => {
  it.each([
    [
      'a request for identity without a reason',
      (caller: Caller) => caller.users.requireIdentity({ targetUserId: PERSON, reason: '' }),
    ],
    [
      'a request for another document without a note',
      (caller: Caller) => caller.documents.requestAnother({ requestId: REQUEST, note: ' ' }),
    ],
    [
      'a document id that is not one',
      (caller: Caller) => caller.documents.link({ documentId: 'x' }),
    ],
  ])('refuses %s as VALIDATION_FAILED, reaching nothing', async (_case, call) => {
    const { as, written, reached } = surface();
    expect(await codeOf(call(as(VERIFIED)))).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});

// T058 of specs/004-sessions (FR-481, FR-459; SRS FR-ADMIN-4; contracts/admin-surface.md, "`users`"):
// the user directory's two reads. `users.list` is audited `users.listed` on the reader (the `admin`
// target of every list read), `users.get` `user.viewed` on the user, neither with a before or an
// after; a service's refusal is answered as it is and writes nothing. What each reads is
// `user-directory.service.spec.ts`'.
describe('the user directory (T058 of specs/004-sessions)', () => {
  it('users.list hands the reader and the input to the directory and audits users.listed on the reader', async () => {
    const { as, written, reached } = surface();
    expect(await CALLS['users.list']!(as(VERIFIED))).toEqual(USERS_PAGE);
    expect(reached).toEqual([['users.list', SPEC_ADMIN, { name: 'مر' }]]);
    expect(written).toEqual([
      { adminId: SPEC_ADMIN, action: 'users.listed', targetType: 'admin', targetId: SPEC_ADMIN },
    ]);
  });

  it('users.get hands the reader and the person to the directory and audits user.viewed on the user', async () => {
    const { as, written, reached } = surface();
    expect(await CALLS['users.get']!(as(VERIFIED))).toEqual(USER_RECORD);
    expect(reached).toEqual([['users.get', SPEC_ADMIN, { targetUserId: PERSON }]]);
    expect(written).toEqual([
      { adminId: SPEC_ADMIN, action: 'user.viewed', targetType: 'user', targetId: PERSON },
    ]);
  });

  it('users.get answers no date of birth, even one a service leaked, and its audit entry carries none (PDPL)', async () => {
    const leaked = { ...USER_RECORD, dateOfBirth: '2012-03-04' } as UsersGetOutput;
    const contexts = adminContextsOver({
      // T081 (rule d): the deletion, never reached here.
      users: { list: async () => USERS_PAGE, get: async () => leaked, delete: unusedDeletion },
    });
    const answer = await callerFor(contexts.contextFor(VERIFIED)).users.get({
      targetUserId: PERSON,
    });
    expect(JSON.stringify(answer)).not.toMatch(/birth|2012-03-04/);
    expect(JSON.stringify(contexts.written)).not.toMatch(/birth|2012-03-04/);
    expect(contexts.written).toEqual([
      { adminId: SPEC_ADMIN, action: 'user.viewed', targetType: 'user', targetId: PERSON },
    ]);
  });

  it('users.get answers the directory refusal NOT_FOUND, writing nothing', async () => {
    const contexts = adminContextsOver({
      users: {
        list: async () => USERS_PAGE,
        get: async () => {
          throw new DomainError('NOT_FOUND');
        },
        // T081 (rule d): the deletion, never reached here.
        delete: unusedDeletion,
      },
    });
    expect(
      await codeOf(callerFor(contexts.contextFor(VERIFIED)).users.get({ targetUserId: PERSON })),
    ).toBe('NOT_FOUND');
    expect(contexts.written).toEqual([]);
  });

  it.each([
    ['a user id that is not one', (caller: Caller) => caller.users.get({ targetUserId: 'x' })],
    ['a blank name', (caller: Caller) => caller.users.list({ name: '  ' })],
    ['a cursor that is no id', (caller: Caller) => caller.users.list({ cursor: 'x' })],
  ])('refuses %s as VALIDATION_FAILED, reaching nothing', async (_case, call) => {
    const { as, written, reached } = surface();
    expect(await codeOf(call(as(VERIFIED)))).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('users.list over rate_limit_search is refused RATE_LIMITED, opening no transaction and writing nothing (R-SEC-6, C2)', async () => {
    const counted: unknown[][] = [];
    const written: unknown[] = [];
    let opened = 0;
    const rateLimiter = {
      check: async (key: string, subject: unknown, procedure: string) => {
        counted.push([key, subject, procedure]);
        throw new DomainError('RATE_LIMITED');
      },
    } as unknown as RateLimiter;
    const context = createAdminContext({
      session: VERIFIED,
      log: createLogger({ level: 'info', destination: { write: () => undefined } }),
      administration: {
        transactions: {
          run: async () => {
            opened += 1;
            throw new Error('no transaction may open');
          },
        },
        auditWriter: {
          write: async (_tx, entry) => {
            written.push(entry);
          },
        },
      },
      services: unusedAdminServices,
      rateLimiter,
      clientAddress: '203.0.113.9',
    });
    expect(await codeOf(callerFor(context).users.list({ name: 'مر' }))).toBe('RATE_LIMITED');
    expect(counted).toEqual([
      ['rate_limit_search', { kind: 'administrator', adminId: SPEC_ADMIN }, 'users.list'],
    ]);
    expect(opened).toBe(0);
    expect(written).toEqual([]);
  });
});

// T081 of specs/004-sessions (FR-512; SRS FR-ADMIN-22; the notes under T081, Q-O2 (a), Q-R13 (a)):
// `users.delete` beside `users.get`, an administrator kind keyed by its service on the kind's
// transaction, with its own limit, `rate_limit_admin_user_delete`, checked before the transaction;
// audited `user.deleted_by_admin` on the person with the reason on its first run only. The work the
// deletion queues on the transaction's list (`publisherOn(tx)`'s `afterCommitDo`) runs once the
// kind's transaction has committed, and never after a rollback. What the deletion does is
// `deletion.service.spec.ts`' and the db-integrity specs'.
describe('the administrator’s deletion (T081 of specs/004-sessions)', () => {
  function deletingWith(remove: AdminSurfaceServices['users']['delete']) {
    return adminContextsOver({
      users: { list: async () => USERS_PAGE, get: async () => USER_RECORD, delete: remove },
    });
  }

  it('users.delete hands the reader and the input to the deletion and audits user.deleted_by_admin on the person, with the reason', async () => {
    const { as, written, reached } = surface();
    expect(await CALLS['users.delete']!(as(VERIFIED))).toBeUndefined();
    expect(reached).toEqual([['users.delete', SPEC_ADMIN, DELETION]]);
    expect(written).toEqual([
      {
        adminId: SPEC_ADMIN,
        action: 'user.deleted_by_admin',
        targetType: 'user',
        targetId: PERSON,
        reason: DELETION.reason,
      },
    ]);
  });

  it('a replay of the key records no second entry', async () => {
    const contexts = deletingWith(async () => ({ replayed: true }));
    await callerFor(contexts.contextFor(VERIFIED)).users.delete(DELETION);
    expect(contexts.written).toEqual([]);
  });

  it('answers the deletion’s NOT_FOUND, writing nothing', async () => {
    const contexts = deletingWith(async () => {
      throw new DomainError('NOT_FOUND');
    });
    expect(await codeOf(callerFor(contexts.contextFor(VERIFIED)).users.delete(DELETION))).toBe(
      'NOT_FOUND',
    );
    expect(contexts.written).toEqual([]);
  });

  it('runs the work the deletion queued on the transaction once the call has committed, and never after a rollback', async () => {
    const done: string[] = [];
    const queueing = deletingWith(async (tx) => {
      publisherOn(tx)?.afterCommitDo?.(() => void done.push('after the commit'));
      done.push('in the transaction');
      return { replayed: false };
    });
    await callerFor(queueing.contextFor(VERIFIED)).users.delete(DELETION);
    expect(done).toEqual(['in the transaction', 'after the commit']);

    const rolledBack: string[] = [];
    const refusing = deletingWith(async (tx) => {
      publisherOn(tx)?.afterCommitDo?.(() => void rolledBack.push('after the commit'));
      throw new DomainError('NOT_FOUND');
    });
    await codeOf(callerFor(refusing.contextFor(VERIFIED)).users.delete(DELETION));
    expect(rolledBack).toEqual([]);
  });

  it.each([
    ['a blank reason', { ...DELETION, reason: '  ' }],
    ['no idempotency key', { targetUserId: PERSON, reason: DELETION.reason }],
    ['a person who is no id', { ...DELETION, targetUserId: 'x' }],
  ])('refuses %s as VALIDATION_FAILED, reaching nothing', async (_case, input) => {
    const { as, written, reached } = surface();
    expect(
      await codeOf(as(VERIFIED).users.delete(input as Parameters<Caller['users']['delete']>[0])),
    ).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });

  it('over rate_limit_admin_user_delete is refused RATE_LIMITED, opening no transaction and writing nothing', async () => {
    const counted: unknown[][] = [];
    let opened = 0;
    const context = createAdminContext({
      session: VERIFIED,
      log: createLogger({ level: 'info', destination: { write: () => undefined } }),
      administration: {
        transactions: {
          run: async () => {
            opened += 1;
            throw new Error('no transaction may open');
          },
        },
        auditWriter: { write: async () => undefined },
      },
      services: unusedAdminServices,
      rateLimiter: {
        check: async (key: string, subject: unknown, procedure: string) => {
          counted.push([key, subject, procedure]);
          throw new DomainError('RATE_LIMITED');
        },
      } as unknown as RateLimiter,
      clientAddress: '203.0.113.9',
    });
    expect(await codeOf(callerFor(context).users.delete(DELETION))).toBe('RATE_LIMITED');
    expect(counted).toEqual([
      [
        'rate_limit_admin_user_delete',
        { kind: 'administrator', adminId: SPEC_ADMIN },
        'users.delete',
      ],
    ]);
    expect(opened).toBe(0);
  });
});
