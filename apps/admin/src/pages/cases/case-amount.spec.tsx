// 003:T110 (ADR 0025 D4, SRS DEC-85, DEC-86; the note under T110): a case's page draws the amount
// its cause gives, from payments' `payments.caseAmount`, with each part in its words, in both
// languages: an ijazah dropout's 10,000 EGP as 5,250 held + 3,000 the platform's part + 1,750
// released; a recitation dropout's refund and release; the refunds already recorded beside it
// (Q-C1 (a)). A case the read gives no amount draws nothing, and a complaint is never asked. No
// button moves money (DEC-82).
// 003:T124 (SRS DEC-91, FR-ADMIN-5, FR-AUTH-11; ADR 0018 D5; Q-7, Q-7a (a), Q-7b (a)): a close on the
// student's ban or a confirmed fault (`student_fault_close`) shows no refund: of 8 sessions of 1,000
// EGP, 3 delivered, 1 missed by the student, 1 by the teacher and 3 cancelled by the close, the 125
// owed to the student, the 375 the administration's decision (refunded only if it decides so), and
// the 350 released to the teacher at a 70 % share; never the «refund» label.
import { piasters } from '@ijazah/money';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale, translate } from '../../i18n';
import { formatPounds } from '../../lib/format';
import { inBothLocales, mutation, query, renderApp } from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const id = (n: number) => `0193a6f0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ENROLLMENT = id(901);
const CASE = id(11);
const COMPLAINT = id(12);
const ADMIN = id(99);
const EGP = (pounds: number) => pounds * 100;

const enrollment = {
  enrollmentId: ENROLLMENT,
  student: { userId: id(51), displayName: 'عبد الله حسن', deleted: false },
  teacher: { userId: id(52), displayName: 'Sara Adel', deleted: false },
  status: 'cancelled',
  track: 'ijazah_track',
  teacherNoShows: 0,
  repeatedAbsence: false,
};

const caseDetail = (caseId: string, kind: string, reason?: string) => ({
  case: {
    caseId,
    kind,
    enrollmentId: ENROLLMENT,
    ...(reason === undefined ? {} : { reason }),
    status: 'open',
    openedAt: '2026-11-10T09:00:00.000Z',
  },
  ...(kind === 'absence_complaint'
    ? { complaint: { reason: 'غاب المعلم مرارًا', raisedAt: '2026-11-08T09:00:00.000Z' } }
    : {}),
  enrollment,
  covers: [],
  paymentsLink: { enrollmentId: ENROLLMENT },
});

const IJAZAH = {
  cause: 'ijazah_dropout',
  total_piasters: EGP(10_000),
  held_piasters: EGP(5_250),
  platformPart_piasters: EGP(3_000),
  released_piasters: EGP(1_750),
  refunded_piasters: EGP(0),
};

const RECITATION = {
  cause: 'recitation_dropout',
  refund_piasters: EGP(5_000),
  release_piasters: EGP(3_500),
  refunded_piasters: EGP(1_000),
};

/** 003:T124's example: 125 owed, 375 the administration's decision, 350 to the teacher. */
const FAULT = {
  cause: 'student_fault_close',
  owed_piasters: EGP(125),
  decision_piasters: EGP(375),
  release_piasters: EGP(350),
  refunded_piasters: EGP(0),
};

function fakeApi(answer: unknown, reason = 'teacher_ended') {
  const api = {
    cases: {
      list: query(),
      get: query(),
      resolve: mutation(),
      dismiss: mutation(),
      decideComplaint: mutation(),
      openManual: mutation(),
    },
    payments: { caseAmount: query() },
    disputes: { heldFiles: query(), heldFileLink: mutation() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.cases.list.query.mockResolvedValue({ items: [] });
  api.cases.get.query.mockImplementation(async (input) =>
    (input as { caseId: string }).caseId === COMPLAINT
      ? caseDetail(COMPLAINT, 'absence_complaint')
      : caseDetail(CASE, 'compensation_case', reason),
  );
  api.payments.caseAmount.query.mockResolvedValue(answer);
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: ADMIN, displayName: 'سارة عادل', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

function open(api: ReturnType<typeof fakeApi>, caseId = CASE) {
  return { view: renderApp({ at: `/cases?case=${caseId}`, session: verified, api }).view, api };
}

/** Each part's label beside its amount, in the section's key–value list. */
function expectPart(section: HTMLElement, label: string, amount: string) {
  const row = within(section).getByText(label).closest('div, li, tr, dl') as HTMLElement;
  expect(within(row).getByText(amount)).toBeTruthy();
}

describe('the case’s amount (003:T110)', () => {
  it('draws an ijazah dropout’s 10,000 as 5,250 held + 3,000 the platform’s part + 1,750 released', async () => {
    const api = fakeApi({ amount: IJAZAH });
    await inBothLocales(
      () => open(api),
      async (t, locale) => {
        const section = await screen.findByRole('region', {
          name: t('admin.money.caseAmount.title'),
        });
        const pounds = (value: number) => formatPounds(piasters(value), locale);
        expect(
          within(section).getByText(t('admin.money.caseAmount.cause.ijazahDropout')),
        ).toBeTruthy();
        expectPart(section, t('admin.money.caseAmount.total'), pounds(EGP(10_000)));
        expectPart(section, t('admin.money.caseAmount.held'), pounds(EGP(5_250)));
        expectPart(section, t('admin.money.caseAmount.platformPart'), pounds(EGP(3_000)));
        expectPart(section, t('admin.money.caseAmount.released'), pounds(EGP(1_750)));
        expectPart(section, t('admin.money.caseAmount.refundedSoFar'), pounds(EGP(0)));
        expect(within(section).getByText(t('admin.money.caseAmount.note'))).toBeTruthy();
        expect(within(section).queryAllByRole('button')).toEqual([]);
      },
    );
    expect(api.payments.caseAmount.query).toHaveBeenCalledWith({ caseId: CASE });
  });

  it('draws a recitation dropout’s refund and release, the refunds already recorded beside them', async () => {
    const api = fakeApi({ amount: RECITATION });
    await inBothLocales(
      () => open(api),
      async (t, locale) => {
        const section = await screen.findByRole('region', {
          name: t('admin.money.caseAmount.title'),
        });
        const pounds = (value: number) => formatPounds(piasters(value), locale);
        expect(
          within(section).getByText(t('admin.money.caseAmount.cause.recitationDropout')),
        ).toBeTruthy();
        expectPart(section, t('admin.money.caseAmount.refund'), pounds(EGP(5_000)));
        expectPart(section, t('admin.money.caseAmount.release'), pounds(EGP(3_500)));
        expectPart(section, t('admin.money.caseAmount.refundedSoFar'), pounds(EGP(1_000)));
      },
    );
  });

  it('draws nothing for a case the read gives no amount', async () => {
    const api = fakeApi({}, 'gender_correction');
    await inBothLocales(
      () => open(api),
      async (t) => {
        await screen.findByText(t('admin.cases.detail.enrollmentTitle'));
        await waitFor(() => expect(api.payments.caseAmount.query).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(screen.queryByText(t('admin.money.caseAmount.title'))).toBeNull();
      },
    );
  });

  it('never asks for a complaint’s amount', async () => {
    const api = fakeApi({ amount: RECITATION });
    await inBothLocales(
      () => open(api, COMPLAINT),
      async (t) => {
        await screen.findByText(t('admin.cases.detail.complaintTitle'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(screen.queryByText(t('admin.money.caseAmount.title'))).toBeNull();
      },
    );
    expect(api.payments.caseAmount.query).not.toHaveBeenCalled();
  });
});

describe('a close on the student’s ban or confirmed fault (003:T124, DEC-91)', () => {
  it.each(['student_banned', 'student_fault_confirmed'])(
    'draws a %s close as 125 owed + 375 the administration’s decision + 350 to the teacher, with the decision’s note',
    async (reason) => {
      const api = fakeApi({ amount: FAULT }, reason);
      await inBothLocales(
        () => open(api),
        async (t, locale) => {
          const section = await screen.findByRole('region', {
            name: t('admin.money.caseAmount.title'),
          });
          const pounds = (value: number) => formatPounds(piasters(value), locale);
          expect(
            within(section).getByText(t('admin.money.caseAmount.cause.studentFaultClose')),
          ).toBeTruthy();
          expectPart(section, t('admin.money.caseAmount.owed'), pounds(EGP(125)));
          expectPart(section, t('admin.money.caseAmount.decision'), pounds(EGP(375)));
          expectPart(section, t('admin.money.caseAmount.release'), pounds(EGP(350)));
          expectPart(section, t('admin.money.caseAmount.refundedSoFar'), pounds(EGP(0)));
          expect(within(section).getByText(t('admin.money.caseAmount.decisionNote'))).toBeTruthy();
          expect(within(section).queryAllByRole('button')).toEqual([]);
        },
      );
    },
  );

  it('shows no «refund» for this cause: no part is labelled as refunded to the student', async () => {
    const api = fakeApi({ amount: FAULT }, 'student_banned');
    await inBothLocales(
      () => open(api),
      async (t) => {
        const section = await screen.findByRole('region', {
          name: t('admin.money.caseAmount.title'),
        });
        expect(within(section).queryByText(t('admin.money.caseAmount.refund'))).toBeNull();
        expect(within(section).queryByText(t('admin.money.caseAmount.total'))).toBeNull();
      },
    );
  });

  // PR #151's review, round 1, nit 5: the Arabic cause line no longer says «nothing is refunded»
  // and then names a refund; it says only what was owed before the close is refunded automatically.
  it('says in Arabic that only what was owed to the student before the close is refunded automatically', async () => {
    open(fakeApi({ amount: FAULT }, 'student_banned'));
    const section = await screen.findByRole('region', {
      name: translate('ar', 'admin.money.caseAmount.title'),
    });
    expect(
      within(section).getByText(
        /^إغلاق بحظر الطالب أو بثبوت خطئه: لا يُرد تلقائيًا إلا ما استُحق للطالب قبل الإغلاق؛ /u,
      ),
    ).toBeTruthy();
  });
});

// 003:T125 (SRS DEC-104, DEC-96; Q-3 (a)): an end by the administration (the student's stop, a
// student's deletion by an administrator, a gender correction) draws its own cause, «أنهت الإدارة
// الباقة», with the refund of what was not taken and the teacher's release; a student's deletion is
// a case of its own reason, `account_deleted`, in words. Written before the words, run red first.
describe('an end by the administration (003:T125, DEC-104)', () => {
  const DIRECT = {
    cause: 'direct_end',
    refund_piasters: EGP(6_000),
    release_piasters: EGP(2_800),
    refunded_piasters: EGP(0),
  };

  it('draws a student’s deletion’s case: its reason, the cause, 6,000 refunded and 2,800 released', async () => {
    const api = fakeApi({ amount: DIRECT }, 'account_deleted');
    await inBothLocales(
      () => open(api),
      async (t, locale) => {
        const section = await screen.findByRole('region', {
          name: t('admin.money.caseAmount.title'),
        });
        const pounds = (value: number) => formatPounds(piasters(value), locale);
        expect(within(section).getByText(t('admin.money.caseAmount.cause.directEnd'))).toBeTruthy();
        expectPart(section, t('admin.money.caseAmount.refund'), pounds(EGP(6_000)));
        expectPart(section, t('admin.money.caseAmount.release'), pounds(EGP(2_800)));
        expect(screen.getAllByText(t('admin.cases.reason.accountDeleted')).length).toBeGreaterThan(
          0,
        );
      },
    );
  });

  it('names the end in Arabic «أنهت الإدارة الباقة», never a complaint', () => {
    const words = translate('ar', 'admin.money.caseAmount.cause.directEnd');
    expect(words).toContain('أنهت الإدارة الباقة');
    expect(words).not.toContain('شكوى');
  });
});
