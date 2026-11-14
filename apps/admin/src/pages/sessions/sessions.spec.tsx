// B42, T047 (FR-460, FR-479, FR-454, FR-439, FR-493, FR-451, FR-426; R-MONEY-6; R-323 GAP-1, GAP-2,
// GAP-4): the enrollment and session monitor at `/sessions`, through the router, in both languages.
// - the list with its search by student and teacher, its status tabs, its from–to local days and
//   its keyset pages; each enrollment's parties (a deleted one's stand-in), status, progress, its
//   Teacher-No-Show count and mark, and its next session;
// - `?enrollment=` opening an enrollment beside the list: its sessions in their own zone and the
//   panel's, each remedy with its state, deadlines, pending counter-proposal and «booking refused,
//   retried until …», its cases linking to `/cases?case=`, its timeline newest first, each session
//   no longer scheduled linking to its telemetry (`/review?session=`), payment status only as a link
//   to `/payments?enrollment=`, and no amount anywhere;
// - the cancellation, the restore, the correction and the manual case, each shown only while the
//   server's field allows it, each a dialog with its mandatory reason, each refusal in plain words.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import arCatalogue from '../../i18n/ar.json';
import enCatalogue from '../../i18n/en.json';
import { type MessageKey, setLocale, translate } from '../../i18n';
import { cityName, dayMonth, timeOfDay } from '../../lib/format';
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
import type { MonitoredEvent } from './queries';
import { CASE_REASON, eventWords } from './words';

afterEach(() => {
  setLocale('ar');
});

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const id = (suffix: string) => `0193a6f0-0000-7000-8000-${suffix.padStart(12, '0')}`;
const E1 = id('e1');
const E2 = id('e2');
const S1 = id('51');
const S2 = id('52');
const S3 = id('53');
const S4 = id('54');
const S5 = id('55');
const R1 = id('71');
const R2 = id('72');
const R3 = id('73');
const C1 = id('c1');
const C2 = id('c2');
const RIYADH = 'Asia/Riyadh';

const AMAL = { userId: id('a1'), displayName: 'آمال علي', deleted: false };
const GONE = { userId: id('a2'), displayName: null, deleted: true };
const SARA = { userId: id('b1'), displayName: 'المعلمة سارة', deleted: false };

const confirmedItem = {
  enrollmentId: E1,
  student: AMAL,
  teacher: SARA,
  status: 'confirmed',
  track: 'recitation',
  sessionCount: 8,
  completed: 3,
  remaining: 5,
  teacherNoShows: 5,
  repeatedAbsence: true,
  nextSession: {
    sessionId: S5,
    localDate: '2026-11-17',
    startTimeLocal: '14:00',
    timezone: RIYADH,
    startsAt: '2026-11-17T11:00:00.000Z',
  },
} as const;

const closedItem = {
  enrollmentId: E2,
  student: GONE,
  teacher: SARA,
  status: 'terminated_no_show',
  track: 'ijazah_track',
  sessionCount: 4,
  completed: 1,
  remaining: 3,
  teacherNoShows: 2,
  repeatedAbsence: false,
} as const;

const RESTORABLE_UNTIL = '2026-11-20T10:00:00.000Z';
/**
 * B42c, T083 (Q-O1 (a)): the monitor's `enrollmentRestoreWindowDays`, apart from the default 14 so
 * the end's «احجز الموعد {days} يومًا» shows that it reads the field.
 */
const RESTORE_WINDOW_DAYS = 9;
/** B42b, T075: T070's `slotHeldUntil`, apart from the deprecated `restorableUntil` so its read shows. */
const SLOT_HELD_UNTIL = '2026-11-21T10:00:00.000Z';

function session(n: number, status: string, extra: Record<string, unknown> = {}) {
  const day = String(2 + n).padStart(2, '0');
  return {
    sessionId: [S1, S2, S3, S4, S5][n - 1],
    sequenceNumber: n,
    localDate: `2026-11-${day}`,
    startTimeLocal: '14:00',
    timezone: RIYADH,
    startsAt: `2026-11-${day}T11:00:00.000Z`,
    endsAt: `2026-11-${day}T12:00:00.000Z`,
    status,
    cancellable: false,
    correctable: false,
    ...extra,
  };
}

const proposal = {
  localDate: '2026-11-24',
  startTimeLocal: '14:00',
  timezone: RIYADH,
  startsAt: '2026-11-24T11:00:00.000Z',
};
const counter = {
  localDate: '2026-11-26',
  startTimeLocal: '16:00',
  timezone: RIYADH,
  startsAt: '2026-11-26T13:00:00.000Z',
  proposedAt: '2026-11-12T08:00:00.000Z',
  answerClosesAt: '2026-11-14T08:00:00.000Z',
};

const closedDetail = {
  enrollment: {
    ...closedItem,
    restorableUntil: RESTORABLE_UNTIL,
    slotHeldUntil: SLOT_HELD_UNTIL,
    enrollmentRestoreWindowDays: RESTORE_WINDOW_DAYS,
  },
  sessions: [
    session(1, 'done', { correctable: true }),
    session(2, 'teacher_no_show', {
      remedy: {
        remedyId: R1,
        kind: 'makeup',
        status: 'proposed',
        offeredAt: '2026-11-05T09:00:00.000Z',
        choiceClosesAt: '2026-11-08T09:00:00.000Z',
        proposal,
        bookingRetriedUntil: '2026-11-23T11:00:00.000Z',
      },
    }),
    session(3, 'teacher_no_show', {
      remedy: {
        remedyId: R2,
        kind: 'makeup',
        status: 'counter_proposed',
        offeredAt: '2026-11-11T09:00:00.000Z',
        choiceClosesAt: '2026-11-15T09:00:00.000Z',
        proposal,
        counter,
      },
    }),
    session(4, 'disputed', {
      outcomeUnderDispute: 'teacher_no_show',
      remedy: {
        remedyId: R3,
        kind: 'refund',
        status: 'refund_case',
        offeredAt: '2026-11-07T09:00:00.000Z',
        choiceClosesAt: '2026-11-10T09:00:00.000Z',
        caseId: C2,
        decidedAt: '2026-11-08T09:00:00.000Z',
      },
    }),
    session(5, 'scheduled', { cancellable: true, makeupFor: { sessionId: S2, sequenceNumber: 2 } }),
  ],
  cases: [
    { caseId: C1, reason: 'absence_termination', status: 'open' },
    { caseId: C2, reason: 'refund_choice', status: 'resolved' },
  ],
  cancellationRequests: [],
  events: [
    { source: 'enrollment', kind: 'terminated_no_show', occurredAt: '2026-11-13T10:00:00.000Z' },
    {
      source: 'session',
      kind: 'counter_proposed',
      sessionId: S3,
      occurredAt: '2026-11-12T08:00:00.000Z',
    },
    {
      source: 'session',
      kind: 'outcome_corrected',
      sessionId: S1,
      outcomeBefore: 'student_no_show',
      outcomeAfter: 'done',
      occurredAt: '2026-11-04T09:00:00.000Z',
    },
    {
      source: 'enrollment',
      kind: 'cancelled',
      cancellationReason: 'admin',
      occurredAt: '2026-11-02T09:00:00.000Z',
    },
    { source: 'enrollment', kind: 'confirmed', occurredAt: '2026-11-01T10:00:00.000Z' },
  ],
};

/** An enrollment with nothing restorable: no `restorableUntil`. */
const confirmedDetail = {
  ...closedDetail,
  enrollment: {
    ...(({ nextSession: _next, ...rest }) => rest)(confirmedItem),
    enrollmentRestoreWindowDays: RESTORE_WINDOW_DAYS,
  },
};

function fakeApi() {
  const api = {
    sessions: {
      monitor: { list: query(), get: query() },
      cancel: mutation(),
      restore: mutation(),
      endEnrollment: mutation(),
      review: { revise: mutation() },
    },
    enrollments: { releaseSlot: mutation() },
    cases: { openManual: mutation() },
    payments: { list: query(), get: query() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.sessions.monitor.list.query.mockImplementation(async (input) => {
    const { cursor } = (input ?? {}) as { cursor?: string };
    if (cursor === E2) return { items: [{ ...closedItem, enrollmentId: id('e3') }] };
    return { items: [confirmedItem, closedItem], nextCursor: E2 };
  });
  api.sessions.monitor.get.query.mockImplementation(async (input) =>
    (input as { enrollmentId: string }).enrollmentId === E2 ? closedDetail : confirmedDetail,
  );
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: id('99'), displayName: 'سارة', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

function open(api = fakeApi(), at = '/sessions') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** An instant in the panel's zone, as the page prints a deadline or an event. */
function at(t: Translate, locale: 'ar' | 'en', value: string): string {
  const zone = panelTimeZone();
  return t('admin.common.dateTime', {
    date: dayMonth(value, locale, zone),
    time: timeOfDay(value, locale, zone),
  });
}

/** A time a session or a remedy names, in its own zone. */
function own(
  t: Translate,
  locale: 'ar' | 'en',
  time: { localDate: string; timezone: string; startsAt: string },
): string {
  return t('admin.sessions.time.session', {
    date: dayMonth(time.localDate, locale, time.timezone),
    time: timeOfDay(time.startsAt, locale, time.timezone),
    city: cityName(time.timezone, locale),
  });
}

async function rowOf(text: string) {
  const cell = await screen.findByText(text);
  return cell.closest('tr') as HTMLElement;
}

/** The enrollment's panel beside the list. */
async function panelOf(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', { name: t('admin.sessions.detail.a11y') });
  const panel = within(aside);
  await panel.findByRole('region', { name: t('admin.sessions.detail.sessionsTitle') });
  return panel;
}

/** The panel's row of session `n`. */
function sessionRow(panel: ReturnType<typeof within>, n: number, t: Translate = ar) {
  return within(panel.getByRole('listitem', { name: t('admin.sessions.detail.session', { n }) }));
}

async function openDetail(at = `/sessions?enrollment=${E2}`, api = fakeApi()) {
  const opened = open(api, at);
  return { ...opened, panel: await panelOf() };
}

describe('the monitor’s list (FR-479, FR-460)', () => {
  it('draws the list in both languages: the parties, a deleted one’s stand-in, the status, the progress, the count and mark, the next session', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText(t('admin.sessions.lede'))).toBeTruthy();
        await rowOf(AMAL.displayName);
        for (const column of ['student', 'teacher', 'status', 'progress', 'noShows', 'next']) {
          expect(
            screen.getByRole('columnheader', {
              name: t(`admin.sessions.columns.${column}` as MessageKey),
            }),
          ).toBeTruthy();
        }
        const first = within(await rowOf(AMAL.displayName));
        expect(first.getByText(SARA.displayName)).toBeTruthy();
        expect(first.getByText(t('admin.status.enrollment.confirmed'))).toBeTruthy();
        expect(
          first.getByText(t('admin.sessions.progress', { done: 3, total: 8, remaining: 5 })),
        ).toBeTruthy();
        expect(first.getByText(t('admin.shared.noShows.count', { count: 5 }))).toBeTruthy();
        expect(first.getByText(t('admin.shared.noShows.mark'))).toBeTruthy();
        expect(first.getByText(own(t, locale, confirmedItem.nextSession))).toBeTruthy();
        const closed = within(await rowOf(t('admin.shared.party.deletedStudent')));
        expect(closed.getByText(t('admin.status.enrollment.terminatedNoShow'))).toBeTruthy();
        expect(closed.getByText(t('admin.shared.noShows.count', { count: 2 }))).toBeTruthy();
        expect(closed.queryByText(t('admin.shared.noShows.mark'))).toBeNull();
        expect(closed.getByText(t('admin.sessions.noNext'))).toBeTruthy();
      },
    );
  });

  it('reads the first page with no filter, then filters by status, by the student’s and the teacher’s names once the typing stops', async () => {
    const { api } = open();
    await rowOf(AMAL.displayName);
    expect(api.sessions.monitor.list.query).toHaveBeenLastCalledWith({});
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.status.enrollment.cancelled') }));
    await waitFor(() =>
      expect(api.sessions.monitor.list.query).toHaveBeenLastCalledWith({ status: 'cancelled' }),
    );
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.common.action.all') }));
    fireEvent.change(screen.getByLabelText(ar('admin.sessions.filters.student')), {
      target: { value: ' آمال ' },
    });
    await waitFor(() =>
      expect(api.sessions.monitor.list.query).toHaveBeenLastCalledWith({ student: 'آمال' }),
    );
    fireEvent.change(screen.getByLabelText(ar('admin.sessions.filters.teacher')), {
      target: { value: 'سارة' },
    });
    await waitFor(() =>
      expect(api.sessions.monitor.list.query).toHaveBeenLastCalledWith({
        student: 'آمال',
        teacher: 'سارة',
      }),
    );
  });

  it('filters by the from and to local days typed day first, and sends no day that does not exist', async () => {
    const { api } = open();
    await rowOf(AMAL.displayName);
    fireEvent.change(screen.getByLabelText(ar('admin.sessions.filters.from')), {
      target: { value: '01112026' },
    });
    await waitFor(() =>
      expect(api.sessions.monitor.list.query).toHaveBeenLastCalledWith({ from: '2026-11-01' }),
    );
    fireEvent.change(screen.getByLabelText(ar('admin.sessions.filters.to')), {
      target: { value: '31/02/2026' },
    });
    expect(await screen.findByText(ar('admin.sessions.filters.dateInvalid'))).toBeTruthy();
    expect(api.sessions.monitor.list.query).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: expect.anything() }),
    );
    fireEvent.change(screen.getByLabelText(ar('admin.sessions.filters.to')), {
      target: { value: '30/11/2026' },
    });
    await waitFor(() =>
      expect(api.sessions.monitor.list.query).toHaveBeenLastCalledWith({
        from: '2026-11-01',
        to: '2026-11-30',
      }),
    );
  });

  it('pages by the cursor the server wrote', async () => {
    const { api } = open();
    await rowOf(AMAL.displayName);
    const pages = screen.getByRole('navigation', { name: ar('admin.common.a11y.pages') });
    fireEvent.click(within(pages).getByRole('button', { name: '2' }));
    await waitFor(() =>
      expect(api.sessions.monitor.list.query).toHaveBeenLastCalledWith({ cursor: E2 }),
    );
  });

  it('says when there is no enrollment yet, and when a filter finds none', async () => {
    const api = fakeApi();
    api.sessions.monitor.list.query.mockResolvedValue({ items: [] });
    open(api);
    expect(await screen.findByText(ar('admin.sessions.emptyAll.title'))).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.status.enrollment.completed') }));
    expect(await screen.findByText(ar('admin.sessions.empty.title'))).toBeTruthy();
  });

  it('says the list could not load in the page’s generic words, and reads it again on «إعادة المحاولة»', async () => {
    const api = fakeApi();
    api.sessions.monitor.list.query.mockRejectedValueOnce(refusal('INTERNAL'));
    open(api);
    expect(await screen.findByText(ar('admin.common.loadError.text'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ar('admin.common.action.retry') }));
    await rowOf(AMAL.displayName);
  });

  it('opens an enrollment beside the list from its row, at `?enrollment=`', async () => {
    const { api } = open();
    fireEvent.click(await rowOf(AMAL.displayName));
    await panelOf();
    expect(currentPath()).toBe(`/sessions?enrollment=${E1}`);
    expect(api.sessions.monitor.get.query).toHaveBeenCalledWith({ enrollmentId: E1 });
  });
});

describe('an enrollment’s detail (FR-479, FR-451, FR-426; R-323 GAP-1, GAP-2, GAP-4)', () => {
  it('draws the parties, the count and mark, the sessions in their own zone and the panel’s, and the cases with their links, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/sessions?enrollment=${E2}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        expect(
          panel.getByText(
            t('admin.sessions.detail.heading', {
              student: t('admin.shared.party.deletedStudent'),
              teacher: SARA.displayName,
            }),
          ),
        ).toBeTruthy();
        expect(panel.getByText(t('admin.shared.noShows.count', { count: 2 }))).toBeTruthy();
        const first = sessionRow(panel, 1, t);
        expect(first.getByText(own(t, locale, closedDetail.sessions[0]!))).toBeTruthy();
        const zone = panelTimeZone();
        expect(
          first.getByText(
            t('admin.sessions.time.panel', {
              date: dayMonth(closedDetail.sessions[0]!.startsAt, locale, zone),
              time: timeOfDay(closedDetail.sessions[0]!.startsAt, locale, zone),
            }),
          ),
        ).toBeTruthy();
        expect(first.getByText(t('admin.status.session.done'))).toBeTruthy();
        const disputed = sessionRow(panel, 4, t);
        expect(
          disputed.getByText(
            t('admin.sessions.detail.underDispute', {
              outcome: t('admin.status.session.teacherNoShow'),
            }),
          ),
        ).toBeTruthy();
        expect(
          sessionRow(panel, 5, t).getByText(t('admin.sessions.detail.makeupFor', { n: 2 })),
        ).toBeTruthy();
        const cases = within(
          panel.getByRole('region', { name: t('admin.sessions.detail.casesTitle') }),
        );
        expect(cases.getByText(t('admin.sessions.caseReason.absenceTermination'))).toBeTruthy();
        expect(cases.getByText(t('admin.sessions.caseStatus.open'))).toBeTruthy();
        expect(
          cases
            .getAllByRole('link', { name: t('admin.sessions.detail.viewCase') })
            .map((link) => link.getAttribute('href')),
        ).toEqual([`/cases?case=${C1}`, `/cases?case=${C2}`]);
      },
    );
  });

  it('draws each remedy with its state, its deadlines, a pending counter-proposal with its answer deadline, and «booking refused, retried until …»', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/sessions?enrollment=${E2}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        const proposed = sessionRow(panel, 2, t);
        expect(
          proposed.getByText(
            t('admin.sessions.remedy.title', { kind: t('admin.sessions.remedy.kind.makeup') }),
          ),
        ).toBeTruthy();
        expect(proposed.getByText(t('admin.sessions.remedy.status.proposed'))).toBeTruthy();
        expect(
          proposed.getByText(
            t('admin.sessions.remedy.offeredAt', {
              when: at(t, locale, '2026-11-05T09:00:00.000Z'),
            }),
          ),
        ).toBeTruthy();
        expect(
          proposed.getByText(
            t('admin.sessions.remedy.choiceClosesAt', {
              when: at(t, locale, '2026-11-08T09:00:00.000Z'),
            }),
          ),
        ).toBeTruthy();
        expect(
          proposed.getByText(
            t('admin.sessions.remedy.proposal', { time: own(t, locale, proposal) }),
          ),
        ).toBeTruthy();
        expect(
          proposed.getByText(
            t('admin.sessions.remedy.bookingRetried', {
              when: at(t, locale, '2026-11-23T11:00:00.000Z'),
            }),
          ),
        ).toBeTruthy();
        const countered = sessionRow(panel, 3, t);
        expect(countered.getByText(t('admin.sessions.remedy.status.counterProposed'))).toBeTruthy();
        expect(
          countered.getByText(
            t('admin.sessions.remedy.counter', {
              time: own(t, locale, counter),
              when: at(t, locale, counter.proposedAt),
            }),
          ),
        ).toBeTruthy();
        expect(
          countered.getByText(
            t('admin.sessions.remedy.answerClosesAt', {
              when: at(t, locale, counter.answerClosesAt),
            }),
          ),
        ).toBeTruthy();
        expect(countered.queryByText(/retried|يُعاد/u)).toBeNull();
        const handed = sessionRow(panel, 4, t);
        expect(handed.getByText(t('admin.sessions.remedy.status.refundCase'))).toBeTruthy();
        expect(
          handed.getByText(
            t('admin.sessions.remedy.decidedAt', {
              when: at(t, locale, '2026-11-08T09:00:00.000Z'),
            }),
          ),
        ).toBeTruthy();
        expect(
          handed
            .getByRole('link', { name: t('admin.sessions.detail.viewCase') })
            .getAttribute('href'),
        ).toBe(`/cases?case=${C2}`);
      },
    );
  });

  it('tells the timeline newest first, as the server answered it, each session event with its number', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/sessions?enrollment=${E2}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        const timeline = within(
          panel.getByRole('region', { name: t('admin.sessions.detail.timelineTitle') }),
        );
        const items = timeline.getAllByRole('listitem');
        expect(items.map((item) => item.querySelector('strong')?.textContent)).toEqual([
          t('admin.sessions.event.kind.terminatedNoShow'),
          t('admin.sessions.event.withSession', {
            event: t('admin.sessions.event.kind.counterProposed'),
            n: 3,
          }),
          t('admin.sessions.event.withSession', {
            event: t('admin.sessions.event.kind.outcomeCorrected'),
            n: 1,
          }),
          t('admin.sessions.event.kind.cancelled', {
            reason: t('admin.payments.cancellationReasons.admin'),
          }),
          t('admin.sessions.event.kind.confirmed'),
        ]);
        expect(
          within(items[2]!).getByText(
            t('admin.sessions.event.outcomeChange', {
              before: t('admin.status.session.studentNoShow'),
              after: t('admin.status.session.done'),
            }),
          ),
        ).toBeTruthy();
        expect(within(items[0]!).getByText(at(t, locale, '2026-11-13T10:00:00.000Z'))).toBeTruthy();
      },
    );
  });

  it('links each session no longer scheduled to its telemetry, and a scheduled one to none', async () => {
    const { panel } = await openDetail();
    for (const [n, sessionId] of [
      [1, S1],
      [2, S2],
      [3, S3],
      [4, S4],
    ] as const) {
      expect(
        sessionRow(panel, n)
          .getByRole('link', { name: ar('admin.sessions.detail.telemetry') })
          .getAttribute('href'),
      ).toBe(`/review?session=${sessionId}`);
    }
    expect(
      sessionRow(panel, 5).queryByRole('link', { name: ar('admin.sessions.detail.telemetry') }),
    ).toBeNull();
  });

  it('shows payment status only as a link to the enrollment’s orders, and no amount anywhere (FR-479, R-MONEY-6)', async () => {
    const { panel, api, view } = await openDetail();
    expect(
      panel.getByRole('link', { name: ar('admin.sessions.detail.payments') }).getAttribute('href'),
    ).toBe(`/payments?enrollment=${E2}`);
    expect(view.container.textContent).not.toMatch(/ج\.م|EGP|piasters|قرش/u);
    expect(api.payments.list.query).not.toHaveBeenCalled();
    expect(api.payments.get.query).not.toHaveBeenCalled();
  });

  it('says the enrollment could not load in the page’s generic words', async () => {
    const api = fakeApi();
    api.sessions.monitor.get.query.mockRejectedValue(refusal('NOT_FOUND'));
    open(api, `/sessions?enrollment=${E2}`);
    const aside = within(
      await screen.findByRole('complementary', { name: ar('admin.sessions.detail.a11y') }),
    );
    expect(await aside.findByText(ar('admin.common.loadError.text'))).toBeTruthy();
  });
});

describe('the cancellation (FR-460)', () => {
  it('is offered only on a session the server says is cancellable', async () => {
    const { panel } = await openDetail();
    for (const n of [1, 2, 3, 4]) {
      expect(
        sessionRow(panel, n).queryByRole('button', { name: ar('admin.sessions.detail.cancel') }),
      ).toBeNull();
    }
    expect(
      sessionRow(panel, 5).getByRole('button', { name: ar('admin.sessions.detail.cancel') }),
    ).toBeTruthy();
  });

  async function cancelDialog(api = fakeApi()) {
    const { panel } = await openDetail(`/sessions?enrollment=${E2}`, api);
    fireEvent.click(
      sessionRow(panel, 5).getByRole('button', { name: ar('admin.sessions.detail.cancel') }),
    );
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.sessions.cancel.title', { n: 5 }) }),
    );
    return { api, dialog };
  }

  it('sends nothing until a reason is written', async () => {
    const { api, dialog } = await cancelDialog();
    const confirm = dialog.getByRole('button', { name: ar('admin.sessions.cancel.confirm') });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.cancel.reasonLabel')), {
      target: { value: '   ' },
    });
    fireEvent.click(confirm);
    expect(api.sessions.cancel.mutate).not.toHaveBeenCalled();
  });

  it('cancels the session with its reason, closes, and reads the enrollment again', async () => {
    const api = fakeApi();
    api.sessions.cancel.mutate.mockResolvedValue({
      sessionId: S5,
      status: 'cancelled_by_admin',
      caseId: C1,
    });
    const { dialog } = await cancelDialog(api);
    expect(dialog.getByText(ar('admin.sessions.cancel.effect'))).toBeTruthy();
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.cancel.reasonLabel')), {
      target: { value: ' طلب الطرفين ' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.sessions.cancel.confirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sessions.cancel.mutate).toHaveBeenCalledWith({
      sessionId: S5,
      reason: 'طلب الطرفين',
    });
    await waitFor(() => expect(api.sessions.monitor.get.query).toHaveBeenCalledTimes(2));
  });

  it('says each refusal in plain words, in both languages, and any other failure in the generic words', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.sessions.cancel.mutate
          .mockRejectedValueOnce(refusal('SESSION_NOT_SCHEDULED'))
          .mockRejectedValueOnce(refusal('NOT_FOUND'))
          .mockRejectedValueOnce(refusal('INTERNAL'));
        return open(api, `/sessions?enrollment=${E2}`);
      },
      async (t) => {
        const panel = await panelOf(t);
        fireEvent.click(
          sessionRow(panel, 5, t).getByRole('button', { name: t('admin.sessions.detail.cancel') }),
        );
        const dialog = within(await screen.findByRole('dialog'));
        fireEvent.change(dialog.getByLabelText(t('admin.sessions.cancel.reasonLabel')), {
          target: { value: 'سبب' },
        });
        for (const words of [
          'admin.sessions.cancel.refused.notScheduled',
          'admin.sessions.cancel.refused.notFound',
          'admin.dialogs.submitError',
        ] as const) {
          fireEvent.click(dialog.getByRole('button', { name: t('admin.sessions.cancel.confirm') }));
          expect(await dialog.findByText(t(words))).toBeTruthy();
        }
      },
    );
  });
});

describe('the restore (FR-454; Q1 (a))', () => {
  it('is offered only while the server answers `restorableUntil`, saying the slot is held until `slotHeldUntil`', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/sessions?enrollment=${E2}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        expect(
          panel.getByRole('button', { name: t('admin.sessions.detail.restore') }),
        ).toBeTruthy();
        expect(
          panel.getByText(
            t('admin.sessions.detail.restorableUntil', { when: at(t, locale, SLOT_HELD_UNTIL) }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('is not offered on an enrollment without `restorableUntil`', async () => {
    const { panel } = await openDetail(`/sessions?enrollment=${E1}`);
    expect(panel.queryByRole('button', { name: ar('admin.sessions.detail.restore') })).toBeNull();
  });

  async function restoreDialog(api = fakeApi()) {
    const { panel } = await openDetail(`/sessions?enrollment=${E2}`, api);
    fireEvent.click(panel.getByRole('button', { name: ar('admin.sessions.detail.restore') }));
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.sessions.restore.title') }),
    );
    return { api, dialog };
  }

  it('sends nothing until a reason is written', async () => {
    const { api, dialog } = await restoreDialog();
    const confirm = dialog.getByRole('button', { name: ar('admin.sessions.restore.confirm') });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    expect(api.sessions.restore.mutate).not.toHaveBeenCalled();
  });

  it('restores with its reason and the key minted when the dialog opened, the same key on a retry', async () => {
    const api = fakeApi();
    api.sessions.restore.mutate.mockRejectedValueOnce(refusal('INTERNAL')).mockResolvedValue({
      enrollmentId: E2,
      status: 'confirmed',
      sessionsCreated: [],
      remediesOffered: 0,
      caseId: C1,
    });
    const { dialog } = await restoreDialog(api);
    expect(dialog.getByText(ar('admin.sessions.restore.effect'))).toBeTruthy();
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.restore.reasonLabel')), {
      target: { value: ' خطأ في الحكم ' },
    });
    const confirm = dialog.getByRole('button', { name: ar('admin.sessions.restore.confirm') });
    fireEvent.click(confirm);
    expect(await dialog.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [first, second] = api.sessions.restore.mutate.mock.calls.map(([input]) => input);
    expect(first).toEqual({
      enrollmentId: E2,
      reason: 'خطأ في الحكم',
      idempotencyKey: expect.stringMatching(/^[\w-]{16,128}$/u),
    });
    expect(second).toEqual(first);
    await waitFor(() => expect(api.sessions.monitor.get.query).toHaveBeenCalledTimes(2));
  });

  it('says the nine causes, `no_free_week`, a reused key and a missing enrollment in plain words, in both languages, and any other failure in the generic words', async () => {
    const refusals = [
      [refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'not_restorable' }]), 'notRestorable'],
      [refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'window_closed' }]), 'windowClosed'],
      [refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'case_closed' }]), 'caseClosed'],
      [
        refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'party_restricted' }]),
        'partyRestricted',
      ],
      [refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'slot_inactive' }]), 'slotInactive'],
      [refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'slot_changed' }]), 'slotChanged'],
      [refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'slot_taken' }]), 'slotTaken'],
      [refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'time_taken' }]), 'timeTaken'],
      // B42b, T075 (N11): T073's ninth cause.
      [refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'refunded' }]), 'refunded'],
      [refusal('CONFLICT', [{ path: 'cause', code: 'no_free_week' }]), 'noFreeWeek'],
      [refusal('NOT_FOUND'), 'notFound'],
    ] as const;
    await inBothLocales(
      () => {
        const api = fakeApi();
        for (const [error] of refusals) api.sessions.restore.mutate.mockRejectedValueOnce(error);
        api.sessions.restore.mutate
          .mockRejectedValueOnce(refusal('CONFLICT'))
          .mockRejectedValueOnce(refusal('INTERNAL'));
        return open(api, `/sessions?enrollment=${E2}`);
      },
      async (t) => {
        const panel = await panelOf(t);
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.restore') }));
        const dialog = within(await screen.findByRole('dialog'));
        fireEvent.change(dialog.getByLabelText(t('admin.sessions.restore.reasonLabel')), {
          target: { value: 'سبب' },
        });
        const confirm = dialog.getByRole('button', { name: t('admin.sessions.restore.confirm') });
        for (const [, words] of refusals) {
          fireEvent.click(confirm);
          expect(
            await dialog.findByText(t(`admin.sessions.restore.refused.${words}` as MessageKey)),
          ).toBeTruthy();
        }
        fireEvent.click(confirm);
        expect(await dialog.findByText(t('admin.shared.keyReused'))).toBeTruthy();
        fireEvent.click(confirm);
        expect(await dialog.findByText(t('admin.dialogs.submitError'))).toBeTruthy();
      },
    );
  });

  // Q1 (a), the owner (the note under T047): nothing on the page says a ban or a closing is final
  // or never restorable; `not_restorable` says only that this closing cannot be restored.
  it('never says a closing is final or never restorable, in either language', () => {
    const final = /نهائ|أبد|لا يُرفع|لا يُستعاد أبدًا|final|never|permanent/iu;
    for (const catalogue of [arCatalogue, enCatalogue]) {
      const sessions = catalogue.admin.sessions;
      for (const words of [
        ...Object.values(sessions.restore.refused),
        sessions.restore.effect,
        sessions.restore.until,
        sessions.restore.released,
        sessions.detail.restorableUntil,
        sessions.detail.slotReleased,
        sessions.lede,
      ]) {
        expect(words).not.toMatch(final);
      }
    }
  });
});

// B42b, T075 of specs/004-sessions (FR-503, FR-454 as amended; SRS FR-CANCEL-9, DEC-69; N11): the
// hold and the restore at any time. `restorableUntil` is the hold's end and may be past while the
// restore stays possible, so the button never hides on it; the words read T070's `slotHeldUntil`, or
// say the slot was released at `slotReleasedAt`.
describe('T075: the hold and the restore at any time (N11)', () => {
  const PAST = '2026-10-01T10:00:00.000Z';
  const RELEASED_AT = '2026-11-15T09:00:00.000Z';
  const withEnrollment = (more: Record<string, unknown>) => {
    const api = fakeApi();
    const { slotHeldUntil: _held, ...rest } = closedDetail.enrollment;
    api.sessions.monitor.get.query.mockResolvedValue({
      ...closedDetail,
      enrollment: { ...rest, ...more },
    });
    return api;
  };

  it('offers the restore on a past `restorableUntil`, in both languages', async () => {
    await inBothLocales(
      () =>
        open(
          withEnrollment({ restorableUntil: PAST, slotHeldUntil: PAST }),
          `/sessions?enrollment=${E2}`,
        ),
      async (t, locale) => {
        const panel = await panelOf(t);
        expect(
          panel.getByRole('button', { name: t('admin.sessions.detail.restore') }),
        ).toBeTruthy();
        expect(
          panel.getByText(
            t('admin.sessions.detail.restorableUntil', { when: at(t, locale, PAST) }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('says a released slot and its instant, offering the restore and no release, in both languages', async () => {
    await inBothLocales(
      () =>
        open(
          withEnrollment({ restorableUntil: RESTORABLE_UNTIL, slotReleasedAt: RELEASED_AT }),
          `/sessions?enrollment=${E2}`,
        ),
      async (t, locale) => {
        const panel = await panelOf(t);
        expect(
          panel.getByText(
            t('admin.sessions.detail.slotReleased', { when: at(t, locale, RELEASED_AT) }),
          ),
        ).toBeTruthy();
        expect(
          panel.queryByRole('button', { name: t('admin.sessions.detail.release') }),
        ).toBeNull();
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.restore') }));
        const dialog = within(
          await screen.findByRole('dialog', { name: t('admin.sessions.restore.title') }),
        );
        expect(
          dialog.getByText(
            t('admin.sessions.restore.released', { when: at(t, locale, RELEASED_AT) }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('the restore dialog says the slot is held until `slotHeldUntil`, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/sessions?enrollment=${E2}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.restore') }));
        const dialog = within(
          await screen.findByRole('dialog', { name: t('admin.sessions.restore.title') }),
        );
        expect(
          dialog.getByText(
            t('admin.sessions.restore.until', { when: at(t, locale, SLOT_HELD_UNTIL) }),
          ),
        ).toBeTruthy();
      },
    );
  });
});

// B42b, T075 of specs/004-sessions (FR-503; SRS FR-CANCEL-9, DEC-69; T070's `enrollments.releaseSlot`):
// «تحرير الموعد» on a held slot in the enrollment's detail, shown only while the server answers
// `slotHeldUntil`; its dialog says until when the slot is held and that a release cannot be undone
// (a restore after it succeeds only while the slot stays free); a mandatory reason; the key minted
// when the dialog opens, the same on a retry; `slot_not_held` and the other refusals in plain words.
describe('T075: the release of a held slot (FR-503)', () => {
  async function releaseDialog(api = fakeApi()) {
    const { panel } = await openDetail(`/sessions?enrollment=${E2}`, api);
    fireEvent.click(panel.getByRole('button', { name: ar('admin.sessions.detail.release') }));
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.sessions.release.title') }),
    );
    return { api, dialog };
  }

  it('is offered only while the server answers `slotHeldUntil`', async () => {
    const held = await openDetail(`/sessions?enrollment=${E2}`);
    expect(
      held.panel.getByRole('button', { name: ar('admin.sessions.detail.release') }),
    ).toBeTruthy();
    held.view.unmount();
    const confirmed = await openDetail(`/sessions?enrollment=${E1}`);
    expect(
      confirmed.panel.queryByRole('button', { name: ar('admin.sessions.detail.release') }),
    ).toBeNull();
  });

  it('says until when the slot is held and that the release cannot be undone, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/sessions?enrollment=${E2}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.release') }));
        const dialog = within(
          await screen.findByRole('dialog', { name: t('admin.sessions.release.title') }),
        );
        expect(
          dialog.getByText(
            t('admin.sessions.release.until', { when: at(t, locale, SLOT_HELD_UNTIL) }),
          ),
        ).toBeTruthy();
        const effect = dialog.getByText(t('admin.sessions.release.effect'));
        expect(effect.textContent).toMatch(
          locale === 'ar' ? /لا يمكن التراجع عن التحرير/u : /cannot be undone/u,
        );
        expect(effect.textContent).toMatch(locale === 'ar' ? /خاليًا/u : /stays free/u);
      },
    );
  });

  it('sends nothing until a reason is written', async () => {
    const { api, dialog } = await releaseDialog();
    const confirm = dialog.getByRole('button', { name: ar('admin.sessions.release.confirm') });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    expect(api.enrollments.releaseSlot.mutate).not.toHaveBeenCalled();
  });

  it('releases with its reason and the key minted when the dialog opened, the same key on a retry, then reads the enrollment again', async () => {
    const api = fakeApi();
    api.enrollments.releaseSlot.mutate
      .mockRejectedValueOnce(refusal('INTERNAL'))
      .mockResolvedValue({ enrollmentId: E2, slotReleasedAt: '2026-11-15T09:00:00.000Z' });
    const { dialog } = await releaseDialog(api);
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.release.reasonLabel')), {
      target: { value: ' طلب الطالب الانتقال ' },
    });
    const confirm = dialog.getByRole('button', { name: ar('admin.sessions.release.confirm') });
    fireEvent.click(confirm);
    expect(await dialog.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [first, second] = api.enrollments.releaseSlot.mutate.mock.calls.map(([input]) => input);
    expect(first).toEqual({
      enrollmentId: E2,
      reason: 'طلب الطالب الانتقال',
      idempotencyKey: expect.stringMatching(/^[\w-]{16,128}$/u),
    });
    expect(second).toEqual(first);
    await waitFor(() => expect(api.sessions.monitor.get.query).toHaveBeenCalledTimes(2));
  });

  it('says `slot_not_held`, a missing enrollment, a reused key and RATE_LIMITED in plain words, in both languages, and any other failure in the generic words', async () => {
    const refusals = [
      [
        refusal('CONFLICT', [{ path: 'cause', code: 'slot_not_held' }]),
        'admin.sessions.release.refused.slotNotHeld',
      ],
      [refusal('NOT_FOUND'), 'admin.sessions.release.refused.notFound'],
      [refusal('CONFLICT'), 'admin.shared.keyReused'],
      [refusal('INTERNAL'), 'admin.dialogs.submitError'],
    ] as const;
    await inBothLocales(
      () => {
        const api = fakeApi();
        for (const [error] of refusals)
          api.enrollments.releaseSlot.mutate.mockRejectedValueOnce(error);
        api.enrollments.releaseSlot.mutate.mockRejectedValueOnce(
          refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
        );
        return open(api, `/sessions?enrollment=${E2}`);
      },
      async (t) => {
        const panel = await panelOf(t);
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.release') }));
        const dialog = within(await screen.findByRole('dialog'));
        fireEvent.change(dialog.getByLabelText(t('admin.sessions.release.reasonLabel')), {
          target: { value: 'سبب' },
        });
        const confirm = dialog.getByRole('button', { name: t('admin.sessions.release.confirm') });
        for (const [, words] of refusals) {
          fireEvent.click(confirm);
          expect(await dialog.findByText(t(words))).toBeTruthy();
        }
        fireEvent.click(confirm);
        expect(await dialog.findByText(t('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
      },
    );
  });
});
describe('the correction (FR-439)', () => {
  it('is offered only on a session the server says is correctable', async () => {
    const { panel } = await openDetail();
    expect(
      sessionRow(panel, 1).getByRole('button', { name: ar('admin.sessions.detail.correct') }),
    ).toBeTruthy();
    for (const n of [2, 3, 4, 5]) {
      expect(
        sessionRow(panel, n).queryByRole('button', { name: ar('admin.sessions.detail.correct') }),
      ).toBeNull();
    }
  });

  it('opens the correction dialog for that session, and reads the enrollment again once corrected', async () => {
    const api = fakeApi();
    api.sessions.review.revise.mutate.mockResolvedValue({
      sessionId: S1,
      sessionStatus: 'student_no_show',
      previousStatus: 'done',
    });
    const { panel } = await openDetail(`/sessions?enrollment=${E2}`, api);
    fireEvent.click(
      sessionRow(panel, 1).getByRole('button', { name: ar('admin.sessions.detail.correct') }),
    );
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.shared.correction.title') }),
    );
    fireEvent.click(dialog.getByText(ar('admin.status.session.studentNoShow')));
    fireEvent.change(dialog.getByLabelText(ar('admin.shared.correction.reasonLabel')), {
      target: { value: 'خطأ' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.shared.correction.confirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sessions.review.revise.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: S1, outcome: 'student_no_show', reason: 'خطأ' }),
    );
    await waitFor(() => expect(api.sessions.monitor.get.query).toHaveBeenCalledTimes(2));
  });
});

describe('the manual case (FR-493)', () => {
  it('opens on the enrollment pre-filled with it, and reads the enrollment again once opened', async () => {
    const api = fakeApi();
    api.cases.openManual.mutate.mockResolvedValue({
      caseId: C1,
      enrollmentId: E2,
      party: 'teacher',
      status: 'open',
      joined: false,
    });
    const { panel } = await openDetail(`/sessions?enrollment=${E2}`, api);
    fireEvent.click(panel.getByRole('button', { name: ar('admin.sessions.detail.openCase') }));
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.shared.manualCase.title') }),
    );
    expect(dialog.queryByLabelText(ar('admin.shared.manualCase.enrollmentLabel'))).toBeNull();
    fireEvent.click(dialog.getByText(ar('admin.shared.manualCase.partyTeacher')));
    fireEvent.change(dialog.getByLabelText(ar('admin.shared.manualCase.reasonLabel')), {
      target: { value: 'تأخر' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.shared.manualCase.confirm') }));
    expect(await dialog.findByText(ar('admin.shared.manualCase.opened'))).toBeTruthy();
    const input = api.cases.openManual.mutate.mock.calls[0]?.[0];
    expect(input).toEqual({
      enrollmentId: E2,
      party: 'teacher',
      reason: 'تأخر',
      idempotencyKey: expect.any(String),
    });
    await waitFor(() => expect(api.sessions.monitor.get.query).toHaveBeenCalledTimes(2));
  });

  it('is offered beside each open remedy only, handing that remedy to the student’s case', async () => {
    const api = fakeApi();
    api.cases.openManual.mutate.mockResolvedValue({
      caseId: C1,
      enrollmentId: E2,
      party: 'student',
      status: 'open',
      joined: true,
      handedRemedy: { remedyId: R2, sessionId: S3 },
    });
    const { panel } = await openDetail(`/sessions?enrollment=${E2}`, api);
    const hand = ar('admin.sessions.remedy.handToCase');
    expect(sessionRow(panel, 2).getByRole('button', { name: hand })).toBeTruthy();
    expect(sessionRow(panel, 4).queryByRole('button', { name: hand })).toBeNull();
    fireEvent.click(sessionRow(panel, 3).getByRole('button', { name: hand }));
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.shared.manualCase.title') }),
    );
    expect(dialog.getByText(ar('admin.shared.manualCase.remedyParty'))).toBeTruthy();
    fireEvent.change(dialog.getByLabelText(ar('admin.shared.manualCase.reasonLabel')), {
      target: { value: 'لا رد' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.shared.manualCase.confirm') }));
    expect(await dialog.findByText(ar('admin.shared.manualCase.joined'))).toBeTruthy();
    expect(api.cases.openManual.mutate).toHaveBeenCalledWith({
      enrollmentId: E2,
      party: 'student',
      reason: 'لا رد',
      remedyId: R2,
      idempotencyKey: expect.any(String),
    });
  });
});

describe('the second factor', () => {
  it('sends a session whose second factor is not verified to /mfa, reading nothing', async () => {
    const api = fakeApi();
    renderApp({ at: '/sessions', session: { token: 't', step: 'mfa' }, api });
    await waitFor(() => expect(currentPath()).toBe('/mfa'));
    expect(api.sessions.monitor.list.query).not.toHaveBeenCalled();
  });
});

describe('T058: RATE_LIMITED on /sessions', () => {
  const limited = (seconds?: string) =>
    refusal('RATE_LIMITED', seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }]);

  it('the monitor’s search says when to try again', async () => {
    const api = fakeApi();
    api.sessions.monitor.list.query.mockRejectedValue(limited('61'));
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('an enrollment’s read says to wait a little when no time is given', async () => {
    const api = fakeApi();
    api.sessions.monitor.get.query.mockRejectedValue(limited());
    open(api, `/sessions?enrollment=${E2}`);
    const aside = within(
      await screen.findByRole('complementary', { name: ar('admin.sessions.detail.a11y') }),
    );
    expect(await aside.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(aside.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('the cancellation says when to try again', async () => {
    const api = fakeApi();
    api.sessions.cancel.mutate.mockRejectedValue(limited('120'));
    const { panel } = await openDetail(`/sessions?enrollment=${E2}`, api);
    fireEvent.click(
      sessionRow(panel, 5).getByRole('button', { name: ar('admin.sessions.detail.cancel') }),
    );
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.sessions.cancel.title', { n: 5 }) }),
    );
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.cancel.reasonLabel')), {
      target: { value: 'سبب' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.sessions.cancel.confirm') }));
    expect(await dialog.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(dialog.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });

  it('the restore says when to try again (rate_limit_enrollment_restore)', async () => {
    const api = fakeApi();
    api.sessions.restore.mutate.mockRejectedValue(limited('31'));
    const { panel } = await openDetail(`/sessions?enrollment=${E2}`, api);
    fireEvent.click(panel.getByRole('button', { name: ar('admin.sessions.detail.restore') }));
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.sessions.restore.title') }),
    );
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.restore.reasonLabel')), {
      target: { value: 'سبب' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.sessions.restore.confirm') }));
    expect(await dialog.findByText(ar('admin.common.rateLimitedIn', { count: 1 }))).toBeTruthy();
    expect(dialog.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });
});

// B42a, Q-B2 (a) (the owner, 2026-11-13; the review session's wording): T071 made a teacher's
// suspension pause the enrollment, with its own `teacher_suspended` case, so `teacher_ended` and a
// `cancelled` `teacher_suspended` now mean only a ban, a revocation or a deletion; T069 added two
// timeline kinds, a held slot's release and a hold's end, told in the timeline's past tense.
describe('B42a Q-B2 (a): a teacher’s suspension, a teacher’s end and a held slot, in words', () => {
  const both = (key: MessageKey | undefined) => ({
    ar: key === undefined ? undefined : translate('ar', key),
    en: key === undefined ? undefined : translate('en', key),
  });
  const occurredAt = '2026-11-13T10:00:00.000Z';
  const title = (event: MonitoredEvent, locale: 'ar' | 'en') =>
    eventWords(
      event,
      new Map(),
      (key, values) => translate(locale, key, values),
      locale,
      panelTimeZone(),
    ).title;

  it('names a `teacher_suspended` case as the teacher’s suspension, the enrollment paused', () => {
    expect(both(CASE_REASON.teacher_suspended)).toEqual({
      ar: 'إيقاف المعلم (الاشتراك متوقف مؤقتًا)',
      en: 'The teacher suspended (the enrollment paused)',
    });
  });

  it('names a `teacher_ended` case as a ban, a revocation or a deletion, never a suspension', () => {
    expect(both(CASE_REASON.teacher_ended)).toEqual({
      ar: 'حظر المعلم أو سحب اعتماده أو حذف حسابه',
      en: 'The teacher banned, their approval revoked or their account deleted',
    });
  });

  it('tells a held slot’s release in the past tense', () => {
    const event = { source: 'enrollment', kind: 'slot_released', occurredAt } as const;
    expect({
      ar: arCatalogue.admin.sessions.event.kind.slotReleased,
      en: enCatalogue.admin.sessions.event.kind.slotReleased,
    }).toEqual({ ar: 'حُرّر موعد الاشتراك', en: "The enrollment's slot was released" });
    expect({ ar: title(event, 'ar'), en: title(event, 'en') }).toEqual({
      ar: 'حُرّر موعد الاشتراك',
      en: "The enrollment's slot was released",
    });
  });

  it('tells a hold’s end in the past tense', () => {
    const event = { source: 'enrollment', kind: 'slot_hold_ended', occurredAt } as const;
    expect({
      ar: arCatalogue.admin.sessions.event.kind.slotHoldEnded,
      en: enCatalogue.admin.sessions.event.kind.slotHoldEnded,
    }).toEqual({ ar: 'انتهى حجز موعد الاشتراك', en: "The hold on the enrollment's slot ended" });
    expect({ ar: title(event, 'ar'), en: title(event, 'en') }).toEqual({
      ar: 'انتهى حجز موعد الاشتراك',
      en: "The hold on the enrollment's slot ended",
    });
  });

  it('names a cancellation `teacher_suspended` as the teacher’s suspension, ban or revocation', () => {
    const event = {
      source: 'enrollment',
      kind: 'cancelled',
      cancellationReason: 'teacher_suspended',
      occurredAt,
    } as const;
    for (const [locale, reason] of [
      ['ar', 'إيقاف المعلم أو حظره أو سحب اعتماده'],
      ['en', 'Teacher suspended, banned or approval revoked'],
    ] as const) {
      expect(title(event, locale)).toBe(
        translate(locale, 'admin.sessions.event.kind.cancelled', { reason }),
      );
    }
  });
});

// B42c, T083 of specs/004-sessions (FR-513, FR-514; SRS FR-CANCEL-10, DEC-68; the note under T083):
// «إنهاء الاشتراك» beside restore and cancel on a `confirmed` enrollment only (N9); its dialog says
// what the end does and that a release cannot be undone, asks for the parties' reason (mandatory)
// and an internal note (optional), offers the slot's choice with the monitor's
// `enrollmentRestoreWindowDays` (Q-O1 (a)), held by default, and keeps the key minted when it opened
// for its retry; `complaint_open` in plain words with a link to the complaint (Q-R6 (a)), every
// other failure through `errorMessageKey`.
describe('T083: an administrator’s direct end of an enrollment (FR-514; SRS FR-CANCEL-10)', () => {
  const withStatus = (status: string) => {
    const api = fakeApi();
    api.sessions.monitor.get.query.mockResolvedValue({
      ...confirmedDetail,
      enrollment: { ...confirmedDetail.enrollment, status },
    });
    return api;
  };

  async function endDialog(api = fakeApi()) {
    const { panel } = await openDetail(`/sessions?enrollment=${E1}`, api);
    fireEvent.click(panel.getByRole('button', { name: ar('admin.sessions.detail.end') }));
    const dialog = within(
      await screen.findByRole('dialog', { name: ar('admin.sessions.end.title') }),
    );
    return { api, dialog };
  }

  it('offers «إنهاء الاشتراك» on a confirmed enrollment, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/sessions?enrollment=${E1}`),
      async (t) => {
        const panel = await panelOf(t);
        expect(panel.getByRole('button', { name: t('admin.sessions.detail.end') })).toBeTruthy();
      },
    );
  });

  it('offers no end on an enrollment that is not confirmed (N9)', async () => {
    for (const status of ['pending_payment', 'completed', 'terminated_no_show', 'cancelled']) {
      const { view, panel } = await openDetail(`/sessions?enrollment=${E1}`, withStatus(status));
      expect(panel.queryByRole('button', { name: ar('admin.sessions.detail.end') })).toBeNull();
      view.unmount();
    }
  });

  it('says what the end does, its two texts, the slot’s choice with the monitor’s days held by default, and that a release cannot be undone, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/sessions?enrollment=${E1}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.end') }));
        const dialog = within(
          await screen.findByRole('dialog', { name: t('admin.sessions.end.title') }),
        );
        const effect = dialog.getByText(t('admin.sessions.end.effect')).textContent ?? '';
        for (const part of locale === 'ar'
          ? [/الجلسات المتبقية/u, /قضية/u, /في أي وقت/u, /حرّر الموعد الآن/u, /خاليًا/u]
          : [
              /remaining sessions/u,
              /case/u,
              /at any time/u,
              /Release the slot now/u,
              /still free/u,
            ]) {
          expect(effect).toMatch(part);
        }
        expect(dialog.getByText(t('admin.sessions.end.releaseFinal')).textContent).toMatch(
          locale === 'ar' ? /لا يمكن التراجع/u : /cannot be undone/u,
        );
        expect(dialog.getByLabelText(t('admin.sessions.end.reasonLabel'))).toBeTruthy();
        expect(dialog.getByLabelText(t('admin.sessions.end.noteLabel'))).toBeTruthy();
        const hold = dialog.getByRole('radio', {
          name: t('admin.sessions.end.slot.hold', { days: RESTORE_WINDOW_DAYS }),
        }) as HTMLInputElement;
        const release = dialog.getByRole('radio', {
          name: t('admin.sessions.end.slot.release'),
        }) as HTMLInputElement;
        expect([hold.checked, release.checked]).toEqual([true, false]);
      },
    );
  });

  it('holds the line’s words', () => {
    const { detail, end } = arCatalogue.admin.sessions;
    expect({
      button: detail.end,
      reason: end.reasonLabel,
      note: end.noteLabel,
      release: end.slot.release,
    }).toEqual({
      button: 'إنهاء الاشتراك',
      reason: 'السبب (يظهر للطالب والمعلم)',
      note: 'ملاحظة داخلية (للإدارة فقط)',
      release: 'حرّر الموعد الآن',
    });
  });

  // «احجز الموعد {days} يومًا» for the default 14, the number agreeing with any other count of
  // days the setting holds (T075's `{days, plural, …}` precedent, the ban dialogs' words).
  it('says «احجز الموعد {days} يومًا», the days agreeing with their number, in both languages', () => {
    // The catalogue isolates each value it interpolates (FSI … PDI); the words are read without them.
    const hold = (locale: 'ar' | 'en', days: number) =>
      translate(locale, 'admin.sessions.end.slot.hold', { days }).replace(/[⁦-⁩]/gu, '');
    expect(hold('ar', 14)).toMatch(/^احجز الموعد \S+ يومًا$/u);
    expect(hold('ar', 7)).toMatch(/^احجز الموعد \S+ أيام$/u);
    expect(hold('ar', 2)).toBe('احجز الموعد يومين');
    expect(hold('ar', 1)).toBe('احجز الموعد يومًا واحدًا');
    expect(hold('en', 14)).toBe('Hold the slot for 14 days');
    expect(hold('en', 1)).toBe('Hold the slot for 1 day');
  });

  it('never says the end is final or never restorable, in either language', () => {
    const final = /نهائ|أبد|final|never|permanent/iu;
    for (const catalogue of [arCatalogue, enCatalogue]) {
      const { end } = catalogue.admin.sessions;
      for (const words of [end.effect, end.releaseFinal, end.slot.hold, end.slot.release]) {
        expect(words).not.toMatch(final);
      }
    }
  });

  it('sends nothing until the parties’ reason is written; the internal note alone does not', async () => {
    const { api, dialog } = await endDialog();
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.end.noteLabel')), {
      target: { value: 'ملاحظة للإدارة' },
    });
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.end.reasonLabel')), {
      target: { value: '   ' },
    });
    const confirm = dialog.getByRole('button', { name: ar('admin.sessions.end.confirm') });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    expect(api.sessions.endEnrollment.mutate).not.toHaveBeenCalled();
  });

  it('ends with the trimmed reason, no note when none is written, the slot held, and the key minted when the dialog opened, the same key on a retry; then reads the enrollment again', async () => {
    const api = fakeApi();
    api.sessions.endEnrollment.mutate
      .mockRejectedValueOnce(refusal('INTERNAL'))
      .mockResolvedValue({ enrollmentId: E1, caseId: C1, slot: 'hold', cancelledSessions: 5 });
    const { dialog } = await endDialog(api);
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.end.reasonLabel')), {
      target: { value: ' طلب الطالب إنهاء الاشتراك ' },
    });
    const confirm = dialog.getByRole('button', { name: ar('admin.sessions.end.confirm') });
    fireEvent.click(confirm);
    expect(await dialog.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [first, second] = api.sessions.endEnrollment.mutate.mock.calls.map(([input]) => input);
    expect(first).toStrictEqual({
      enrollmentId: E1,
      partyReason: 'طلب الطالب إنهاء الاشتراك',
      slot: 'hold',
      idempotencyKey: expect.stringMatching(/^[\w-]{16,128}$/u),
    });
    expect(second).toStrictEqual(first);
    await waitFor(() => expect(api.sessions.monitor.get.query).toHaveBeenCalledTimes(2));
  });

  it('ends with «حرّر الموعد الآن» and the internal note, trimmed', async () => {
    const api = fakeApi();
    api.sessions.endEnrollment.mutate.mockResolvedValue({
      enrollmentId: E1,
      caseId: C1,
      slot: 'release',
      cancelledSessions: 5,
    });
    const { dialog } = await endDialog(api);
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.end.reasonLabel')), {
      target: { value: 'انتقال الطالب' },
    });
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.end.noteLabel')), {
      target: { value: ' اتصل الطالب بالدعم ' },
    });
    fireEvent.click(dialog.getByRole('radio', { name: ar('admin.sessions.end.slot.release') }));
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.sessions.end.confirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.sessions.endEnrollment.mutate).toHaveBeenCalledWith({
      enrollmentId: E1,
      partyReason: 'انتقال الطالب',
      internalNote: 'اتصل الطالب بالدعم',
      slot: 'release',
      idempotencyKey: expect.stringMatching(/^[\w-]{16,128}$/u),
    });
  });

  it('says `complaint_open` in plain words with a link to the complaint, in both languages', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.sessions.endEnrollment.mutate.mockRejectedValue(
          refusal('CONFLICT', [
            { path: 'cause', code: 'complaint_open' },
            { path: 'caseId', code: C2 },
          ]),
        );
        return open(api, `/sessions?enrollment=${E1}`);
      },
      async (t) => {
        const panel = await panelOf(t);
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.end') }));
        const dialog = within(await screen.findByRole('dialog'));
        fireEvent.change(dialog.getByLabelText(t('admin.sessions.end.reasonLabel')), {
          target: { value: 'سبب' },
        });
        fireEvent.click(dialog.getByRole('button', { name: t('admin.sessions.end.confirm') }));
        expect(await dialog.findByText(t('admin.sessions.end.refused.complaintOpen'))).toBeTruthy();
        const link = dialog.getByRole('link', {
          name: t('admin.sessions.end.refused.openComplaint'),
        });
        expect(link.getAttribute('href')).toBe(`/cases?case=${C2}`);
      },
    );
  });

  it('the complaint’s link opens it on /cases', async () => {
    const api = fakeApi();
    api.sessions.endEnrollment.mutate.mockRejectedValue(
      refusal('CONFLICT', [
        { path: 'cause', code: 'complaint_open' },
        { path: 'caseId', code: C2 },
      ]),
    );
    const { dialog } = await endDialog(api);
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.end.reasonLabel')), {
      target: { value: 'سبب' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.sessions.end.confirm') }));
    fireEvent.click(
      await dialog.findByRole('link', { name: ar('admin.sessions.end.refused.openComplaint') }),
    );
    await waitFor(() => expect(currentPath()).toBe(`/cases?case=${C2}`));
  });

  it('says `complaint_open` naming no complaint in the same words, with no link', async () => {
    const api = fakeApi();
    api.sessions.endEnrollment.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'cause', code: 'complaint_open' }]),
    );
    const { dialog } = await endDialog(api);
    fireEvent.change(dialog.getByLabelText(ar('admin.sessions.end.reasonLabel')), {
      target: { value: 'سبب' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.sessions.end.confirm') }));
    expect(await dialog.findByText(ar('admin.sessions.end.refused.complaintOpen'))).toBeTruthy();
    expect(
      dialog.queryByRole('link', { name: ar('admin.sessions.end.refused.openComplaint') }),
    ).toBeNull();
  });

  it('says `enrollment_not_confirmed`, NOT_FOUND, a reused key and any other failure through `errorMessageKey`, RATE_LIMITED with when to try again, in both languages', async () => {
    const refusals = [
      refusal('CONFLICT', [{ path: 'cause', code: 'enrollment_not_confirmed' }]),
      refusal('NOT_FOUND'),
      refusal('CONFLICT'),
      refusal('INTERNAL'),
    ];
    await inBothLocales(
      () => {
        const api = fakeApi();
        for (const error of refusals)
          api.sessions.endEnrollment.mutate.mockRejectedValueOnce(error);
        api.sessions.endEnrollment.mutate.mockRejectedValueOnce(
          refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
        );
        return open(api, `/sessions?enrollment=${E1}`);
      },
      async (t) => {
        const panel = await panelOf(t);
        fireEvent.click(panel.getByRole('button', { name: t('admin.sessions.detail.end') }));
        const dialog = within(await screen.findByRole('dialog'));
        fireEvent.change(dialog.getByLabelText(t('admin.sessions.end.reasonLabel')), {
          target: { value: 'سبب' },
        });
        const confirm = dialog.getByRole('button', { name: t('admin.sessions.end.confirm') });
        for (const _refused of refusals) {
          fireEvent.click(confirm);
          expect(await dialog.findByText(t('admin.dialogs.submitError'))).toBeTruthy();
          expect(dialog.queryByText(t('admin.sessions.end.refused.complaintOpen'))).toBeNull();
        }
        fireEvent.click(confirm);
        expect(await dialog.findByText(t('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
      },
    );
  });
});

// B42c, T083 (N9; T073's `restorableUntil`): an enrollment an administrator ended directly is
// `cancelled` with an `admin_ended` case, and the monitor answers `restorableUntil` for it, so the
// restore stays offered inside the hold and after it; its case is named in plain words.
describe('T083: the restore of an enrollment an administrator ended (T073; N9)', () => {
  const PAST = '2026-10-01T10:00:00.000Z';
  const ended = (more: Record<string, unknown>) => {
    const api = fakeApi();
    const { slotHeldUntil: _held, ...rest } = closedDetail.enrollment;
    api.sessions.monitor.get.query.mockResolvedValue({
      ...closedDetail,
      enrollment: { ...rest, status: 'cancelled', ...more },
      cases: [{ caseId: C1, reason: 'admin_ended', status: 'open' }],
    });
    return api;
  };

  it('offers the restore inside the hold, saying the slot is held until `slotHeldUntil`, and names the `admin_ended` case, in both languages', async () => {
    await inBothLocales(
      () =>
        open(
          ended({ restorableUntil: SLOT_HELD_UNTIL, slotHeldUntil: SLOT_HELD_UNTIL }),
          `/sessions?enrollment=${E2}`,
        ),
      async (t, locale) => {
        const panel = await panelOf(t);
        expect(
          panel.getByRole('button', { name: t('admin.sessions.detail.restore') }),
        ).toBeTruthy();
        expect(
          panel.getByText(
            t('admin.sessions.detail.restorableUntil', { when: at(t, locale, SLOT_HELD_UNTIL) }),
          ),
        ).toBeTruthy();
        const cases = within(
          panel.getByRole('region', { name: t('admin.sessions.detail.casesTitle') }),
        );
        expect(cases.getByText(t('admin.sessions.caseReason.adminEnded'))).toBeTruthy();
        expect(panel.queryByRole('button', { name: t('admin.sessions.detail.end') })).toBeNull();
      },
    );
  });

  it('offers the restore after the hold (a past `restorableUntil`), in both languages', async () => {
    await inBothLocales(
      () =>
        open(ended({ restorableUntil: PAST, slotHeldUntil: PAST }), `/sessions?enrollment=${E2}`),
      async (t, locale) => {
        const panel = await panelOf(t);
        expect(
          panel.getByRole('button', { name: t('admin.sessions.detail.restore') }),
        ).toBeTruthy();
        expect(
          panel.getByText(
            t('admin.sessions.detail.restorableUntil', { when: at(t, locale, PAST) }),
          ),
        ).toBeTruthy();
        expect(panel.getByText(t('admin.sessions.caseReason.adminEnded'))).toBeTruthy();
      },
    );
  });

  it('names an `admin_ended` case as the administration’s end of the enrollment', () => {
    const key: MessageKey | undefined = CASE_REASON.admin_ended;
    expect({
      ar: key === undefined ? undefined : translate('ar', key),
      en: key === undefined ? undefined : translate('en', key),
    }).toEqual({
      ar: 'إنهاء الإدارة الاشتراك',
      en: 'The administration ended the enrollment',
    });
  });
});
