// T048 (FR-477, FR-439; T033, T059; research R-323 GAP-2 and GAP-3): `/review` through the router,
// in both languages. The queue of sessions under review, in its pages; a session's connection
// record at `/review?session=`, for any session no longer scheduled (the schedule in the session's
// zone and the panel's, the events, the intervals, the simultaneous seconds, who joined, the
// outages), a scheduled one and a missing one said in plain words; the resolution of a session
// under review with its outcome and a mandatory reason, its refusals in plain words; and the
// correction of a settled `done` or no-show outcome through the shared dialog, its refusals said.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { cityName, dayMonth, dayMonthYear, timeOfDay } from '../../lib/format';
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

afterEach(() => setLocale('ar'));

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
/** Lets a press's mutation, if one was started, reach the client before a "nothing sent" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const S1 = '0193a6f0-0000-7000-8000-0000000000c1';
const S2 = '0193a6f0-0000-7000-8000-0000000000c2';
const S3 = '0193a6f0-0000-7000-8000-0000000000c3';
const E1 = '0193a6f0-0000-7000-8000-0000000000e1';
const O1 = '0193a6f0-0000-7000-8000-0000000000a1';
const DISPUTE = '0193a6f0-0000-7000-8000-0000000000d1';
const ADMIN = '0193a6f0-0000-7000-8000-0000000000f1';
const party = (n: number, displayName: string | null, deleted = false) => ({
  userId: `0193a6f0-0000-7000-8000-00000000010${n}`,
  displayName,
  deleted,
});

const underThreshold = {
  sessionId: S1,
  enrollmentId: E1,
  status: 'under_threshold',
  startsAt: '2026-11-10T14:00:00.000Z',
  endsAt: '2026-11-10T15:00:00.000Z',
  simultaneousSeconds: 1140,
  parties: { student: party(1, 'آمال علي'), teacher: party(2, 'المعلمة سارة') },
} as const;
const outage = {
  sessionId: S2,
  enrollmentId: E1,
  status: 'provider_outage',
  startsAt: '2026-11-11T14:00:00.000Z',
  endsAt: '2026-11-11T15:00:00.000Z',
  simultaneousSeconds: 0,
  parties: { student: party(1, 'آمال علي'), teacher: party(3, null, true) },
} as const;
const later = { ...underThreshold, sessionId: S3, startsAt: '2026-11-12T14:00:00.000Z' } as const;

/** A session's connection record, `status` as the case needs. */
function telemetry(status: string, sessionId = S1) {
  return {
    sessionId,
    schedule: {
      localDate: '2026-11-10',
      startTimeLocal: '16:00',
      timezone: 'Asia/Riyadh',
      startsAt: '2026-11-10T13:00:00.000Z',
      endsAt: '2026-11-10T14:00:00.000Z',
    },
    status,
    events: [
      {
        party: 'teacher',
        type: 'joined',
        occurredAt: '2026-11-10T13:01:00.000Z',
        connectionRef: 'c1',
      },
      {
        party: 'student',
        type: 'joined',
        occurredAt: '2026-11-10T13:07:00.000Z',
        connectionRef: 'c2',
      },
      {
        party: 'student',
        type: 'left',
        occurredAt: '2026-11-10T13:26:00.000Z',
        connectionRef: 'c2',
      },
      {
        party: 'teacher',
        type: 'left',
        occurredAt: '2026-11-10T13:58:00.000Z',
        connectionRef: 'c1',
      },
      { party: 'room', type: 'room_ended', occurredAt: '2026-11-10T14:00:00.000Z' },
    ],
    intervals: {
      student: [{ startsAt: '2026-11-10T13:07:00.000Z', endsAt: '2026-11-10T13:26:00.000Z' }],
      teacher: [{ startsAt: '2026-11-10T13:01:00.000Z', endsAt: '2026-11-10T13:58:00.000Z' }],
      together: [{ startsAt: '2026-11-10T13:07:00.000Z', endsAt: '2026-11-10T13:26:00.000Z' }],
    },
    simultaneousSeconds: 1140,
    joined: { student: true, teacher: true },
    outages: [
      { outageId: O1, startsAt: '2026-11-10T13:30:00.000Z', endsAt: '2026-11-10T13:50:00.000Z' },
    ],
  };
}

function fakeApi(record: object = telemetry('under_threshold')) {
  const api = {
    sessions: {
      review: { list: query(), get: query(), resolve: mutation(), revise: mutation() },
    },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.sessions.review.list.query.mockImplementation(async (input) => {
    const { cursor } = (input ?? {}) as { cursor?: string };
    if (cursor === S2) return { items: [later] };
    return { items: [underThreshold, outage], nextCursor: S2 };
  });
  api.sessions.review.get.query.mockResolvedValue(record);
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

function open(api = fakeApi(), at = '/review') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The table's row naming `text`. */
async function rowOf(text: string) {
  const cells = await screen.findAllByText(text);
  return cells[0]?.closest('tr') as HTMLElement;
}

/** The telemetry panel, once read. */
async function panel(t: Translate = ar) {
  const title = await screen.findByText(t('admin.review.telemetry.title'));
  return within(title.closest('aside') as HTMLElement);
}

async function dialog(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

describe('/review, the queue (FR-477)', () => {
  it('lists each session under review with its parties, its status and its simultaneous seconds, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText(t('admin.review.lede'))).toBeTruthy();
        const zone = panelTimeZone();
        const first = within(
          await rowOf(
            t('admin.common.dateTime', {
              date: dayMonth(underThreshold.startsAt, locale, zone),
              time: timeOfDay(underThreshold.startsAt, locale, zone),
            }),
          ),
        );
        expect(first.getByText('آمال علي')).toBeTruthy();
        expect(first.getByText('المعلمة سارة')).toBeTruthy();
        expect(first.getByText(t('admin.status.session.underThreshold'))).toBeTruthy();
        expect(first.getByText(t('admin.review.seconds', { count: 1140 }))).toBeTruthy();
        const second = within(
          await rowOf(
            t('admin.common.dateTime', {
              date: dayMonth(outage.startsAt, locale, zone),
              time: timeOfDay(outage.startsAt, locale, zone),
            }),
          ),
        );
        expect(second.getByText(t('admin.status.session.providerOutage'))).toBeTruthy();
        expect(second.getByText(t('admin.shared.party.deletedTeacher'))).toBeTruthy();
        expect(second.getByText(t('admin.review.seconds', { count: 0 }))).toBeTruthy();
      },
    );
  });

  it('reads the first page with no cursor, then the next by the cursor the server wrote', async () => {
    const { api } = open();
    await rowOf('المعلمة سارة');
    expect(api.sessions.review.list.query).toHaveBeenLastCalledWith({});
    const pages = screen.getByRole('navigation', { name: ar('admin.common.a11y.pages') });
    fireEvent.click(within(pages).getByRole('button', { name: '2' }));
    await waitFor(() =>
      expect(api.sessions.review.list.query).toHaveBeenLastCalledWith({ cursor: S2 }),
    );
  });

  it('says an empty queue in words', async () => {
    const api = fakeApi();
    api.sessions.review.list.query.mockResolvedValue({ items: [] });
    open(api);
    expect(await screen.findByText(ar('admin.sessionReview.empty.title'))).toBeTruthy();
    expect(screen.getByText(ar('admin.review.empty.text'))).toBeTruthy();
  });

  it('says a failed read with the page’s generic words', async () => {
    const api = fakeApi();
    api.sessions.review.list.query.mockRejectedValue(new Error('offline'));
    open(api);
    expect(await screen.findByText(ar('admin.common.loadError.text'))).toBeTruthy();
  });

  it('opens a row’s connection record at /review?session=', async () => {
    const { api } = open();
    fireEvent.click(await rowOf('المعلمة سارة'));
    await panel();
    expect(currentPath()).toBe(`/review?session=${S1}`);
    expect(api.sessions.review.get.query).toHaveBeenCalledWith({ sessionId: S1 });
  });
});

describe('/review?session=, the connection record (FR-477, GAP-2)', () => {
  it('draws the schedule in the session’s zone and the panel’s, the events, the intervals, the seconds, who joined and the outages, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(telemetry('done')), `/review?session=${S1}`),
      async (t, locale) => {
        const box = await panel(t);
        const zone = panelTimeZone();
        const record = telemetry('done');
        const at = (value: string) => timeOfDay(value, locale, zone);
        expect(box.getByText(t('admin.status.session.done'))).toBeTruthy();
        expect(
          box.getByText(
            t('admin.review.telemetry.inSessionZone', { city: cityName('Asia/Riyadh', locale) }),
          ),
        ).toBeTruthy();
        expect(
          box.getByText(
            t('admin.review.telemetry.sessionStart', {
              date: dayMonthYear('2026-11-10', locale, zone),
              time: '16:00',
            }),
          ),
        ).toBeTruthy();
        expect(
          box.getByText(t('admin.review.telemetry.inPanelZone', { city: cityName(zone, locale) })),
        ).toBeTruthy();
        expect(
          box.getByText(
            t('admin.common.dateTime', {
              date: dayMonthYear(record.schedule.startsAt, locale, zone),
              time: t('admin.review.telemetry.span', {
                start: at(record.schedule.startsAt),
                end: at(record.schedule.endsAt),
              }),
            }),
          ),
        ).toBeTruthy();
        for (const words of [
          'admin.review.telemetry.events.teacherJoined',
          'admin.review.telemetry.events.studentJoined',
          'admin.review.telemetry.events.studentLeft',
          'admin.review.telemetry.events.teacherLeft',
          'admin.review.telemetry.events.roomEnded',
        ] as const) {
          expect(box.getByText(t(words))).toBeTruthy();
        }
        for (const words of [
          'admin.review.telemetry.intervals.student',
          'admin.review.telemetry.intervals.teacher',
          'admin.review.telemetry.intervals.together',
        ] as const) {
          expect(box.getByText(t(words))).toBeTruthy();
        }
        expect(
          box.getAllByText(
            t('admin.review.telemetry.span', {
              start: at('2026-11-10T13:07:00.000Z'),
              end: at('2026-11-10T13:26:00.000Z'),
            }),
          ),
        ).toHaveLength(2);
        expect(box.getByText(t('admin.review.seconds', { count: 1140 }))).toBeTruthy();
        expect(box.getAllByText(t('admin.review.telemetry.joined'))).toHaveLength(2);
        expect(
          box.getByText(
            t('admin.common.dateTime', {
              date: dayMonthYear('2026-11-10T13:30:00.000Z', locale, zone),
              time: t('admin.review.telemetry.span', {
                start: at('2026-11-10T13:30:00.000Z'),
                end: at('2026-11-10T13:50:00.000Z'),
              }),
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('says who did not join, an empty record and no outage in words', async () => {
    const record = {
      ...telemetry('both_no_show'),
      events: [],
      intervals: { student: [], teacher: [], together: [] },
      simultaneousSeconds: 0,
      joined: { student: false, teacher: false },
      outages: [],
    };
    open(fakeApi(record), `/review?session=${S1}`);
    const box = await panel();
    expect(box.getAllByText(ar('admin.review.telemetry.notJoined'))).toHaveLength(2);
    expect(box.getByText(ar('admin.review.telemetry.noEvents'))).toBeTruthy();
    expect(box.getAllByText(ar('admin.review.telemetry.noInterval'))).toHaveLength(3);
    expect(box.getByText(ar('admin.review.telemetry.noOutages'))).toBeTruthy();
  });

  it.each([
    [
      'a scheduled session',
      refusal('CONFLICT', [{ path: 'cause', code: 'not_settled' }]),
      'admin.review.telemetry.refused.notSettled',
    ],
    ['no such session', refusal('NOT_FOUND'), 'admin.review.telemetry.refused.notFound'],
    ['any other failure', new Error('offline'), 'admin.common.loadError.text'],
  ] as const)('says %s in plain words', async (_case, error, words) => {
    const api = fakeApi();
    api.sessions.review.get.query.mockRejectedValue(error);
    open(api, `/review?session=${S1}`);
    expect(await screen.findByText(ar(words))).toBeTruthy();
  });
});

describe('/review, the resolution (FR-477)', () => {
  /** Opens the resolution of the session, chooses `outcome`, writes `reason` and presses it. */
  async function resolve(outcome: MessageKey | undefined, reason: string) {
    const box = await panel();
    fireEvent.click(box.getByRole('button', { name: ar('admin.review.telemetry.resolve') }));
    const form = await dialog(ar('admin.review.resolve.title'));
    if (outcome !== undefined) fireEvent.click(form.getByRole('radio', { name: ar(outcome) }));
    fireEvent.change(form.getByLabelText(ar('admin.sessionReview.detail.reasonLabel')), {
      target: { value: reason },
    });
    fireEvent.click(form.getByRole('button', { name: ar('admin.sessionReview.detail.confirm') }));
    return form;
  }

  it.each(['under_threshold', 'provider_outage'])(
    'offers it on a session %s, with the four outcomes and what follows, in both languages',
    async (status) => {
      await inBothLocales(
        () => open(fakeApi(telemetry(status)), `/review?session=${S1}`),
        async (t) => {
          const box = await panel(t);
          fireEvent.click(box.getByRole('button', { name: t('admin.review.telemetry.resolve') }));
          const form = await dialog(t('admin.review.resolve.title'));
          expect(form.getByText(t('admin.review.resolve.effect'))).toBeTruthy();
          for (const outcome of [
            'admin.status.session.done',
            'admin.status.session.studentNoShow',
            'admin.status.session.teacherNoShow',
            'admin.status.session.bothNoShow',
          ] as const) {
            expect(form.getByRole('radio', { name: t(outcome) })).toBeTruthy();
          }
          expect(form.getByLabelText(t('admin.sessionReview.detail.reasonLabel'))).toBeTruthy();
          expect(
            box.queryByRole('button', { name: t('admin.review.telemetry.correct') }),
          ).toBeNull();
        },
      );
    },
  );

  it('sends nothing without an outcome', async () => {
    const { api } = open(fakeApi(), `/review?session=${S1}`);
    await resolve(undefined, 'الاتصال انقطع من جهة الطالب');
    await settle();
    expect(api.sessions.review.resolve.mutate).not.toHaveBeenCalled();
  });

  it('sends nothing with a blank reason', async () => {
    const { api } = open(fakeApi(), `/review?session=${S1}`);
    await resolve('admin.status.session.done', '   ');
    await settle();
    expect(api.sessions.review.resolve.mutate).not.toHaveBeenCalled();
  });

  it('sends the outcome and the reason trimmed, then reads the record and the queue again', async () => {
    const { api } = open(fakeApi(), `/review?session=${S1}`);
    api.sessions.review.resolve.mutate.mockResolvedValue({ sessionId: S1, status: 'done' });
    await rowOf('المعلمة سارة');
    await resolve('admin.status.session.done', '  حضر الاثنان أغلب الموعد  ');
    await waitFor(() =>
      expect(api.sessions.review.resolve.mutate).toHaveBeenCalledWith({
        sessionId: S1,
        outcome: 'done',
        reason: 'حضر الاثنان أغلب الموعد',
      }),
    );
    await waitFor(() => expect(api.sessions.review.get.query).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.sessions.review.list.query).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 2, name: ar('admin.review.resolve.title') }),
      ).toBeNull(),
    );
  });

  it.each([
    [
      'a session no longer under review',
      refusal('CONFLICT', [{ path: 'cause', code: 'not_under_review' }]),
      'admin.review.resolve.refused.notUnderReview',
    ],
    ['no such session', refusal('NOT_FOUND'), 'admin.review.resolve.refused.notFound'],
    ['any other failure', new Error('offline'), 'admin.dialogs.submitError'],
  ] as const)('says %s in plain words, the dialog left open', async (_case, error, words) => {
    const { api } = open(fakeApi(), `/review?session=${S1}`);
    api.sessions.review.resolve.mutate.mockRejectedValue(error);
    const form = await resolve('admin.status.session.teacherNoShow', 'لم يدخل المعلم');
    expect(await form.findByText(ar(words))).toBeTruthy();
  });

  it.each(['done', 'student_no_show', 'disputed', 'cancelled_by_admin'])(
    'is not offered on a session %s',
    async (status) => {
      open(fakeApi(telemetry(status)), `/review?session=${S1}`);
      const box = await panel();
      expect(box.queryByRole('button', { name: ar('admin.review.telemetry.resolve') })).toBeNull();
    },
  );
});

describe('/review?session=, the correction of an outcome nobody disputed (FR-439, GAP-3)', () => {
  /** Opens the correction of the session, chooses Teacher-No-Show, writes a reason and presses it. */
  async function correct(api: ReturnType<typeof fakeApi>) {
    const opened = open(api, `/review?session=${S1}`);
    const box = await panel();
    fireEvent.click(box.getByRole('button', { name: ar('admin.review.telemetry.correct') }));
    const form = await dialog(ar('admin.shared.correction.title'));
    fireEvent.click(form.getByRole('radio', { name: ar('admin.status.session.teacherNoShow') }));
    fireEvent.change(form.getByLabelText(ar('admin.shared.correction.reasonLabel')), {
      target: { value: 'سجل الدخول يثبت غياب المعلم' },
    });
    fireEvent.click(form.getByRole('button', { name: ar('admin.shared.correction.confirm') }));
    return { ...opened, form };
  }

  it.each(['done', 'student_no_show', 'teacher_no_show', 'both_no_show'])(
    'is offered on a session settled %s, in both languages',
    async (status) => {
      await inBothLocales(
        () => open(fakeApi(telemetry(status)), `/review?session=${S1}`),
        async (t) => {
          const box = await panel(t);
          fireEvent.click(box.getByRole('button', { name: t('admin.review.telemetry.correct') }));
          expect(await dialog(t('admin.shared.correction.title'))).toBeTruthy();
        },
      );
    },
  );

  it.each([
    'under_threshold',
    'provider_outage',
    'disputed',
    'cancelled_by_admin',
    'cancelled_by_agreement',
  ])('is not offered on a session %s', async (status) => {
    open(fakeApi(telemetry(status)), `/review?session=${S1}`);
    const box = await panel();
    expect(box.queryByRole('button', { name: ar('admin.review.telemetry.correct') })).toBeNull();
  });

  it('sends the correction of this session, then reads the record and the queue again', async () => {
    const api = fakeApi(telemetry('done'));
    api.sessions.review.revise.mutate.mockResolvedValue({
      sessionId: S1,
      sessionStatus: 'teacher_no_show',
      previousStatus: 'done',
    });
    await correct(api);
    await waitFor(() => expect(api.sessions.review.revise.mutate).toHaveBeenCalledTimes(1));
    expect(api.sessions.review.revise.mutate.mock.calls[0]?.[0]).toMatchObject({
      sessionId: S1,
      outcome: 'teacher_no_show',
      reason: 'سجل الدخول يثبت غياب المعلم',
    });
    await waitFor(() => expect(api.sessions.review.get.query).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.sessions.review.list.query).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 2, name: ar('admin.shared.correction.title') }),
      ).toBeNull(),
    );
  });

  it.each([
    [
      'RULING_FINAL, the window closed',
      refusal('RULING_FINAL', [{ path: 'cause', code: 'window_closed' }]),
      'admin.shared.correction.refused.windowClosed',
    ],
    [
      'RULING_FINAL, a remedy offered',
      refusal('RULING_FINAL', [{ path: 'cause', code: 'remedy_offered' }]),
      'admin.shared.correction.refused.remedyOffered',
    ],
    ['DISPUTE_OPEN', refusal('DISPUTE_OPEN'), 'admin.shared.correction.refused.disputeOpen'],
    [
      'CONFLICT, a ruled dispute',
      refusal('CONFLICT', [
        { path: 'cause', code: 'ruled' },
        { path: 'disputeId', code: DISPUTE },
      ]),
      'admin.shared.correction.refused.ruled',
    ],
    [
      'SESSION_UNDER_REVIEW',
      refusal('SESSION_UNDER_REVIEW'),
      'admin.shared.correction.refused.underReview',
    ],
  ] as const)('says %s in plain words', async (_case, error, words) => {
    const api = fakeApi(telemetry('done'));
    api.sessions.review.revise.mutate.mockRejectedValue(error);
    const { form } = await correct(api);
    expect(await form.findByText(ar(words))).toBeTruthy();
  });
});

describe('T058: RATE_LIMITED on /review', () => {
  const limited = (seconds?: string) =>
    refusal('RATE_LIMITED', seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }]);

  it('the queue says when to try again', async () => {
    const api = fakeApi();
    api.sessions.review.list.query.mockRejectedValue(limited('61'));
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('the connection record says to wait a little when no time is given, and offers a retry', async () => {
    const api = fakeApi();
    api.sessions.review.get.query.mockRejectedValue(limited());
    open(api, `/review?session=${S1}`);
    expect(await screen.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
    expect(screen.getByRole('button', { name: ar('admin.common.action.retry') })).toBeTruthy();
  });

  it('the resolution says when to try again, the dialog left open', async () => {
    const { api } = open(fakeApi(), `/review?session=${S1}`);
    api.sessions.review.resolve.mutate.mockRejectedValue(limited('120'));
    const box = await panel();
    fireEvent.click(box.getByRole('button', { name: ar('admin.review.telemetry.resolve') }));
    const form = await dialog(ar('admin.review.resolve.title'));
    fireEvent.click(form.getByRole('radio', { name: ar('admin.status.session.teacherNoShow') }));
    fireEvent.change(form.getByLabelText(ar('admin.sessionReview.detail.reasonLabel')), {
      target: { value: 'لم يدخل المعلم' },
    });
    fireEvent.click(form.getByRole('button', { name: ar('admin.sessionReview.detail.confirm') }));
    expect(await form.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(form.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });
});
