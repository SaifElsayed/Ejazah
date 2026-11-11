// T040 of specs/004-sessions (FR-475, FR-480; research R-314; contracts/admin-surface.md,
// `disputes.chat`) — the procedure as it is served: the page as `chat.list` answers it with each
// sender's role, audited `chat.read` with the dispute's enrollment as target, one entry per read; a
// service's refusal (`CONFLICT` once the dispute is not open, `NOT_FOUND`) recording nothing; refused
// to an anonymous caller and an unverified second factor, reaching and writing nothing. What it does
// is `dispute-matter.service.spec.ts`' and `chat/dispute-chat.spec.ts`'.
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { unusedAdminServices } from '../../surfaces/services.fixtures.js';
import { disputesAdminRouter } from './disputes-admin.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ disputes: disputesAdminRouter }));

const DISPUTE = '0199d0a0-0000-7000-8000-0000000000d1';
const CLOSED = '0199d0a0-0000-7000-8000-0000000000d2';
const MISSING = '0199d0a0-0000-7000-8000-0000000000d3';
const ENROLLMENT = '0199d0a0-0000-7000-8000-000000000800';
const MESSAGE = '0199d0a0-0000-7000-8000-0000000c0001';
const PAGE = {
  messages: [
    {
      messageId: MESSAGE,
      senderRole: 'teacher' as const,
      body: 'السلام عليكم',
      sentAt: '2026-11-09T08:00:00.000Z',
      purged: false,
    },
  ],
  nextCursor: MESSAGE,
};

function surface(page: unknown = PAGE) {
  const reached: unknown[][] = [];
  const contexts = adminContextsOver({
    disputes: {
      ...unusedAdminServices.disputes,
      chat: async (_tx, adminId, input) => {
        reached.push(['chat', adminId, input]);
        if (input.disputeId === CLOSED) {
          throw new DomainError('CONFLICT', undefined, {
            details: [{ path: 'cause', code: 'not_open' }],
          });
        }
        if (input.disputeId === MISSING) throw new DomainError('NOT_FOUND');
        return { enrollmentId: ENROLLMENT, page: page as typeof PAGE };
      },
    },
  });
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

describe('disputes.chat (FR-475)', () => {
  it('answers the page and audits chat.read on the enrollment, one entry per read', async () => {
    const { as, written, reached } = surface();
    expect(await as(VERIFIED).disputes.chat({ disputeId: DISPUTE })).toEqual(PAGE);
    expect(await as(VERIFIED).disputes.chat({ disputeId: DISPUTE, cursor: MESSAGE })).toEqual(PAGE);
    expect(reached).toEqual([
      ['chat', SPEC_ADMIN, { disputeId: DISPUTE }],
      ['chat', SPEC_ADMIN, { disputeId: DISPUTE, cursor: MESSAGE }],
    ]);
    const entry = {
      adminId: SPEC_ADMIN,
      action: 'chat.read',
      targetType: 'enrollment',
      targetId: ENROLLMENT,
    };
    expect(written).toEqual([entry, entry]);
  });

  it('names no party of the message beyond its role: mine and a storage key never cross', async () => {
    const { as } = surface({
      messages: [{ ...PAGE.messages[0], mine: true, attachmentKey: 'chat/x.pdf' }],
    });
    const { messages } = await as(VERIFIED).disputes.chat({ disputeId: DISPUTE });
    expect(messages).toEqual([PAGE.messages[0]]);
  });

  it('once the dispute is not open: CONFLICT, nothing audited', async () => {
    const { as, written } = surface();
    expect(await codeOf(as(VERIFIED).disputes.chat({ disputeId: CLOSED }))).toBe('CONFLICT');
    expect(written).toEqual([]);
  });

  it('no dispute: NOT_FOUND, nothing audited', async () => {
    const { as, written } = surface();
    expect(await codeOf(as(VERIFIED).disputes.chat({ disputeId: MISSING }))).toBe('NOT_FOUND');
    expect(written).toEqual([]);
  });

  it('a cursor that is not a message id is refused by the input schema, reaching nothing', async () => {
    const { as, reached } = surface();
    expect(await codeOf(as(VERIFIED).disputes.chat({ disputeId: DISPUTE, cursor: 'open:x' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(reached).toEqual([]);
  });

  it.each([
    ['an anonymous caller', null, 'UNAUTHENTICATED'],
    ['an unverified second factor', { ...VERIFIED, mfaVerified: false }, 'MFA_REQUIRED'],
  ] as const)('%s is refused, reaching and writing nothing', async (_name, session, code) => {
    const { as, written, reached } = surface();
    expect(await codeOf(as(session).disputes.chat({ disputeId: DISPUTE }))).toBe(code);
    expect(reached).toEqual([]);
    expect(written).toEqual([]);
  });
});
