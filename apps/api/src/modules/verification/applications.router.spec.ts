// T068 — the administrator surface's `applications` namespace as it is served (admin-surface.md
// "`applications`"; FR-160 to FR-162). Every procedure is the administrator kind: it refuses an
// anonymous caller and one whose second factor is not verified, and writes the action's audit entry
// with the actor from the session, nothing of a refused call. Each decision is described on the
// application (`teacher_application`) with the status it moved from as its before and the status it
// moved to beside the dialog's choice as its after (T116); the list and the detail are reads naming
// the reader. R1a (002:T174, SRS DEC-97; the owner's Q-1 (a)): a decision's note is not the entry's
// reason; the entry records only that one was given (`note_given`), and the text is in the
// application's history. What the review does is `application-review.service.spec.ts`'s; the
// services here record what reached them.
import { AUDIT_REASON_NOTE_GIVEN } from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

import { adminContextsOver, SPEC_ADMIN, VERIFIED } from '../../surfaces/admin-surface.fixtures.js';
import type { AdminSurfaceServices } from '../../surfaces/context.js';
import {
  createAdminCallerFactory,
  createAdminRouter,
  toErrorShape,
} from '../../surfaces/procedures.js';
import { applicationsRouter } from './applications.router.js';

const callerFor = createAdminCallerFactory(createAdminRouter({ applications: applicationsRouter }));

const APPLICANT = '0199d0a0-0000-7000-8000-0000000000c1';

function surface() {
  const reached: unknown[][] = [];
  const record =
    <T>(name: string, answer: T) =>
    async (...args: unknown[]): Promise<T> => {
      reached.push([name, ...args.slice(1)]);
      return answer;
    };
  const applications: AdminSurfaceServices['applications'] = {
    list: record('list', { rows: [], total: 0, pageSize: 25 }),
    get: record('get', {
      teacherUserId: APPLICANT,
      displayName: 'عمر فاروق',
      email: 'omar@example.invalid',
      gender: 'male',
      isMinor: false,
      subjects: [],
      submittedAt: '2026-10-18T09:00:00.000Z',
      status: 'in_review',
      qualificationSummary: 'إجازة في حفص',
      timezoneCity: 'Africa/Cairo',
      accountStatus: 'active',
      identityDocument: {
        documentId: '0199d0a0-0000-7000-8000-0000000000d1',
        type: 'national_id',
        uploadedAt: '2026-10-18T09:00:00.000Z',
      },
      credentials: [],
      call: {},
      // B42b, T075 of specs/004-sessions (rule d): the ban restore window's days (Q-O2 (a)).
      banRestoreWindowDays: 14,
    }),
    recordCall: record('recordCall', {
      before: { completedOn: '2026-10-20', outcome: 'unsuitable' },
      after: { completedOn: '2026-10-21', outcome: 'suitable' },
    }),
    approve: record('approve', {
      before: { status: 'in_review' },
      after: { status: 'approved' },
      subjectIds: ['0199d0a0-0000-7000-8000-000000000051'],
    }),
    reject: record('reject', {
      before: { status: 'needs_document' },
      after: { status: 'rejected' },
    }),
    requestInfo: record('requestInfo', {
      before: { status: 'in_review' },
      after: { status: 'needs_document' },
    }),
    ban: record('ban', { before: { status: 'rejected' }, after: { status: 'banned' } }),
  };
  const contexts = adminContextsOver({ applications });
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
  'applications.list': (caller) => caller.applications.list({ tab: 'in_review', page: 1 }),
  'applications.get': (caller) => caller.applications.get({ teacherUserId: APPLICANT }),
  'applications.recordCall': (caller) =>
    caller.applications.recordCall({
      teacherUserId: APPLICANT,
      completedOn: '2026-10-21',
      timeZone: 'Africa/Cairo',
      outcome: 'suitable',
      notes: 'تحقّقت من الهوية',
    }),
  'applications.approve': (caller) => caller.applications.approve({ teacherUserId: APPLICANT }),
  'applications.reject': (caller) =>
    caller.applications.reject({ teacherUserId: APPLICANT, reasonChoice: 'other', note: 'سبب' }),
  'applications.requestInfo': (caller) =>
    caller.applications.requestInfo({ teacherUserId: APPLICANT, needed: ['other'], note: 'سبب' }),
  'applications.ban': (caller) =>
    caller.applications.ban({ teacherUserId: APPLICANT, reasonChoice: 'other', note: 'سبب' }),
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
  const target = { adminId: SPEC_ADMIN, targetType: 'teacher_application', targetId: APPLICANT };

  it('recordCall: the day and the outcome before (T116) and after, not the notes', async () => {
    const { as, written } = surface();
    await CALLS['applications.recordCall']!(as(VERIFIED));
    expect(written).toEqual([
      {
        ...target,
        action: 'application.record_call',
        before: { completedOn: '2026-10-20', outcome: 'unsuitable' },
        after: { completedOn: '2026-10-21', outcome: 'suitable' },
      },
    ]);
  });

  it('approve: the status before (T116), the status and the subjects granted after, `note_given` as the reason when a note is given (R1a), never its text', async () => {
    const { as, written } = surface();
    await as(VERIFIED).applications.approve({ teacherUserId: APPLICANT, note: 'مرحبًا' });
    await as(VERIFIED).applications.approve({ teacherUserId: APPLICANT });
    const before = { status: 'in_review' };
    const after = { status: 'approved', subjectIds: ['0199d0a0-0000-7000-8000-000000000051'] };
    expect(written).toEqual([
      { ...target, action: 'application.approve', reason: AUDIT_REASON_NOTE_GIVEN, before, after },
      { ...target, action: 'application.approve', before, after },
    ]);
    expect(JSON.stringify(written)).not.toContain('مرحبًا');
  });

  it.each([
    [
      'reject',
      'application.reject',
      'needs_document',
      'rejected',
      { reasonChoice: 'qualification_gap' },
    ],
    ['ban', 'application.ban', 'rejected', 'banned', { reasonChoice: 'forged_documents' }],
    [
      'requestInfo',
      'application.request_info',
      'in_review',
      'needs_document',
      { needed: ['id_unclear', 'other'] },
    ],
  ] as const)(
    '%s: `note_given` as the reason (R1a), never the note, the status before (T116), the status and the choice after',
    async (procedure, action, from, to, choice) => {
      const { as, written, reached } = surface();
      await (as(VERIFIED).applications[procedure] as (input: object) => Promise<void>)({
        teacherUserId: APPLICANT,
        note: 'ما يراه المتقدّم',
        ...choice,
      });
      expect(written).toEqual([
        {
          ...target,
          action,
          reason: AUDIT_REASON_NOTE_GIVEN,
          before: { status: from },
          after: { status: to, ...choice },
        },
      ]);
      expect(JSON.stringify(written)).not.toContain('ما يراه المتقدّم');
      expect(reached[0]?.[0]).toBe(procedure);
      expect(reached[0]?.[1]).toBe(SPEC_ADMIN);
    },
  );

  it.each(['applications.list', 'applications.get'])(
    '%s is a read naming the reader',
    async (path) => {
      const { as, written } = surface();
      await CALLS[path]!(as(VERIFIED));
      expect(written).toEqual([
        {
          adminId: SPEC_ADMIN,
          action: 'applications.read',
          targetType: 'admin',
          targetId: SPEC_ADMIN,
        },
      ]);
    },
  );
});

describe('the inputs', () => {
  it.each([
    [
      'a reject without a note',
      (caller: Caller) =>
        caller.applications.reject({ teacherUserId: APPLICANT, reasonChoice: 'other', note: ' ' }),
    ],
    [
      'a ban without a note',
      (caller: Caller) =>
        caller.applications.ban({ teacherUserId: APPLICANT, reasonChoice: 'other', note: '' }),
    ],
    [
      'a request for nothing',
      (caller: Caller) =>
        caller.applications.requestInfo({ teacherUserId: APPLICANT, needed: [], note: 'سبب' }),
    ],
    [
      'a call without notes',
      (caller: Caller) =>
        caller.applications.recordCall({
          teacherUserId: APPLICANT,
          completedOn: '2026-10-21',
          timeZone: 'Africa/Cairo',
          outcome: 'suitable',
          notes: '  ',
        }),
    ],
    [
      'a call day that is not a day',
      (caller: Caller) =>
        caller.applications.recordCall({
          teacherUserId: APPLICANT,
          completedOn: '21/10/2026',
          timeZone: 'Africa/Cairo',
          outcome: 'suitable',
          notes: 'ملاحظات',
        }),
    ],
  ])('refuses %s as VALIDATION_FAILED, reaching nothing', async (_case, call) => {
    const { as, written, reached } = surface();
    expect(await codeOf(call(as(VERIFIED)))).toBe('VALIDATION_FAILED');
    expect(written).toEqual([]);
    expect(reached).toEqual([]);
  });
});
