// T068 — the administrator surface's `documents` and `users` namespaces as they are served
// (admin-surface.md "`documents`"; FR-160, FR-166, NFR-SEC-3). Every procedure is the administrator
// kind (refusals, one transaction, the entry with the session's actor, nothing of a refused call).
// Viewing a document is audited as `document.view` on the document; the identity request's three
// actions on the person (with the reason and the new request) and on the request (with the note).
// What the requests do is `verification-request.service.spec.ts`'s.
import { describe, expect, it } from 'vitest';

import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import type { AdminSurfaceServices } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { documentsRouter, usersRouter } from './documents.router.js';

const callerFor = createAdminCallerFactory(
  createAdminRouter({ documents: documentsRouter, users: usersRouter }),
);

const DOCUMENT = '0199d0a0-0000-7000-8000-0000000000d1';
const REQUEST = '0199d0a0-0000-7000-8000-0000000000e1';
const PERSON = '0199d0a0-0000-7000-8000-0000000000c1';
const NEXT_REQUEST = '0199d0a0-0000-7000-8000-0000000000e2';

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
  const contexts = adminContextsOver({ documents });
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

const CALLS: Record<string, (caller: Caller) => Promise<unknown>> = {
  'documents.link': (caller) => caller.documents.link({ documentId: DOCUMENT }),
  'users.requireIdentity': (caller) =>
    caller.users.requireIdentity({ targetUserId: PERSON, reason: 'بلاغ من طالب' }),
  'documents.accept': (caller) => caller.documents.accept({ requestId: REQUEST }),
  'documents.requestAnother': (caller) =>
    caller.documents.requestAnother({ requestId: REQUEST, note: 'الوجه الخلفي غير واضح' }),
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
