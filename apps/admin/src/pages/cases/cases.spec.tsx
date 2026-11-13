// T050 (FR-478, FR-422, FR-451, FR-426, FR-493; R-MONEY-6; admin-surface.md, `cases`): the
// compensation-case queue and a case's page through the router, in both languages. The queue as the
// server orders it (the open `student_suspended` cases first), each case by its reason in plain
// words, a complaint of a teacher's absence by its kind, the two manual reasons by their party,
// opened and closed, the enrollment's count and mark; its status filter and its pages; «open a
// case» with no enrollment. A case's page at `?case=`: the case, its closing, a complaint's text,
// the enrollment with both parties (a deleted one by its stand-in), its status, track, count and
// mark, what the case covers with each session's status and remedy, the links to `/sessions` and
// `/payments` by the enrollment, the manual case taken with the enrollment, the held files only on
// an open matter whose enrollment has a deleted party. No amount anywhere.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { dayMonth, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import {
  currentPath,
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
  type Translate,
} from '../../test/app-harness';
import { caseTitle, REASON } from './words';

afterEach(() => setLocale('ar'));

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const id = (n: number) => `0193a6f0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ENROLLMENT = id(901);
const OTHER_ENROLLMENT = id(902);
const SUSPENDED_CASE = id(11);
const COMPLAINT = id(12);
const MANUAL_STUDENT = id(13);
const MANUAL_TEACHER = id(14);
const SESSION_1 = id(31);
const SESSION_2 = id(32);
const REMEDY = id(41);
const ADMIN = id(99);

/** Every compensation reason of T004, T064 and T071 and its words. */
const REASONS = [
  ['slot_unavailable', 'admin.cases.reason.slotUnavailable'],
  ['party_restricted', 'admin.cases.reason.partyRestricted'],
  ['duplicate_payment', 'admin.cases.reason.duplicatePayment'],
  ['absence_termination', 'admin.cases.reason.absenceTermination'],
  ['admin_cancellation', 'admin.cases.reason.adminCancellation'],
  ['teacher_ended', 'admin.cases.reason.teacherEnded'],
  ['student_suspended', 'admin.cases.reason.studentSuspended'],
  ['student_banned', 'admin.cases.reason.studentBanned'],
  ['student_fault_confirmed', 'admin.cases.reason.studentFaultConfirmed'],
  ['refund_choice', 'admin.cases.reason.refundChoice'],
  ['counter_unanswered', 'admin.cases.reason.counterUnanswered'],
  ['makeup_refused', 'admin.cases.reason.makeupRefused'],
  ['admin_opened_for_student', 'admin.cases.reason.adminOpenedForStudent'],
  ['admin_opened_for_teacher', 'admin.cases.reason.adminOpenedForTeacher'],
  ['teacher_suspended', 'admin.cases.reason.teacherSuspended'],
] as const satisfies readonly (readonly [string, MessageKey])[];

/** The queue's first page, as the server orders it: the open `student_suspended` case first. */
const suspendedRow = {
  caseId: SUSPENDED_CASE,
  kind: 'compensation_case',
  enrollmentId: ENROLLMENT,
  reason: 'student_suspended',
  status: 'open',
  openedAt: '2026-11-10T09:00:00.000Z',
  teacherNoShows: 5,
  repeatedAbsence: true,
} as const;
const complaintRow = {
  caseId: COMPLAINT,
  kind: 'absence_complaint',
  enrollmentId: OTHER_ENROLLMENT,
  status: 'open',
  openedAt: '2026-11-08T09:00:00.000Z',
  teacherNoShows: 2,
  repeatedAbsence: false,
} as const;
const manualStudentRow = {
  caseId: MANUAL_STUDENT,
  kind: 'compensation_case',
  enrollmentId: ENROLLMENT,
  reason: 'admin_opened_for_student',
  status: 'resolved',
  openedAt: '2026-11-01T09:00:00.000Z',
  closedAt: '2026-11-04T15:30:00.000Z',
  teacherNoShows: 5,
  repeatedAbsence: true,
} as const;
/** The second page. */
const manualTeacherRow = {
  caseId: MANUAL_TEACHER,
  kind: 'compensation_case',
  enrollmentId: OTHER_ENROLLMENT,
  reason: 'admin_opened_for_teacher',
  status: 'dismissed',
  openedAt: '2026-10-20T09:00:00.000Z',
  closedAt: '2026-10-22T09:00:00.000Z',
  teacherNoShows: 0,
  repeatedAbsence: false,
} as const;

const CURSOR = `rest:${MANUAL_STUDENT}`;

const live = (userId: string, displayName: string) => ({ userId, displayName, deleted: false });
const gone = (userId: string) => ({ userId, displayName: null, deleted: true });

const STUDENT = live(id(51), 'عبد الله حسن');
const TEACHER = live(id(52), 'Sara Adel');

/** `cases.get` of the open suspension case: two covered sessions, one with its remedy. */
function suspendedDetail(
  parties: { readonly student?: object; readonly teacher?: object } = {},
  more: Record<string, unknown> = {},
) {
  return {
    case: {
      caseId: SUSPENDED_CASE,
      kind: 'compensation_case',
      enrollmentId: ENROLLMENT,
      reason: 'student_suspended',
      status: 'open',
      openedAt: '2026-11-10T09:00:00.000Z',
      ...more,
    },
    enrollment: {
      enrollmentId: ENROLLMENT,
      student: parties.student ?? STUDENT,
      teacher: parties.teacher ?? TEACHER,
      status: 'confirmed',
      track: 'recitation',
      teacherNoShows: 5,
      repeatedAbsence: true,
    },
    covers: [
      { sessionId: SESSION_1, sequenceNumber: 3, status: 'cancelled_by_admin' },
      {
        sessionId: SESSION_2,
        sequenceNumber: 4,
        status: 'teacher_no_show',
        remedy: { remedyId: REMEDY, kind: 'makeup', status: 'awaiting_choice' },
      },
    ],
    paymentsLink: { enrollmentId: ENROLLMENT },
  };
}

const complaintDetail = (more: Record<string, unknown> = {}, decision?: string) => ({
  case: {
    caseId: COMPLAINT,
    kind: 'absence_complaint',
    enrollmentId: OTHER_ENROLLMENT,
    status: 'open',
    openedAt: '2026-11-08T09:00:00.000Z',
    ...more,
  },
  complaint: {
    reason: 'غاب المعلم ثلاث مرات دون إخبار',
    raisedAt: '2026-11-08T09:00:00.000Z',
    ...(decision === undefined ? {} : { decision }),
  },
  enrollment: {
    enrollmentId: OTHER_ENROLLMENT,
    student: STUDENT,
    teacher: TEACHER,
    status: 'confirmed',
    track: 'ijazah_track',
    teacherNoShows: 2,
    repeatedAbsence: false,
  },
  covers: [],
  paymentsLink: { enrollmentId: OTHER_ENROLLMENT },
});

function fakeApi() {
  const api = {
    cases: {
      list: query(),
      get: query(),
      resolve: mutation(),
      dismiss: mutation(),
      decideComplaint: mutation(),
      openManual: mutation(),
    },
    disputes: { heldFiles: query(), heldFileLink: mutation() },
    payments: { list: query(), get: query() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.cases.list.query.mockImplementation(async (input) => {
    const { cursor } = (input ?? {}) as { cursor?: string };
    if (cursor === CURSOR) return { items: [manualTeacherRow] };
    return { items: [suspendedRow, complaintRow, manualStudentRow], nextCursor: CURSOR };
  });
  api.cases.get.query.mockImplementation(async (input) => {
    const { caseId } = input as { caseId: string };
    return caseId === COMPLAINT ? complaintDetail() : suspendedDetail();
  });
  api.disputes.heldFiles.query.mockResolvedValue({ files: [] });
  api.payments.list.query.mockResolvedValue({ items: [] });
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

type Api = ReturnType<typeof fakeApi>;

const verified = { token: 't', step: 'verified' } as const;

let current: { readonly api: Api };

function open(api: Api = fakeApi(), at = '/cases') {
  current = { api };
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The queue's row whose case cell reads `words`. */
async function rowOf(words: string) {
  const table = await screen.findByRole('table');
  const cell = await within(table).findByText(words);
  return within(cell.closest('tr') as HTMLElement);
}

async function panelOf(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', { name: t('admin.cases.detail.a11y') });
  return within(aside);
}

const when = (t: Translate, locale: 'ar' | 'en', instant: string) => {
  const zone = panelTimeZone();
  return t('admin.common.dateTime', {
    date: dayMonth(instant, locale, zone),
    time: timeOfDay(instant, locale, zone),
  });
};

/** An amount, in either language: the pound's sign or name, or a piaster. */
const AMOUNT = /ج\.م|جنيه|قرش|EGP|£|piaster|pound/i;
/** Never on the page: anything, a ban or a closing, said to be final. */
const FINAL = /نهائي|لا يُرفع|permanent|for good|not lifted|final/i;

describe('the queue (T050, FR-478)', () => {
  it('lists the cases in the server’s order, each by its reason, opened and closed, its status, and its enrollment’s count and mark, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByRole('heading', { name: t('admin.cases.title') })).toBeTruthy();
        expect(screen.getByText(t('admin.cases.lede'))).toBeTruthy();
        const suspended = await rowOf(t('admin.cases.reason.studentSuspended'));
        for (const column of ['case', 'enrollment', 'status'] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.cases.columns.${column}`) }),
          ).toBeTruthy();
        }
        expect(
          suspended.getByText(
            t('admin.cases.openedAt', { date: when(t, locale, suspendedRow.openedAt) }),
          ),
        ).toBeTruthy();
        expect(suspended.getByText(t('admin.cases.status.open'))).toBeTruthy();
        expect(suspended.getByText(t('admin.shared.noShows.count', { count: 5 }))).toBeTruthy();
        expect(suspended.getByText(t('admin.shared.noShows.mark'))).toBeTruthy();

        const complaint = await rowOf(t('admin.cases.kind.absenceComplaint'));
        expect(complaint.getByText(t('admin.shared.noShows.count', { count: 2 }))).toBeTruthy();
        expect(complaint.queryByText(t('admin.shared.noShows.mark'))).toBeNull();

        const closed = await rowOf(t('admin.cases.reason.adminOpenedForStudent'));
        expect(
          closed.getByText(
            t('admin.cases.closedAt', { date: when(t, locale, manualStudentRow.closedAt) }),
          ),
        ).toBeTruthy();
        expect(closed.getByText(t('admin.cases.status.resolved'))).toBeTruthy();

        const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
        expect(rows.map((row) => row.querySelector('strong')?.textContent)).toEqual([
          t('admin.cases.reason.studentSuspended'),
          t('admin.cases.kind.absenceComplaint'),
          t('admin.cases.reason.adminOpenedForStudent'),
        ]);
        expect(document.body.textContent ?? '').not.toMatch(FINAL);
      },
    );
  });

  it('names every reason in plain words, a complaint by its kind, and the two manual reasons by their party, in both languages', async () => {
    const api = fakeApi();
    api.cases.list.query.mockResolvedValue({
      items: [
        ...REASONS.map(([reason], index) => ({
          ...manualTeacherRow,
          caseId: id(100 + index),
          reason,
        })),
        complaintRow,
      ],
    });
    await inBothLocales(
      () => open(api),
      async (t) => {
        await rowOf(t('admin.cases.kind.absenceComplaint'));
        for (const [, words] of REASONS) expect(await rowOf(t(words))).toBeTruthy();
        expect(t('admin.cases.reason.adminOpenedForStudent')).toMatch(/طالب|student/);
        expect(t('admin.cases.reason.adminOpenedForTeacher')).toMatch(/معلم|teacher/);
      },
    );
  });

  it('reads the first page with no filter, and pages by the cursor the server wrote', async () => {
    const { api } = open();
    await rowOf(ar('admin.cases.reason.studentSuspended'));
    expect(api.cases.list.query).toHaveBeenLastCalledWith({});
    const pages = screen.getByRole('navigation', { name: ar('admin.common.a11y.pages') });
    fireEvent.click(within(pages).getByRole('button', { name: '2' }));
    await rowOf(ar('admin.cases.reason.adminOpenedForTeacher'));
    expect(api.cases.list.query).toHaveBeenLastCalledWith({ cursor: CURSOR });
  });

  it('filters by status, and back to all', async () => {
    const { api } = open();
    await rowOf(ar('admin.cases.reason.studentSuspended'));
    for (const status of ['open', 'resolved', 'dismissed'] as const) {
      fireEvent.click(screen.getByRole('tab', { name: ar(`admin.cases.status.${status}`) }));
      await waitFor(() => expect(api.cases.list.query).toHaveBeenLastCalledWith({ status }));
    }
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.common.action.all') }));
    // The unfiltered first page, kept a little while, is shown again from the cache.
    await rowOf(ar('admin.cases.reason.studentSuspended'));
    expect(api.cases.list.query.mock.calls.map(([input]) => input)).toEqual([
      {},
      { status: 'open' },
      { status: 'resolved' },
      { status: 'dismissed' },
    ]);
  });

  it('says when there is no case yet, and when a status finds none', async () => {
    const api = fakeApi();
    api.cases.list.query.mockResolvedValue({ items: [] });
    open(api);
    expect(await screen.findByText(ar('admin.cases.emptyAll.title'))).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.cases.status.dismissed') }));
    expect(await screen.findByText(ar('admin.cases.empty.title'))).toBeTruthy();
  });

  it('says the list could not load in the generic words, and reads it again on «إعادة المحاولة»', async () => {
    const api = fakeApi();
    api.cases.list.query.mockRejectedValueOnce(refusal('INTERNAL'));
    open(api);
    expect(
      await screen.findByText(
        ar('admin.common.loadError.title', { page: ar('admin.cases.title') }),
      ),
    ).toBeTruthy();
    expect(screen.getByText(ar('admin.common.loadError.text'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ar('admin.common.action.retry') }));
    await rowOf(ar('admin.cases.reason.studentSuspended'));
  });

  it('opens the manual case’s dialog with no enrollment: the enrollment is entered, nothing sent on opening, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        await rowOf(t('admin.cases.reason.studentSuspended'));
        fireEvent.click(screen.getByRole('button', { name: t('admin.cases.openManual') }));
        const heading = await screen.findByRole('heading', {
          level: 2,
          name: t('admin.shared.manualCase.title'),
        });
        const dialog = within(heading.closest('section.dialog') as HTMLElement);
        expect(dialog.getByLabelText(t('admin.shared.manualCase.enrollmentLabel'))).toBeTruthy();
        expect(current.api.cases.openManual.mutate).not.toHaveBeenCalled();
      },
    );
  });

  it('shows no amount and reads no payment', async () => {
    open();
    await rowOf(ar('admin.cases.reason.studentSuspended'));
    expect(document.body.textContent ?? '').not.toMatch(AMOUNT);
    expect(current.api.payments.list.query).not.toHaveBeenCalled();
    expect(current.api.payments.get.query).not.toHaveBeenCalled();
  });
});

describe('a case’s page (T050, FR-478, FR-451, FR-426)', () => {
  it('opens a row’s case at `?case=`', async () => {
    const { api } = open();
    fireEvent.click(
      (await screen.findByText(ar('admin.cases.reason.studentSuspended'))).closest(
        'tr',
      ) as HTMLElement,
    );
    await panelOf();
    await waitFor(() => expect(currentPath()).toBe(`/cases?case=${SUSPENDED_CASE}`));
    expect(api.cases.get.query).toHaveBeenCalledWith({ caseId: SUSPENDED_CASE });
  });

  it('shows the case, the enrollment with both parties, its status, track, count and mark, and what it covers, each session with its status and remedy, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/cases?case=${SUSPENDED_CASE}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        expect(await panel.findByText(t('admin.cases.detail.enrollmentTitle'))).toBeTruthy();
        expect(panel.getAllByText(t('admin.cases.reason.studentSuspended')).length).toBeGreaterThan(
          0,
        );
        expect(
          panel.getByText(
            t('admin.cases.openedAt', { date: when(t, locale, '2026-11-10T09:00:00.000Z') }),
          ),
        ).toBeTruthy();
        expect(panel.getByText(STUDENT.displayName)).toBeTruthy();
        expect(panel.getByText(TEACHER.displayName)).toBeTruthy();
        expect(panel.getByText(t('admin.status.enrollment.confirmed'))).toBeTruthy();
        expect(panel.getByText(t('admin.status.track.recitation'))).toBeTruthy();
        expect(panel.getByText(t('admin.shared.noShows.count', { count: 5 }))).toBeTruthy();
        expect(panel.getByText(t('admin.shared.noShows.mark'))).toBeTruthy();

        expect(panel.getByText(t('admin.cases.detail.coversTitle'))).toBeTruthy();
        const covered = (number: number) =>
          within(
            panel
              .getByText(t('admin.cases.detail.session', { number }))
              .closest('.list__row') as HTMLElement,
          );
        expect(covered(3).getByText(t('admin.status.session.cancelledByAdmin'))).toBeTruthy();
        expect(covered(3).queryByText(t('admin.cases.detail.remedyKind.makeup'))).toBeNull();
        expect(covered(4).getByText(t('admin.status.session.teacherNoShow'))).toBeTruthy();
        expect(covered(4).getByText(t('admin.cases.detail.remedyKind.makeup'))).toBeTruthy();
        expect(
          covered(4).getByText(t('admin.cases.detail.remedyStatus.awaitingChoice')),
        ).toBeTruthy();
        expect(document.body.textContent ?? '').not.toMatch(FINAL);
      },
    );
  });

  it('says a case covering no session in words', async () => {
    const api = fakeApi();
    api.cases.get.query.mockResolvedValue({ ...suspendedDetail(), covers: [] });
    open(api, `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    expect(await panel.findByText(ar('admin.cases.detail.coversEmpty'))).toBeTruthy();
  });

  it('links to the enrollment’s sessions and to its orders on `/payments` by the enrollment, with no amount, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/cases?case=${SUSPENDED_CASE}`),
      async (t) => {
        const panel = await panelOf(t);
        const sessions = await panel.findByRole('link', {
          name: t('admin.cases.detail.sessionsLink'),
        });
        expect(sessions.getAttribute('href')).toBe(`/sessions?enrollment=${ENROLLMENT}`);
        const payments = panel.getByRole('link', { name: t('admin.common.action.openInPayments') });
        expect(payments.getAttribute('href')).toBe(`/payments?enrollment=${ENROLLMENT}`);
        expect(panel.getByText(t('admin.cases.detail.paymentsNote'))).toBeTruthy();
        expect(document.body.textContent ?? '').not.toMatch(AMOUNT);
      },
    );
  });

  it('follows the payments link to `/payments?enrollment=`, reading no payment here first', async () => {
    const { api } = open(fakeApi(), `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    expect(api.payments.list.query).not.toHaveBeenCalled();
    fireEvent.click(
      await panel.findByRole('link', { name: ar('admin.common.action.openInPayments') }),
    );
    await waitFor(() => expect(currentPath()).toBe(`/payments?enrollment=${ENROLLMENT}`));
  });

  it('shows a closed case’s closing: its date, its resolution and its note', async () => {
    const api = fakeApi();
    api.cases.get.query.mockResolvedValue(
      suspendedDetail(
        {},
        {
          reason: 'admin_opened_for_student',
          status: 'resolved',
          closedAt: '2026-11-04T15:30:00.000Z',
          resolution: 'compensation_ordered',
          note: 'حُوّل المبلغ للطالب يدويًا',
        },
      ),
    );
    open(api, `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    expect(
      await panel.findByText(ar('admin.cases.detail.resolution.compensationOrdered')),
    ).toBeTruthy();
    expect(panel.getByText('حُوّل المبلغ للطالب يدويًا')).toBeTruthy();
    expect(
      panel.getByText(
        ar('admin.cases.closedAt', { date: when(ar, 'ar', '2026-11-04T15:30:00.000Z') }),
      ),
    ).toBeTruthy();
  });

  it('offers no resolve, dismiss or decision on a closed case', async () => {
    const api = fakeApi();
    api.cases.get.query.mockResolvedValue(
      suspendedDetail(
        {},
        { status: 'dismissed', closedAt: '2026-11-04T15:30:00.000Z', note: 'خطأ' },
      ),
    );
    open(api, `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    await panel.findByText(ar('admin.cases.detail.enrollmentTitle'));
    for (const key of [
      'admin.cases.action.resolve',
      'admin.cases.action.dismiss',
      'admin.cases.action.decide',
    ] as const) {
      expect(panel.queryByRole('button', { name: ar(key) })).toBeNull();
    }
    expect(panel.getByRole('button', { name: ar('admin.cases.detail.openManual') })).toBeTruthy();
  });

  it('names a deleted party by its stand-in, never an empty name', async () => {
    const api = fakeApi();
    api.cases.get.query.mockResolvedValue(suspendedDetail({ teacher: gone(TEACHER.userId) }));
    open(api, `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    expect(await panel.findByText(ar('admin.shared.party.deletedTeacher'))).toBeTruthy();
    expect(panel.getByText(STUDENT.displayName)).toBeTruthy();
  });

  it.each([
    ['student', { student: gone(STUDENT.userId) }],
    ['teacher', { teacher: gone(TEACHER.userId) }],
  ] as const)(
    'shows the held files of an open case whose %s is deleted, read with the case’s id',
    async (_party, parties) => {
      const api = fakeApi();
      api.cases.get.query.mockResolvedValue(suspendedDetail(parties));
      open(api, `/cases?case=${SUSPENDED_CASE}`);
      const panel = await panelOf();
      expect(await panel.findByText(ar('admin.shared.heldFiles.title'))).toBeTruthy();
      await waitFor(() =>
        expect(api.disputes.heldFiles.query).toHaveBeenCalledWith({ disputeId: SUSPENDED_CASE }),
      );
    },
  );

  it('shows the held files of an open complaint whose party is deleted, read with the complaint’s id', async () => {
    const api = fakeApi();
    const detail = complaintDetail();
    api.cases.get.query.mockResolvedValue({
      ...detail,
      enrollment: { ...detail.enrollment, teacher: gone(TEACHER.userId) },
    });
    open(api, `/cases?case=${COMPLAINT}`);
    const panel = await panelOf();
    expect(await panel.findByText(ar('admin.shared.heldFiles.title'))).toBeTruthy();
    await waitFor(() =>
      expect(api.disputes.heldFiles.query).toHaveBeenCalledWith({ disputeId: COMPLAINT }),
    );
  });

  it('shows no held files when no party of the enrollment is deleted', async () => {
    const { api } = open(fakeApi(), `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    await panel.findByText(ar('admin.cases.detail.enrollmentTitle'));
    expect(panel.queryByText(ar('admin.shared.heldFiles.title'))).toBeNull();
    expect(api.disputes.heldFiles.query).not.toHaveBeenCalled();
  });

  it('shows no held files on a closed case, even with a deleted party', async () => {
    const api = fakeApi();
    api.cases.get.query.mockResolvedValue(
      suspendedDetail(
        { student: gone(STUDENT.userId) },
        { status: 'resolved', closedAt: '2026-11-04T15:30:00.000Z', note: 'تم' },
      ),
    );
    open(api, `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    await panel.findByText(ar('admin.cases.detail.enrollmentTitle'));
    expect(panel.queryByText(ar('admin.shared.heldFiles.title'))).toBeNull();
    expect(api.disputes.heldFiles.query).not.toHaveBeenCalled();
  });

  it('shows a complaint’s text and its raising, and offers its decision but never resolve or dismiss, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/cases?case=${COMPLAINT}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        expect(await panel.findByText('غاب المعلم ثلاث مرات دون إخبار')).toBeTruthy();
        expect(panel.getByText(t('admin.cases.detail.complaintTitle'))).toBeTruthy();
        expect(
          panel.getByText(
            t('admin.cases.detail.raisedAt', { date: when(t, locale, '2026-11-08T09:00:00.000Z') }),
          ),
        ).toBeTruthy();
        expect(panel.getByRole('button', { name: t('admin.cases.action.decide') })).toBeTruthy();
        expect(panel.queryByRole('button', { name: t('admin.cases.action.resolve') })).toBeNull();
        expect(panel.queryByRole('button', { name: t('admin.cases.action.dismiss') })).toBeNull();
      },
    );
  });

  it('offers resolve and dismiss on an open compensation case, never a complaint’s decision', async () => {
    open(fakeApi(), `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    expect(
      await panel.findByRole('button', { name: ar('admin.cases.action.resolve') }),
    ).toBeTruthy();
    expect(panel.getByRole('button', { name: ar('admin.cases.action.dismiss') })).toBeTruthy();
    expect(panel.queryByRole('button', { name: ar('admin.cases.action.decide') })).toBeNull();
  });

  it('shows a decided complaint’s decision', async () => {
    const api = fakeApi();
    api.cases.get.query.mockResolvedValue(
      complaintDetail(
        {
          status: 'resolved',
          closedAt: '2026-11-09T09:00:00.000Z',
          resolution: 'party_suspended',
          note: 'تكرر',
        },
        'suspend_teacher',
      ),
    );
    open(api, `/cases?case=${COMPLAINT}`);
    const panel = await panelOf();
    expect(await panel.findByText(ar('admin.cases.decide.suspendTeacher.label'))).toBeTruthy();
    expect(panel.getByText(ar('admin.cases.detail.resolution.partySuspended'))).toBeTruthy();
    expect(panel.queryByRole('button', { name: ar('admin.cases.action.decide') })).toBeNull();
  });

  it('opens the manual case from a case’s page with its enrollment, sending the case’s enrollment', async () => {
    const api = fakeApi();
    api.cases.openManual.mutate.mockResolvedValue({
      caseId: id(77),
      enrollmentId: ENROLLMENT,
      party: 'teacher',
      status: 'open',
      joined: false,
    });
    open(api, `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    fireEvent.click(
      await panel.findByRole('button', { name: ar('admin.cases.detail.openManual') }),
    );
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: ar('admin.shared.manualCase.title'),
    });
    const dialog = within(heading.closest('section.dialog') as HTMLElement);
    expect(dialog.queryByLabelText(ar('admin.shared.manualCase.enrollmentLabel'))).toBeNull();
    fireEvent.click(dialog.getByLabelText(ar('admin.shared.manualCase.partyTeacher')));
    fireEvent.change(dialog.getByLabelText(ar('admin.shared.manualCase.reasonLabel')), {
      target: { value: 'سبب واضح' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.shared.manualCase.confirm') }));
    await waitFor(() => expect(api.cases.openManual.mutate).toHaveBeenCalledTimes(1));
    expect(api.cases.openManual.mutate.mock.calls[0]?.[0]).toMatchObject({
      enrollmentId: ENROLLMENT,
      party: 'teacher',
      reason: 'سبب واضح',
    });
  });

  it('says a case that could not load in the generic words', async () => {
    const api = fakeApi();
    api.cases.get.query.mockRejectedValue(refusal('NOT_FOUND'));
    open(api, `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    expect(await panel.findByText(ar('admin.common.loadError.text'))).toBeTruthy();
  });

  it('shows no amount on a case’s page and reads no payment', async () => {
    const { api } = open(fakeApi(), `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    await panel.findByText(ar('admin.cases.detail.coversTitle'));
    expect(document.body.textContent ?? '').not.toMatch(AMOUNT);
    expect(api.payments.list.query).not.toHaveBeenCalled();
    expect(api.payments.get.query).not.toHaveBeenCalled();
  });
});

describe('T058: RATE_LIMITED on /cases', () => {
  it('the queue says when to try again', async () => {
    const api = fakeApi();
    api.cases.list.query.mockRejectedValue(
      refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('a case’s read says to wait a little when no time is given', async () => {
    const api = fakeApi();
    api.cases.get.query.mockRejectedValue(refusal('RATE_LIMITED'));
    open(api, `/cases?case=${SUSPENDED_CASE}`);
    const panel = await panelOf();
    expect(await panel.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(panel.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });
});

// B42a, Q-B2 (a) (the owner, 2026-11-13; the review session's wording): T071 made a teacher's
// suspension pause the enrollment, with its own `teacher_suspended` case, so `teacher_ended` now
// means only a revocation, a ban or a deletion. Each reason's words, in both languages.
describe('B42a Q-B2 (a): a teacher’s suspension and a teacher’s end, in words', () => {
  const words = (key: MessageKey | undefined) => ({
    ar: key === undefined ? undefined : translate('ar', key),
    en: key === undefined ? undefined : translate('en', key),
  });

  it('names a `teacher_suspended` case as an enrollment paused until the teacher returns', () => {
    expect(words(caseTitle({ kind: 'compensation_case', reason: 'teacher_suspended' }))).toEqual({
      ar: 'أُوقف المعلم، والاشتراك متوقف مؤقتًا حتى يعود',
      en: 'The teacher was suspended; the enrollment is paused until they return',
    });
  });

  it('names a `teacher_ended` case as a revocation, a ban or a deletion, never a suspension', () => {
    expect(words(REASON.teacher_ended)).toEqual({
      ar: 'سُحب اعتماد المعلم أو حُظر أو حُذف حسابه',
      en: 'The teacher’s approval was revoked, or they were banned or their account deleted',
    });
  });
});
