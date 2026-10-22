// T064 — the identity request (admin-surface.md "`documents`", app-surface.md
// `account.identityVerification.*`; FR-166). `requireIdentity` opens the request with its reason and
// sets the account `verification_required` (through the standing); the user's `submit` attaches the
// document they uploaded to the open request; `accept` closes it and reactivates the account (only
// from `verification_required`, owner's decision 2026-10-22); `requestAnother` keeps it open, the
// document cleared and the note the new reason the user reads. The admin views a document through a
// signed link (`documents.link`). Over a store held in memory that keeps the database's rules.
import { beforeEach, describe, expect, it } from 'vitest';

import { DomainError } from '../../platform/errors/domain-error.js';
import { ADMIN, MemoryRequestStore, TX, UPLOADED } from './__fixtures__/request-store.js';
import {
  IdentityVerificationService,
  VerificationRequestService,
} from './verification-request.service.js';

const NOW = new Date('2026-10-22T10:00:00Z');

let store: MemoryRequestStore;
let accepted: string[];
let links: { documentId: string; adminId: string }[];
let service: VerificationRequestService;
let person: IdentityVerificationService;

beforeEach(() => {
  store = new MemoryRequestStore();
  accepted = [];
  links = [];
  service = new VerificationRequestService({
    store,
    standing: {
      requireIdentity: async (_tx, userId) => {
        if (store.accounts.get(userId) !== 'active') return false;
        store.accounts.set(userId, 'verification_required');
        return true;
      },
      identityAccepted: async (_tx, userId) => {
        accepted.push(userId);
        if (store.accounts.get(userId) === 'verification_required')
          store.accounts.set(userId, 'active');
      },
    },
    links: {
      documentLinkFor: async (_tx, documentId, viewer) => {
        links.push({ documentId, adminId: viewer.kind === 'admin' ? viewer.adminId : '' });
        return {
          url: `https://storage.ijazah.test/${documentId}`,
          expiresAt: '2026-10-22T10:05:00Z',
        };
      },
    },
    now: () => NOW,
  });
  person = new IdentityVerificationService({ store });
});

async function refusal(call: Promise<unknown>): Promise<{ code: string; details?: unknown }> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return { code: thrown.code, details: thrown.details };
}

/** A person with an open request and, when `submitted`, the document attached; the ids. */
async function requested(submitted: boolean) {
  const userId = store.person();
  const { requestId } = await service.requireIdentity(TX, ADMIN, {
    userId,
    reason: 'بلاغ من طالب',
  });
  if (submitted) {
    await person.submit(userId, { documentType: 'passport', documentId: store.upload(userId) });
  }
  return { userId, requestId };
}

describe('requireIdentity', () => {
  it('opens the request with its reason and sets the account verification_required', async () => {
    const userId = store.person();
    const { requestId } = await service.requireIdentity(TX, ADMIN, {
      userId,
      reason: 'بلاغ من طالب',
    });
    expect(store.requests(userId)).toMatchObject([
      { id: requestId, status: 'open', reason: 'بلاغ من طالب', requestedBy: ADMIN, createdAt: NOW },
    ]);
    expect(store.accounts.get(userId)).toBe('verification_required');
  });

  it('refuses a second open request, and an account that is not active', async () => {
    const { userId } = await requested(false);
    const suspended = store.person('suspended');
    expect(await refusal(service.requireIdentity(TX, ADMIN, { userId, reason: 'x' }))).toEqual({
      code: 'CONFLICT',
      details: [{ path: 'userId', code: 'request_open' }],
    });
    expect(
      await refusal(service.requireIdentity(TX, ADMIN, { userId: suspended, reason: 'x' })),
    ).toEqual({
      code: 'CONFLICT',
      details: [{ path: 'userId', code: 'suspended' }],
    });
    expect(store.requests(suspended)).toEqual([]);
  });

  it('answers NOT_FOUND for a person who is not there', async () => {
    expect(
      (await refusal(service.requireIdentity(TX, ADMIN, { userId: ADMIN, reason: 'x' }))).code,
    ).toBe('NOT_FOUND');
  });
});

describe("the user's side", () => {
  it('get answers no request, then the open one, then its document', async () => {
    const userId = store.person();
    expect(await person.get(userId)).toEqual({ open: false });
    await service.requireIdentity(TX, ADMIN, { userId, reason: 'بلاغ من طالب' });
    expect(await person.get(userId)).toEqual({
      open: true,
      reason: 'بلاغ من طالب',
      requestedAt: NOW.toISOString(),
    });
    await person.submit(userId, { documentType: 'national_id', documentId: store.upload(userId) });
    expect(await person.get(userId)).toEqual({
      open: true,
      reason: 'بلاغ من طالب',
      requestedAt: NOW.toISOString(),
      documentType: 'national_id',
      submittedAt: UPLOADED.toISOString(),
    });
  });

  it("submit refuses another person's document, and no open request", async () => {
    const { userId } = await requested(false);
    const stranger = store.person();
    expect(
      (
        await refusal(
          person.submit(userId, { documentType: 'passport', documentId: store.upload(stranger) }),
        )
      ).code,
    ).toBe('DOCUMENT_NOT_OWNED');
    expect(
      (
        await refusal(
          person.submit(stranger, { documentType: 'passport', documentId: store.upload(stranger) }),
        )
      ).code,
    ).toBe('NOT_FOUND');
  });

  it('submit refuses a second document while the first waits for review', async () => {
    const { userId } = await requested(true);
    expect(
      (
        await refusal(
          person.submit(userId, { documentType: 'passport', documentId: store.upload(userId) }),
        )
      ).code,
    ).toBe('CONFLICT');
  });
});

describe('accept and requestAnother', () => {
  it('accept closes the request and reactivates the account', async () => {
    const { userId, requestId } = await requested(true);
    const answer = await service.accept(TX, ADMIN, { requestId });
    expect(store.requests(userId)[0]).toMatchObject({ status: 'satisfied', resolvedAt: NOW });
    expect(store.accounts.get(userId)).toBe('active');
    expect(accepted).toEqual([userId]);
    expect(answer).toEqual({ userId });
  });

  it('requestAnother keeps the request open, clears the document and makes the note its reason', async () => {
    const { userId, requestId } = await requested(true);
    await service.requestAnother(TX, ADMIN, { requestId, note: 'صورة الوجه الخلفي غير واضحة' });
    expect(store.requests(userId)[0]).toMatchObject({
      status: 'open',
      documentId: null,
      reason: 'صورة الوجه الخلفي غير واضحة',
    });
    expect(store.accounts.get(userId)).toBe('verification_required');
    await person.submit(userId, { documentType: 'passport', documentId: store.upload(userId) });
    expect(store.requests(userId)[0]?.documentId).not.toBeNull();
  });

  it.each(['accept', 'requestAnother'] as const)(
    '%s refuses a request with no document yet, and one already closed',
    async (action) => {
      const waiting = await requested(false);
      const input = { requestId: waiting.requestId, note: 'x' };
      expect(await refusal(service[action](TX, ADMIN, input))).toEqual({
        code: 'CONFLICT',
        details: [{ path: 'requestId', code: 'no_document' }],
      });
      const closed = await requested(true);
      await service.accept(TX, ADMIN, { requestId: closed.requestId });
      expect(
        await refusal(service[action](TX, ADMIN, { ...input, requestId: closed.requestId })),
      ).toEqual({
        code: 'CONFLICT',
        details: [{ path: 'requestId', code: 'satisfied' }],
      });
    },
  );

  it.each(['accept', 'requestAnother'] as const)(
    '%s answers NOT_FOUND for no request',
    async (action) => {
      expect(
        (await refusal(service[action](TX, ADMIN, { requestId: ADMIN, note: 'x' }))).code,
      ).toBe('NOT_FOUND');
    },
  );
});

describe('link', () => {
  it("answers the signed link for the administrator's view", async () => {
    const documentId = store.upload(store.person());
    expect(await service.link(TX, ADMIN, documentId)).toEqual({
      url: `https://storage.ijazah.test/${documentId}`,
      expiresAt: '2026-10-22T10:05:00Z',
    });
    expect(links).toEqual([{ documentId, adminId: ADMIN }]);
  });
});
