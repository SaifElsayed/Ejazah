// T069 — the administrator surface's `credentials` namespace as it is served (admin-surface.md
// "`credentials`"; FR-163, FR-164). Every procedure is the administrator kind: it refuses an
// anonymous caller and one whose second factor is not verified, runs in one transaction, and writes
// the action's audit entry with the actor from the session, nothing of a refused call. T174 (SRS
// DEC-97): a rejection's, a request for another document's and a correction's entry, and an
// approval's with a note, record that a reason was given (`note_given`), never its text; an approval's
// and a correction's before and after hold no name and no chain. The list and the panel are reads
// naming the reader; the panel answers the credential's history. What the review does is
// `credential-review.service.spec.ts`'s.
import { AUDIT_REASON_NOTE_GIVEN } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import { toErrorShape } from '../../surfaces/procedures.js';
import { type CredentialsCaller, NOW, surfaceOver } from './credentials-admin.fixtures.js';
import { ADMIN, MemoryReviewStore, TEACHER } from './credential-review.fixtures.js';

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (thrown === undefined) throw new Error('expected a refusal');
  return (toErrorShape(thrown as Parameters<typeof toErrorShape>[0]).body as { code: string }).code;
}

const CREDENTIAL = '0199d0a0-0000-7000-8000-0000000000e1';

const TRANSCRIPTION = {
  holderName: 'عمر بن فاروق',
  riwaya: 'حفص عن عاصم',
  chain: [{ names: ['رسول الله ﷺ'] }, { names: ['جبريل'] }],
};

describe('the administrator kind', () => {
  const calls = {
    'credentials.list': (caller: CredentialsCaller) =>
      caller.credentials.list({ tab: 'pending', page: 1 }),
    'credentials.get': (caller: CredentialsCaller) =>
      caller.credentials.get({ credentialId: CREDENTIAL }),
    'credentials.approve': (caller: CredentialsCaller) =>
      caller.credentials.approve({ credentialId: CREDENTIAL, ...TRANSCRIPTION }),
    'credentials.reject': (caller: CredentialsCaller) =>
      caller.credentials.reject({ credentialId: CREDENTIAL, reason: 'سبب' }),
    'credentials.requestDocument': (caller: CredentialsCaller) =>
      caller.credentials.requestDocument({ credentialId: CREDENTIAL, reason: 'سبب' }),
    'credentials.correct': (caller: CredentialsCaller) =>
      caller.credentials.correct({ credentialId: CREDENTIAL, riwaya: 'ورش', reason: 'سبب' }),
  } as const;

  it.each(Object.keys(calls) as (keyof typeof calls)[])(
    '%s refuses an anonymous caller and an unverified second factor, writing nothing',
    async (path) => {
      const surface = surfaceOver(new MemoryReviewStore());
      expect(await codeOf(calls[path](surface.as(null)))).toBe('UNAUTHENTICATED');
      expect(
        await codeOf(
          calls[path](surface.as({ adminId: ADMIN, sessionId: ADMIN, mfaVerified: false })),
        ),
      ).toBe('MFA_REQUIRED');
      expect(surface.written).toEqual([]);
    },
  );
});

describe('credentials.approve', () => {
  it('audits credential.approve with no name, no chain and no note: the note is said given (T174)', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const surface = surfaceOver(store);
    await surface
      .verified()
      .credentials.approve({ credentialId, ...TRANSCRIPTION, note: 'السند مقروء كاملًا' });
    expect(surface.written).toEqual([
      {
        adminId: ADMIN,
        action: 'credential.approve',
        targetType: 'credential',
        targetId: credentialId,
        reason: AUDIT_REASON_NOTE_GIVEN,
        before: { riwaya: null, tariq: null, chainLength: 0, holderNameChanged: false },
        after: { riwaya: 'حفص عن عاصم', tariq: null, chainLength: 2, holderNameChanged: true },
      },
    ]);
    const entry = JSON.stringify(surface.written);
    for (const text of ['عمر بن فاروق', 'جبريل', 'السند مقروء كاملًا']) {
      expect(entry).not.toContain(text);
    }
  });

  it('writes no reason without a note', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const surface = surfaceOver(store);
    await surface.verified().credentials.approve({ credentialId, ...TRANSCRIPTION });
    expect(surface.written[0]).not.toHaveProperty('reason');
  });

  it.each([
    ['an empty chain', { chain: [] }],
    ['a generation with no name', { chain: [{ names: [] }] }],
    ['a blank holder name', { holderName: '   ' }],
  ])('refuses %s as VALIDATION_FAILED, writing nothing', async (_case, change) => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const surface = surfaceOver(store);
    expect(
      await codeOf(
        surface.verified().credentials.approve({ credentialId, ...TRANSCRIPTION, ...change }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(store.held(credentialId).status).toBe('pending');
    expect(surface.written).toEqual([]);
  });

  it('keeps nothing of a refused approval: a second approved credential writes no entry', async () => {
    const store = new MemoryReviewStore();
    store.plant({ status: 'approved' });
    const credentialId = store.plant();
    const surface = surfaceOver(store);
    expect(
      await codeOf(surface.verified().credentials.approve({ credentialId, ...TRANSCRIPTION })),
    ).toBe('CONFLICT');
    expect(surface.written).toEqual([]);
  });
});

describe('credentials.reject and credentials.requestDocument', () => {
  it.each([
    ['reject', 'credential.reject', 'rejected'],
    ['requestDocument', 'credential.request_document', 'needs_document'],
  ] as const)(
    '%s audits %s with the reason said given, not its text (T174)',
    async (procedure, action, status) => {
      const store = new MemoryReviewStore();
      const credentialId = store.plant();
      const surface = surfaceOver(store);
      await surface.verified().credentials[procedure]({ credentialId, reason: 'الختم غير واضح' });
      expect(store.held(credentialId)).toMatchObject({ status, reviewedAt: NOW });
      expect(surface.written).toEqual([
        {
          adminId: ADMIN,
          action,
          targetType: 'credential',
          targetId: credentialId,
          reason: AUDIT_REASON_NOTE_GIVEN,
        },
      ]);
      expect(JSON.stringify(surface.written)).not.toContain('الختم غير واضح');
    },
  );

  it("requestDocument's entry holds the application it set waiting on the applicant (T155)", async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    store.applyingAs(TEACHER, 'in_review');
    const surface = surfaceOver(store);
    await surface
      .verified()
      .credentials.requestDocument({ credentialId, reason: 'الختم غير واضح' });
    expect(store.applications.get(TEACHER)).toMatchObject({
      status: 'needs_document',
      note: 'الختم غير واضح',
    });
    expect(surface.written).toEqual([
      {
        adminId: ADMIN,
        action: 'credential.request_document',
        targetType: 'credential',
        targetId: credentialId,
        reason: AUDIT_REASON_NOTE_GIVEN,
        before: { applicationStatus: 'in_review' },
        after: { applicationStatus: 'needs_document' },
      },
    ]);
  });

  it.each(['reject', 'requestDocument'] as const)(
    '%s needs a reason: a blank one is VALIDATION_FAILED',
    async (procedure) => {
      const store = new MemoryReviewStore();
      const credentialId = store.plant();
      const surface = surfaceOver(store);
      expect(
        await codeOf(surface.verified().credentials[procedure]({ credentialId, reason: '  ' })),
      ).toBe('VALIDATION_FAILED');
      expect(store.held(credentialId).status).toBe('pending');
      expect(surface.written).toEqual([]);
    },
  );
});

describe('credentials.correct', () => {
  it('audits credential.correct with the reason said given, and no name or chain before and after (T174)', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant({ status: 'approved' });
    const surface = surfaceOver(store);
    await surface.verified().credentials.correct({
      credentialId,
      riwaya: 'حفص عن عاصم من طريق الشاطبية',
      reason: 'الرواية كما في الملف',
    });
    const [entry] = surface.written;
    expect(entry).toMatchObject({
      adminId: ADMIN,
      action: 'credential.correct',
      targetType: 'credential',
      targetId: credentialId,
      reason: AUDIT_REASON_NOTE_GIVEN,
      before: {
        riwaya: 'حفص عن عاصم',
        tariq: 'الشاطبية',
        chainLength: 2,
        holderNameChanged: false,
      },
      after: {
        riwaya: 'حفص عن عاصم من طريق الشاطبية',
        tariq: 'الشاطبية',
        chainLength: 2,
        holderNameChanged: false,
      },
    });
    const written = JSON.stringify(surface.written);
    for (const text of ['عمر بن فاروق', 'جبريل', 'الرواية كما في الملف']) {
      expect(written).not.toContain(text);
    }
  });

  it.each([
    ['without a reason', { riwaya: 'ورش', reason: '' }],
    ['changing nothing', { reason: 'سبب' }],
  ])('refuses a correction %s as VALIDATION_FAILED', async (_case, change) => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant({ status: 'approved' });
    const surface = surfaceOver(store);
    expect(await codeOf(surface.verified().credentials.correct({ credentialId, ...change }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(surface.written).toEqual([]);
  });
});

describe('credentials.list and credentials.get', () => {
  it.each([
    [
      'list',
      (surface: ReturnType<typeof surfaceOver>) =>
        surface.verified().credentials.list({ tab: 'pending', page: 1 }),
    ],
    [
      'get',
      (surface: ReturnType<typeof surfaceOver>, credentialId: string) =>
        surface.verified().credentials.get({ credentialId }),
    ],
  ] as const)('%s is a read audited as credentials.read on the reader', async (_name, call) => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const surface = surfaceOver(store);
    await call(surface, credentialId);
    expect(surface.written).toEqual([
      { adminId: ADMIN, action: 'credentials.read', targetType: 'admin', targetId: ADMIN },
    ]);
  });

  it("get answers the credential's history through its output schema (T174)", async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const surface = surfaceOver(store);
    await surface.verified().credentials.reject({ credentialId, reason: 'الختم غير واضح' });
    const { history } = await surface.verified().credentials.get({ credentialId });
    expect(history).toEqual([
      {
        action: 'reject',
        note: 'الختم غير واضح',
        adminName: 'هالة سعيد',
        at: NOW.toISOString(),
      },
    ]);
  });
});
