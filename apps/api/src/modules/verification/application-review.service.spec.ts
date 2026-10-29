// T062 — the application review (admin-surface.md "`applications`"; FR-160 to FR-162, FR-132,
// ADR 0017 D5). The queue's three tabs and its search; `recordCall` with the day not after today in
// the panel's zone; `approve` refused with each `APPROVAL_BLOCKED` reason (the call not recorded, a
// credential of the application undecided, none approved) and allowed once all hold, granting the
// approved credentials' subjects through catalog's entry; `reject`; `requestInfo`, which sets
// `needs_document`; `ban`, the standing's one function with the applicant's note. Each decision
// writes the note the applicant sees and its moment. That each is described on `ctx.audit` with its
// reason is the router's (`applications.router.spec.ts`). Over a store held in memory that keeps the
// database's rules; the queries are probed in `tests/db-integrity/application-review.spec.ts`.
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  ADMIN,
  HAFS,
  MemoryReviewStore,
  SUBMITTED,
  TX,
  WARSH,
} from './__fixtures__/review-store.js';
import { ApplicationReviewService } from './application-review.service.js';

const NOW = new Date('2026-10-22T10:00:00Z');

const settings: SettingsReader = {
  read: async <T>(key: string, schema: z.ZodType<T>) => {
    if (key !== 'admin_list_page_size') throw new Error(`unexpected setting ${key}`);
    return schema.parse(2);
  },
};

let store: MemoryReviewStore;
let bans: { userId: string; applicantNote: string }[];
let service: ApplicationReviewService;

beforeEach(() => {
  store = new MemoryReviewStore();
  bans = [];
  service = new ApplicationReviewService({
    store,
    standing: {
      ban: async (_tx, _adminId, userId, applicant) => {
        bans.push({ userId, applicantNote: applicant?.applicantNote ?? '' });
      },
    },
    settings,
    now: () => NOW,
  });
});

async function refusal(call: Promise<unknown>): Promise<{ code: string; details?: unknown }> {
  const thrown: unknown = await call.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(thrown instanceof DomainError)) throw new Error('expected a DomainError');
  return { code: thrown.code, details: thrown.details };
}

describe('the queue', () => {
  it('lists each tab oldest submission first, in pages of admin_list_page_size', async () => {
    const second = store.plant({ submittedAt: new Date('2026-10-19T09:00:00Z') });
    const first = store.plant({ submittedAt: new Date('2026-10-17T09:00:00Z') });
    const third = store.plant({ submittedAt: new Date('2026-10-20T09:00:00Z') });
    const waiting = store.plant({ status: 'needs_document' });
    const decided = store.plant({ status: 'rejected' });
    const banned = store.plant({ status: 'banned' });
    const one = await service.list(TX, { tab: 'in_review', page: 1 });
    expect(one.total).toBe(3);
    // The page's size travels with the page, so the panel's pager needs no setting of its own (B14b).
    expect(one.pageSize).toBe(2);
    expect(one.rows.map((row) => row.teacherUserId)).toEqual([first, second]);
    expect((await service.list(TX, { tab: 'in_review', page: 2 })).rows).toHaveLength(1);
    expect(third).toBeDefined();
    expect(
      (await service.list(TX, { tab: 'waiting', page: 1 })).rows.map((row) => row.teacherUserId),
    ).toEqual([waiting]);
    expect(
      new Set(
        (await service.list(TX, { tab: 'decided', page: 1 })).rows.map((row) => row.teacherUserId),
      ),
    ).toEqual(new Set([decided, banned]));
  });

  it("answers a row with the application's subjects, the minor flag and the call's day", async () => {
    const userId = store.plant({
      dateOfBirth: new Date('2009-01-01T00:00:00Z'),
      callRecorded: true,
      credentials: [
        { subject: HAFS, status: 'pending' },
        { subject: WARSH, status: 'pending' },
      ],
    });
    store.plantOther(userId, 'rejected', true);
    const { rows } = await service.list(TX, { tab: 'in_review', page: 1 });
    expect(rows).toEqual([
      {
        teacherUserId: userId,
        displayName: 'عمر فاروق',
        email: `${userId}@example.invalid`,
        gender: 'male',
        isMinor: true,
        subjects: [HAFS, WARSH],
        callRecordedOn: '2026-10-20',
        submittedAt: SUBMITTED.toISOString(),
        status: 'in_review',
      },
    ]);
  });

  it('searches the name or the email', async () => {
    store.plant({ displayName: 'عمر فاروق' });
    const byName = store.plant({ displayName: 'سالم الحداد' });
    const byEmail = store.plant({ email: 'haddad@example.invalid' });
    const { rows } = await service.list(TX, { tab: 'in_review', search: 'حداد', page: 1 });
    expect(rows.map((row) => row.teacherUserId)).toEqual([byName]);
    const email = await service.list(TX, { tab: 'in_review', search: 'HADDAD@', page: 1 });
    expect(email.rows.map((row) => row.teacherUserId)).toEqual([byEmail]);
  });
});

describe('get', () => {
  it("answers the detail with the application's credentials, the call and an open identity request", async () => {
    const userId = store.plant({ status: 'needs_document', callRecorded: true });
    store.plantOther(userId, 'approved', false);
    const requestId = store.openRequest(userId, {
      reason: 'اشتباه في الهوية',
      requestedAt: '2026-10-21T09:00:00.000Z',
    });
    const detail = await service.get(TX, userId);
    expect(detail).toMatchObject({
      teacherUserId: userId,
      qualificationSummary: 'إجازة في حفص',
      timezoneCity: 'Africa/Cairo',
      identityDocument: { type: 'national_id', uploadedAt: SUBMITTED.toISOString() },
      call: { completedOn: '2026-10-20', outcome: 'suitable', notes: 'تحقّقت من الهوية' },
      identityRequest: { requestId, reason: 'اشتباه في الهوية' },
      accountStatus: 'active',
    });
    expect(detail.credentials.map((credential) => credential.subject)).toEqual([HAFS]);
    expect(detail).not.toHaveProperty('note');
  });

  it("answers the account's standing, which require-ID reads (B14b-2)", async () => {
    const userId = store.plant({ accountStatus: 'verification_required' });
    expect((await service.get(TX, userId)).accountStatus).toBe('verification_required');
  });

  it('answers NOT_FOUND for no application', async () => {
    expect((await refusal(service.get(TX, ADMIN))).code).toBe('NOT_FOUND');
  });
});

describe('recordCall', () => {
  const call = {
    completedOn: '2026-10-22',
    timeZone: 'Africa/Cairo',
    outcome: 'unsuitable',
    notes: 'لم يُجب عن الأسئلة',
  } as const;

  it("records the day, the outcome and the notes on an open application, today in the panel's zone allowed", async () => {
    const userId = store.plant();
    await service.recordCall(TX, ADMIN, { teacherUserId: userId, ...call });
    expect(store.held(userId)).toMatchObject({
      callCompletedOn: new Date('2026-10-22T00:00:00Z'),
      callOutcome: 'unsuitable',
      callNotes: 'لم يُجب عن الأسئلة',
    });
  });

  it("refuses a day after today in the panel's zone", async () => {
    const userId = store.plant();
    expect(
      await refusal(
        service.recordCall(TX, ADMIN, {
          teacherUserId: userId,
          ...call,
          completedOn: '2026-10-23',
        }),
      ),
    ).toEqual({ code: 'VALIDATION_FAILED', details: [{ path: 'completedOn', code: 'future' }] });
    expect(store.held(userId).callCompletedOn).toBeNull();
  });

  it('refuses a zone the time package refuses as a validation failure on timeZone', async () => {
    const userId = store.plant();
    expect(
      await refusal(
        service.recordCall(TX, ADMIN, { teacherUserId: userId, ...call, timeZone: 'UTC' }),
      ),
    ).toEqual({ code: 'VALIDATION_FAILED', details: [{ path: 'timeZone', code: 'unknown' }] });
  });

  it('refuses a decided application', async () => {
    const userId = store.plant({ status: 'approved' });
    expect(
      (await refusal(service.recordCall(TX, ADMIN, { teacherUserId: userId, ...call }))).code,
    ).toBe('CONFLICT');
  });
});

describe('approve', () => {
  it('approves once the call is recorded and every credential is decided, one approved, granting the approved subjects', async () => {
    const userId = store.plant({
      callRecorded: true,
      credentials: [
        { subject: HAFS, status: 'approved' },
        { subject: WARSH, status: 'rejected' },
      ],
    });
    const answer = await service.approve(TX, ADMIN, { teacherUserId: userId, note: 'مرحبًا بك' });
    expect(store.held(userId)).toMatchObject({
      status: 'approved',
      approvedBy: ADMIN,
      decidedBy: ADMIN,
      decidedAt: NOW,
      note: 'مرحبًا بك',
    });
    expect(store.granted).toEqual([{ userId, subjectIds: [HAFS.id] }]);
    expect(answer).toEqual({ subjectIds: [HAFS.id] });
  });

  it('refuses with every reason that holds: the call, an undecided credential, none approved', async () => {
    const userId = store.plant({
      credentials: [
        { subject: HAFS, status: 'pending' },
        { subject: WARSH, status: 'rejected' },
      ],
    });
    expect(await refusal(service.approve(TX, ADMIN, { teacherUserId: userId }))).toEqual({
      code: 'APPROVAL_BLOCKED',
      details: [
        { path: 'approval', code: 'call_not_recorded' },
        { path: 'approval', code: 'credential_undecided' },
        { path: 'approval', code: 'none_approved' },
      ],
    });
    expect(store.held(userId).status).toBe('in_review');
    expect(store.granted).toEqual([]);
  });

  it.each([
    ['the call alone', { callRecorded: false, status: 'approved' as const }, 'call_not_recorded'],
    [
      'a credential waiting on a document',
      { callRecorded: true, status: 'needs_document' as const },
      'credential_undecided',
    ],
  ])('refuses on %s', async (_case, values, reason) => {
    const userId = store.plant({
      callRecorded: values.callRecorded,
      credentials: [
        { subject: HAFS, status: 'approved' },
        { subject: WARSH, status: values.status },
      ],
    });
    expect(await refusal(service.approve(TX, ADMIN, { teacherUserId: userId }))).toEqual({
      code: 'APPROVAL_BLOCKED',
      details: [{ path: 'approval', code: reason }],
    });
  });

  it("reads only the current application's credentials: an added or an older one blocks nothing", async () => {
    const userId = store.plant({ callRecorded: true });
    store.plantOther(userId, 'pending', false);
    store.plantOther(userId, 'pending', true);
    await service.approve(TX, ADMIN, { teacherUserId: userId });
    expect(store.held(userId).status).toBe('approved');
    expect(store.granted).toEqual([{ userId, subjectIds: [HAFS.id] }]);
  });

  it('refuses an application waiting on the applicant', async () => {
    const userId = store.plant({ status: 'needs_document', callRecorded: true });
    expect((await refusal(service.approve(TX, ADMIN, { teacherUserId: userId }))).code).toBe(
      'CONFLICT',
    );
  });
});

describe('reject, requestInfo and ban', () => {
  it('reject writes the note and the moment, from review or from waiting', async () => {
    const inReview = store.plant();
    const waiting = store.plant({ status: 'needs_document' });
    for (const userId of [inReview, waiting]) {
      await service.reject(TX, ADMIN, {
        teacherUserId: userId,
        reasonChoice: 'qualification_gap',
        note: 'المؤهل لا يغطي ورش',
      });
      expect(store.held(userId)).toMatchObject({
        status: 'rejected',
        note: 'المؤهل لا يغطي ورش',
        decidedAt: NOW,
        decidedBy: ADMIN,
      });
    }
  });

  it("reject closes the application's undecided credentials with its note, its admin and its moment (T122)", async () => {
    const userId = store.plant({
      credentials: [
        { subject: HAFS, status: 'pending' },
        { subject: WARSH, status: 'needs_document' },
        { subject: HAFS, status: 'approved' },
      ],
    });
    const added = store.plantOther(userId, 'pending', false);
    await service.reject(TX, ADMIN, {
      teacherUserId: userId,
      reasonChoice: 'qualification_gap',
      note: 'المؤهل لا يغطي ورش',
    });
    const statuses = (await store.credentialsOf(TX, [userId])).map(({ credentialId, status }) => ({
      credentialId,
      status,
    }));
    const [pending, waiting, approved] = statuses;
    expect(statuses.map(({ status }) => status)).toEqual([
      'rejected',
      'rejected',
      'approved',
      'pending',
    ]);
    const review = { reason: 'المؤهل لا يغطي ورش', adminId: ADMIN, at: NOW };
    expect(store.reviews.get(pending?.credentialId ?? '')).toEqual(review);
    expect(store.reviews.get(waiting?.credentialId ?? '')).toEqual(review);
    expect(store.reviews.has(approved?.credentialId ?? '')).toBe(false);
    expect(store.reviews.has(added)).toBe(false);
  });

  it('requestInfo and a refused reject close no credential (T122)', async () => {
    const userId = store.plant({ credentials: [{ subject: HAFS, status: 'pending' }] });
    await service.requestInfo(TX, ADMIN, { teacherUserId: userId, needed: ['other'], note: 'x' });
    const rejected = store.plant({
      status: 'rejected',
      credentials: [{ subject: HAFS, status: 'pending' }],
    });
    await refusal(
      service.reject(TX, ADMIN, { teacherUserId: rejected, reasonChoice: 'other', note: 'x' }),
    );
    expect(store.reviews.size).toBe(0);
  });

  it('requestInfo sets needs_document with the note, from review only', async () => {
    const userId = store.plant();
    await service.requestInfo(TX, ADMIN, {
      teacherUserId: userId,
      needed: ['id_unclear'],
      note: 'ارفع صورة أوضح للهوية',
    });
    expect(store.held(userId)).toMatchObject({
      status: 'needs_document',
      note: 'ارفع صورة أوضح للهوية',
    });
    expect(
      (
        await refusal(
          service.requestInfo(TX, ADMIN, { teacherUserId: userId, needed: ['other'], note: 'x' }),
        )
      ).code,
    ).toBe('CONFLICT');
  });

  it.each(['approved', 'rejected', 'banned'] as const)(
    'reject refuses an application that is %s',
    async (status) => {
      const userId = store.plant({ status });
      expect(
        (
          await refusal(
            service.reject(TX, ADMIN, { teacherUserId: userId, reasonChoice: 'other', note: 'x' }),
          )
        ).code,
      ).toBe('CONFLICT');
    },
  );

  it('ban goes through the standing with the note the applicant sees', async () => {
    const userId = store.plant();
    await service.ban(TX, ADMIN, {
      teacherUserId: userId,
      reasonChoice: 'forged_documents',
      note: 'وثيقة معدَّلة',
    });
    expect(bans).toEqual([{ userId, applicantNote: 'وثيقة معدَّلة' }]);
  });

  it.each(['reject', 'requestInfo'] as const)(
    '%s answers NOT_FOUND for no application',
    async (action) => {
      const input = {
        teacherUserId: ADMIN,
        reasonChoice: 'other' as const,
        needed: ['other' as const],
        note: 'x',
      };
      expect((await refusal(service[action](TX, ADMIN, input))).code).toBe('NOT_FOUND');
    },
  );
});
