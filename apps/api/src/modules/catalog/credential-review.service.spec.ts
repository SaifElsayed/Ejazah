// T063 — the credential review (admin-surface.md "`credentials`"; FR-163, FR-164, ADR 0017 D1/D2/D5).
// Approval writes the transcription and the chain origin first, and refuses a second approved
// credential for the teacher's subject; it makes the subject the teacher's only when the teacher is
// already approved (an application's credentials become subjects at the application's approval,
// T068). Rejection and the request for another document carry the reason the teacher sees; a
// correction is an approved credential's alone and answers the transcription before and after, for
// the audit entry (FR-164). The reason's presence is the schema's (`credentials-admin.router.spec.ts`).
// Over a store held in memory that keeps the database's rules; the queries are probed in
// `tests/db-integrity/credential-review.spec.ts`.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  ADMIN,
  MemoryReviewStore,
  OTHER_SUBJECT,
  OTHER_TEACHER,
  SUBJECT,
  TEACHER,
  TX,
} from './credential-review.fixtures.js';
import { CredentialReviewService } from './credential-review.service.js';

const NOW = new Date('2026-10-22T10:00:00Z');
const PAGE_SIZE = 2;

const settings: SettingsReader = {
  read: async <T>(key: string, schema: z.ZodType<T>) => {
    if (key !== 'admin_list_page_size') throw new Error(`unexpected setting ${key}`);
    return schema.parse(PAGE_SIZE);
  },
};

function serviceOver(store: MemoryReviewStore): CredentialReviewService {
  return new CredentialReviewService({ store, settings, now: () => NOW });
}

const TRANSCRIPTION = {
  holderName: 'عمر بن فاروق الأنصاري',
  riwaya: 'حفص عن عاصم',
  tariq: 'الشاطبية',
  chain: [
    { names: ['رسول الله ﷺ'] },
    { names: ['جبريل', 'أبي بن كعب'] },
    { names: ['زر بن حبيش'] },
  ],
};

async function codeOf(call: Promise<unknown>): Promise<string> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return thrown.code;
}

describe('approve', () => {
  it('writes the transcription and the chain origin first, numbered from the origin', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const answer = await serviceOver(store).approve(TX, ADMIN, { credentialId, ...TRANSCRIPTION });
    const held = store.held(credentialId);
    expect(held).toMatchObject({
      status: 'approved',
      holderName: TRANSCRIPTION.holderName,
      riwaya: TRANSCRIPTION.riwaya,
      tariq: TRANSCRIPTION.tariq,
      reviewedAt: NOW,
      reviewReason: null,
    });
    expect(held.chain).toEqual([
      { position: 1, names: ['رسول الله ﷺ'] },
      { position: 2, names: ['جبريل', 'أبي بن كعب'] },
      { position: 3, names: ['زر بن حبيش'] },
    ]);
    expect(answer).toEqual({
      // The pending credential's transcription before it, for the audit entry's before (T116).
      before: { holderName: null, riwaya: null, tariq: null, chain: [] },
      after: {
        holderName: TRANSCRIPTION.holderName,
        riwaya: TRANSCRIPTION.riwaya,
        tariq: TRANSCRIPTION.tariq,
        chain: held.chain,
      },
    });
  });

  it('answers a missing tariq as null, the chain as written', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const { tariq: _omitted, ...withoutTariq } = TRANSCRIPTION;
    const answer = await serviceOver(store).approve(TX, ADMIN, { credentialId, ...withoutTariq });
    expect(answer.after.tariq).toBeNull();
    expect(store.held(credentialId).tariq).toBeNull();
  });

  it('refuses a second approved credential for the teacher and subject', async () => {
    const store = new MemoryReviewStore();
    store.plant({ status: 'approved' });
    const second = store.plant();
    expect(
      await codeOf(
        serviceOver(store).approve(TX, ADMIN, { credentialId: second, ...TRANSCRIPTION }),
      ),
    ).toBe('CONFLICT');
    expect(store.held(second).status).toBe('pending');
  });

  it('allows the same subject for another teacher, and another subject for the same one', async () => {
    const store = new MemoryReviewStore();
    store.plant({ status: 'approved' });
    const otherTeacher = store.plant({ teacherUserId: OTHER_TEACHER });
    const otherSubject = store.plant({ subject: OTHER_SUBJECT });
    const service = serviceOver(store);
    await service.approve(TX, ADMIN, { credentialId: otherTeacher, ...TRANSCRIPTION });
    await service.approve(TX, ADMIN, { credentialId: otherSubject, ...TRANSCRIPTION });
    expect(store.held(otherTeacher).status).toBe('approved');
    expect(store.held(otherSubject).status).toBe('approved');
  });

  it.each(['needs_document', 'approved', 'rejected'] as const)(
    'refuses a credential that is %s',
    async (status) => {
      const store = new MemoryReviewStore();
      const credentialId = store.plant({ status, teacherUserId: OTHER_TEACHER });
      expect(
        await codeOf(serviceOver(store).approve(TX, ADMIN, { credentialId, ...TRANSCRIPTION })),
      ).toBe('CONFLICT');
    },
  );

  it('answers NOT_FOUND for a credential that is not there', async () => {
    const store = new MemoryReviewStore();
    expect(
      await codeOf(
        serviceOver(store).approve(TX, ADMIN, {
          credentialId: '0199d0a0-0000-7000-8000-0000000000ff',
          ...TRANSCRIPTION,
        }),
      ),
    ).toBe('NOT_FOUND');
  });

  it("makes the subject an approved teacher's at once (FR-153)", async () => {
    const store = new MemoryReviewStore();
    store.approveTeacher(TEACHER);
    const credentialId = store.plant({ submittedWithApplication: false });
    await serviceOver(store).approve(TX, ADMIN, { credentialId, ...TRANSCRIPTION });
    expect(store.granted).toEqual([{ teacherUserId: TEACHER, subjectIds: [SUBJECT.id] }]);
  });

  it("grants nothing to an applicant: the application's approval does (T068)", async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    await serviceOver(store).approve(TX, ADMIN, { credentialId, ...TRANSCRIPTION });
    expect(store.granted).toEqual([]);
  });

  it("locks the teacher's account, then the application, before the credential moves and the teacher's approval is read (T142)", async () => {
    // The account first (the owner's decision of 2026-11-01), as a ban takes them.
    const store = new MemoryReviewStore();
    store.approveTeacher(TEACHER);
    const credentialId = store.plant({ submittedWithApplication: false });
    await serviceOver(store).approve(TX, ADMIN, { credentialId, ...TRANSCRIPTION });
    expect(store.journal).toEqual([
      `lock-account:${TEACHER}`,
      `lock:${TEACHER}`,
      `approve:${credentialId}`,
      `approved-teacher:${TEACHER}`,
    ]);
  });
});

describe('reject and requestDocument', () => {
  it('reject stores the reason the teacher sees, from pending', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    await serviceOver(store).reject(TX, ADMIN, { credentialId, reason: 'الملف غير مقروء' });
    expect(store.held(credentialId)).toMatchObject({
      status: 'rejected',
      reviewReason: 'الملف غير مقروء',
      reviewedAt: NOW,
    });
  });

  it('reject also ends a credential waiting on a document that never came', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant({ status: 'needs_document' });
    await serviceOver(store).reject(TX, ADMIN, { credentialId, reason: 'لم يصل ملف' });
    expect(store.held(credentialId).status).toBe('rejected');
  });

  it('requestDocument sets the credential waiting with the reason, from pending', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    await serviceOver(store).requestDocument(TX, ADMIN, {
      credentialId,
      reason: 'الصفحة الأخيرة ناقصة',
    });
    expect(store.held(credentialId)).toMatchObject({
      status: 'needs_document',
      reviewReason: 'الصفحة الأخيرة ناقصة',
    });
  });

  it.each([
    ['reject', 'approved'],
    ['reject', 'rejected'],
    ['requestDocument', 'needs_document'],
    ['requestDocument', 'approved'],
    ['requestDocument', 'rejected'],
  ] as const)('%s refuses a credential that is %s', async (action, status) => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant({ status });
    expect(
      await codeOf(serviceOver(store)[action](TX, ADMIN, { credentialId, reason: 'سبب' })),
    ).toBe('CONFLICT');
    expect(store.held(credentialId).status).toBe(status);
  });

  it.each(['reject', 'requestDocument'] as const)(
    '%s answers NOT_FOUND for a credential that is not there',
    async (action) => {
      const store = new MemoryReviewStore();
      expect(
        await codeOf(
          serviceOver(store)[action](TX, ADMIN, {
            credentialId: '0199d0a0-0000-7000-8000-0000000000ff',
            reason: 'سبب',
          }),
        ),
      ).toBe('NOT_FOUND');
    },
  );
});

describe("requestDocument and the teacher's application (T155)", () => {
  it('moves an application in review to needs_document with the note and the moment, in the same call', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    store.applyingAs(TEACHER, 'in_review');
    const move = await serviceOver(store).requestDocument(TX, ADMIN, {
      credentialId,
      reason: 'الصفحة الأخيرة ناقصة',
    });
    expect(store.held(credentialId).status).toBe('needs_document');
    expect(store.applications.get(TEACHER)).toEqual({
      status: 'needs_document',
      note: 'الصفحة الأخيرة ناقصة',
      decidedAt: NOW,
      decidedBy: ADMIN,
    });
    expect(move).toEqual({
      before: { applicationStatus: 'in_review' },
      after: { applicationStatus: 'needs_document' },
    });
  });

  it('leaves an application already waiting on the applicant as it is', async () => {
    const store = new MemoryReviewStore();
    const first = store.plant();
    const second = store.plant({ subject: OTHER_SUBJECT });
    store.applyingAs(TEACHER, 'in_review');
    const service = serviceOver(store);
    await service.requestDocument(TX, ADMIN, { credentialId: first, reason: 'الختم غير واضح' });
    const move = await service.requestDocument(TX, ADMIN, {
      credentialId: second,
      reason: 'الصفحة الأولى ناقصة',
    });
    expect(store.held(second).status).toBe('needs_document');
    expect(store.applications.get(TEACHER)).toMatchObject({
      status: 'needs_document',
      note: 'الختم غير واضح',
    });
    expect(move).toEqual({});
  });

  it("leaves an approved teacher's application unchanged for an added subject", async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant({ submittedWithApplication: false });
    store.approveTeacher(TEACHER);
    store.applyingAs(TEACHER, 'approved');
    const move = await serviceOver(store).requestDocument(TX, ADMIN, {
      credentialId,
      reason: 'الملف غير مقروء',
    });
    expect(store.held(credentialId).status).toBe('needs_document');
    expect(store.applications.get(TEACHER)).toEqual({
      status: 'approved',
      note: null,
      decidedAt: null,
      decidedBy: null,
    });
    expect(move).toEqual({});
  });

  it('moves no application when the credential was not pending', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant({ status: 'rejected' });
    store.applyingAs(TEACHER, 'in_review');
    expect(
      await codeOf(serviceOver(store).requestDocument(TX, ADMIN, { credentialId, reason: 'سبب' })),
    ).toBe('CONFLICT');
    expect(store.applications.get(TEACHER)?.status).toBe('in_review');
  });

  it("locks the teacher's application before it moves the credential (T161)", async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    store.applyingAs(TEACHER, 'in_review');
    await serviceOver(store).requestDocument(TX, ADMIN, { credentialId, reason: 'سبب' });
    expect(store.journal).toEqual([`lock:${TEACHER}`, `decide:${credentialId}`]);
  });
});

describe('correct', () => {
  it('answers the transcription before and after, and changes only the fields given', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant({ status: 'approved' });
    const { before, after } = await serviceOver(store).correct(TX, ADMIN, {
      credentialId,
      chain: [{ names: ['رسول الله ﷺ'] }, { names: ['جبريل'] }],
      reason: 'اسم زائد في الجيل الثاني',
    });
    expect(before).toEqual({
      holderName: 'عمر بن فاروق',
      riwaya: 'حفص عن عاصم',
      tariq: 'الشاطبية',
      chain: [
        { position: 1, names: ['رسول الله ﷺ'] },
        { position: 2, names: ['جبريل', 'ابن مسعود'] },
      ],
    });
    expect(after).toEqual({
      ...before,
      chain: [
        { position: 1, names: ['رسول الله ﷺ'] },
        { position: 2, names: ['جبريل'] },
      ],
    });
    expect(store.held(credentialId).chain).toEqual(after.chain);
  });

  it('corrects the holder name alone and keeps the chain', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant({ status: 'approved' });
    const { before, after } = await serviceOver(store).correct(TX, ADMIN, {
      credentialId,
      holderName: 'عمر بن فاروق الأنصاري',
      reason: 'الاسم كما في الملف',
    });
    expect(after).toEqual({ ...before, holderName: 'عمر بن فاروق الأنصاري' });
    expect(store.held(credentialId).holderName).toBe('عمر بن فاروق الأنصاري');
  });

  it.each(['pending', 'needs_document', 'rejected'] as const)(
    'refuses a credential that is %s: only an approved chain is corrected',
    async (status) => {
      const store = new MemoryReviewStore();
      const credentialId = store.plant({ status });
      expect(
        await codeOf(
          serviceOver(store).correct(TX, ADMIN, { credentialId, riwaya: 'ورش', reason: 'سبب' }),
        ),
      ).toBe('CONFLICT');
    },
  );

  it('answers NOT_FOUND for a credential that is not there', async () => {
    const store = new MemoryReviewStore();
    expect(
      await codeOf(
        serviceOver(store).correct(TX, ADMIN, {
          credentialId: '0199d0a0-0000-7000-8000-0000000000ff',
          riwaya: 'ورش',
          reason: 'سبب',
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('list and get', () => {
  it('lists one tab, oldest submitted first, in pages of admin_list_page_size', async () => {
    const store = new MemoryReviewStore();
    const second = store.plant({ createdAt: new Date('2026-10-19T09:00:00Z') });
    const first = store.plant({
      createdAt: new Date('2026-10-18T09:00:00Z'),
      submittedWithApplication: false,
      teacherUserId: OTHER_TEACHER,
    });
    const third = store.plant({
      createdAt: new Date('2026-10-20T09:00:00Z'),
      teacherUserId: OTHER_TEACHER,
      subject: OTHER_SUBJECT,
    });
    store.plant({ status: 'rejected' });
    const service = serviceOver(store);
    const one = await service.list(TX, { tab: 'pending', page: 1 });
    expect(one.total).toBe(3);
    // The pager's size (B14c, the owner's decision): the panel needs no setting of its own.
    expect(one.pageSize).toBe(2);
    expect(one.rows.map((row) => row.credentialId)).toEqual([first, second]);
    expect(one.rows[0]).toEqual({
      credentialId: first,
      teacher: { userId: OTHER_TEACHER, displayName: 'عمر فاروق' },
      subject: SUBJECT,
      origin: 'added',
      submittedAt: '2026-10-18T09:00:00.000Z',
      status: 'pending',
    });
    const two = await service.list(TX, { tab: 'pending', page: 2 });
    expect(two.rows.map((row) => row.credentialId)).toEqual([third]);
  });

  it('lists a decided tab by the latest review first', async () => {
    const store = new MemoryReviewStore();
    const older = store.plant({
      status: 'rejected',
      reviewedAt: new Date('2026-10-19T09:00:00Z'),
    });
    const newer = store.plant({
      status: 'rejected',
      reviewedAt: new Date('2026-10-21T09:00:00Z'),
    });
    const { rows } = await serviceOver(store).list(TX, { tab: 'rejected', page: 1 });
    expect(rows.map((row) => row.credentialId)).toEqual([newer, older]);
    // A decided row says when it was decided (the board's «وُثّقت» column; B14c).
    expect(rows[0]?.reviewedAt).toBe('2026-10-21T09:00:00.000Z');
  });

  it("filters by the teacher's name", async () => {
    const store = new MemoryReviewStore();
    store.plant({ displayName: 'عمر فاروق' });
    const found = store.plant({ displayName: 'سالم الحداد', teacherUserId: OTHER_TEACHER });
    const { rows, total } = await serviceOver(store).list(TX, {
      tab: 'pending',
      search: 'الحداد',
      page: 1,
    });
    expect(total).toBe(1);
    expect(rows.map((row) => row.credentialId)).toEqual([found]);
  });

  it('gets an approved credential with its transcription, chain and reviewer', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const service = serviceOver(store);
    await service.approve(TX, ADMIN, { credentialId, ...TRANSCRIPTION });
    const credential = await service.get(TX, credentialId);
    expect(credential).toMatchObject({
      credentialId,
      status: 'approved',
      origin: 'application',
      documentId: store.held(credentialId).documentId,
      holderName: TRANSCRIPTION.holderName,
      riwaya: TRANSCRIPTION.riwaya,
      tariq: TRANSCRIPTION.tariq,
      reviewedAt: NOW.toISOString(),
      reviewedByName: 'هالة سعيد',
    });
    expect(credential.chain).toHaveLength(3);
    expect(credential).not.toHaveProperty('reviewReason');
  });

  it('gets a pending credential without a transcription or a chain', async () => {
    const store = new MemoryReviewStore();
    const credentialId = store.plant();
    const credential = await serviceOver(store).get(TX, credentialId);
    for (const field of [
      'holderName',
      'riwaya',
      'tariq',
      'chain',
      'reviewedAt',
      'reviewedByName',
    ]) {
      expect(credential).not.toHaveProperty(field);
    }
  });

  it('answers NOT_FOUND for a credential that is not there', async () => {
    const store = new MemoryReviewStore();
    expect(await codeOf(serviceOver(store).get(TX, '0199d0a0-0000-7000-8000-0000000000ff'))).toBe(
      'NOT_FOUND',
    );
  });
});
