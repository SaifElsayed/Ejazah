// T049 (FR-475, FR-476, FR-472, FR-451, FR-487; research R-308; the note under T049, B42), the
// panel's `/disputes` through the router, in both languages:
// - the queue (`disputes.list`): open first as the server answers it, who raised each dispute and
//   when, the outcome under dispute (or that the session is not evaluated yet), the enrollment's
//   Teacher-No-Show count and its mark (lane S's `NoShowMark`), keyset pages;
// - the detail at `?dispute=` (`disputes.get`): the dispute and its raiser's reason, the parties
//   (lane S's `PartyName`, a deleted one's stand-in), the telemetry, the enrollment's link to
//   `/sessions?enrollment=`;
// - the enrollment's chat only while `chatAvailable` (`disputes.chat`, its pages, each message with
//   its sender's role), its refusals in plain words;
// - the «held files» (lane S's `HeldFilesSection`) only while the dispute is open and a party is
//   deleted, from `disputes.get`'s `parties`;
// - the resolution (`disputes.resolve`): R-308's choices, what each does, a mandatory reason, each
//   refusal in plain words, the button only while the dispute is open;
// - a ruling's revision (`disputes.revise`): the button only while `revisable`, the earlier ruling
//   and its revisions beside it, the outcome and a mandatory reason, the key minted when the dialog
//   opens and reused on its retry, the answer's `notUndone` and each refusal in plain words;
// - every other failure the page's generic words; no text says anything is final.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { cityName, dayMonth, dayMonthYear, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import {
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
  type Translate,
} from '../../test/app-harness';

afterEach(() => {
  setLocale('ar');
});

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const D1 = '0193a6f0-0000-7000-8000-0000000000d1';
const D2 = '0193a6f0-0000-7000-8000-0000000000d2';
const D3 = '0193a6f0-0000-7000-8000-0000000000d3';
const SESSION = '0193a6f0-0000-7000-8000-000000000051';
const ENROLLMENT = '0193a6f0-0000-7000-8000-0000000000e1';
const STUDENT = '0193a6f0-0000-7000-8000-0000000000b1';
const TEACHER = '0193a6f0-0000-7000-8000-0000000000b2';
const M1 = '0193a6f0-0000-7000-8000-0000000000c1';
const M2 = '0193a6f0-0000-7000-8000-0000000000c2';
const M3 = '0193a6f0-0000-7000-8000-0000000000c3';
const M4 = '0193a6f0-0000-7000-8000-0000000000c4';
const ZONE = 'Africa/Cairo';
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
/** Lets a press's mutation, if one was started, reach the client before a "nothing sent" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const ROW1 = {
  disputeId: D1,
  sessionId: SESSION,
  raisedBy: 'student',
  raisedAt: '2026-11-09T09:00:00.000Z',
  outcomeUnderDispute: 'teacher_no_show',
  teacherNoShows: 5,
  repeatedAbsence: true,
} as const;
const ROW2 = {
  disputeId: D2,
  sessionId: SESSION,
  raisedBy: 'teacher',
  raisedAt: '2026-11-10T09:00:00.000Z',
  teacherNoShows: 1,
  repeatedAbsence: false,
} as const;
const ROW3 = { ...ROW1, disputeId: D3, raisedAt: '2026-11-01T09:00:00.000Z' } as const;

const TELEMETRY = {
  sessionId: SESSION,
  schedule: {
    localDate: '2026-11-08',
    startTimeLocal: '08:00',
    timezone: ZONE,
    startsAt: '2026-11-08T06:00:00.000Z',
    endsAt: '2026-11-08T07:00:00.000Z',
  },
  status: 'disputed',
  events: [
    {
      party: 'student',
      type: 'joined',
      occurredAt: '2026-11-08T06:01:00.000Z',
      connectionRef: 'c1',
    },
    {
      party: 'teacher',
      type: 'joined',
      occurredAt: '2026-11-08T06:20:00.000Z',
      connectionRef: 'c2',
    },
    { party: 'teacher', type: 'left', occurredAt: '2026-11-08T06:57:00.000Z', connectionRef: 'c2' },
    { party: 'student', type: 'left', occurredAt: '2026-11-08T06:58:00.000Z', connectionRef: 'c1' },
    { party: 'room', type: 'room_ended', occurredAt: '2026-11-08T07:00:00.000Z' },
  ],
  intervals: { student: [], teacher: [], together: [] },
  simultaneousSeconds: 2290,
  joined: { student: true, teacher: true },
  outages: [
    {
      outageId: '0193a6f0-0000-7000-8000-0000000000a1',
      startsAt: '2026-11-08T06:30:00.000Z',
      endsAt: '2026-11-08T06:35:00.000Z',
    },
  ],
} as const;

const LIVE = {
  student: { userId: STUDENT, displayName: 'آمال علي', deleted: false },
  teacher: { userId: TEACHER, displayName: 'سارة عادل', deleted: false },
};
const STUDENT_DELETED = {
  ...LIVE,
  student: { userId: STUDENT, displayName: null, deleted: true },
};

const OPEN_DETAIL = {
  dispute: {
    disputeId: D1,
    sessionId: SESSION,
    enrollmentId: ENROLLMENT,
    raisedBy: 'student',
    reason: 'دخل المعلم متأخرًا ثم خرج',
    status: 'open',
    raisedAt: '2026-11-09T09:00:00.000Z',
    outcomeUnderDispute: 'teacher_no_show',
  },
  telemetry: TELEMETRY,
  chatAvailable: true,
  revisable: false,
  revisions: [],
  parties: LIVE,
};

const RESOLVED_DETAIL = {
  ...OPEN_DETAIL,
  dispute: {
    disputeId: D3,
    sessionId: SESSION,
    enrollmentId: ENROLLMENT,
    raisedBy: 'student',
    reason: 'دخل المعلم متأخرًا ثم خرج',
    status: 'resolved',
    raisedAt: '2026-11-01T09:00:00.000Z',
    resolution: 'no_show_recorded',
    resolutionNotes: 'السجل يثبت غياب المعلم',
    resolvedAt: '2026-11-02T10:00:00.000Z',
  },
  telemetry: { ...TELEMETRY, status: 'teacher_no_show' },
  chatAvailable: false,
  revisable: true,
  revisions: [
    {
      outcomeBefore: 'teacher_no_show',
      outcomeAfter: 'both_no_show',
      revisedAt: '2026-11-03T11:00:00.000Z',
    },
  ],
};

const CHAT_PAGE = {
  messages: [
    {
      messageId: M1,
      body: 'السلام عليكم، أنا في الغرفة',
      sentAt: '2026-11-08T06:02:00.000Z',
      purged: false,
      senderRole: 'student',
    },
    {
      messageId: M2,
      attachment: { filename: 'plan.pdf', mime: 'application/pdf' },
      sentAt: '2026-11-08T05:00:00.000Z',
      purged: false,
      senderRole: 'teacher',
    },
    { messageId: M3, sentAt: '2026-11-07T05:00:00.000Z', purged: true, senderRole: 'teacher' },
  ],
  nextCursor: M3,
} as const;
const OLDER_PAGE = {
  messages: [
    {
      messageId: M4,
      body: 'موعدنا غدًا',
      sentAt: '2026-11-06T05:00:00.000Z',
      purged: false,
      senderRole: 'teacher',
    },
  ],
} as const;

function fakeApi() {
  const api = {
    disputes: {
      list: query(),
      get: query(),
      chat: query(),
      heldFiles: query(),
      heldFileLink: mutation(),
      resolve: mutation(),
      revise: mutation(),
    },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.disputes.list.query.mockImplementation(async (input) => {
    const { cursor } = (input ?? {}) as { cursor?: string };
    if (cursor === `open:${D2}`) return { items: [ROW3] };
    return { items: [ROW1, ROW2], nextCursor: `open:${D2}` };
  });
  api.disputes.get.query.mockImplementation(async (input) => {
    const { disputeId } = input as { disputeId: string };
    return disputeId === D3 ? RESOLVED_DETAIL : OPEN_DETAIL;
  });
  api.disputes.chat.query.mockImplementation(async (input) => {
    const { cursor } = input as { cursor?: string };
    return cursor === M3 ? OLDER_PAGE : CHAT_PAGE;
  });
  api.disputes.heldFiles.query.mockResolvedValue({
    files: [{ fileRef: `photo:${STUDENT}`, kind: 'photo', ownerRole: 'student' }],
  });
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: D1, displayName: 'سارة عادل', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

function open(api = fakeApi(), at = '/disputes') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The detail beside the queue, once its dispute has loaded. */
async function detail(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', { name: t('admin.disputes.detail.a11y') });
  await within(aside).findByText(t('admin.disputes.view.reasonTitle'));
  return within(aside);
}

async function dialog(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

/** The queue's row of the dispute raised at `raisedAt`. */
async function rowOf(raisedBy: 'student' | 'teacher', raisedAt: string) {
  const words = ar(
    raisedBy === 'student' ? 'admin.disputes.raisedByStudent' : 'admin.disputes.raisedByTeacher',
    { date: dayMonth(raisedAt, 'ar', panelTimeZone()) },
  );
  const cell = await screen.findByText(words);
  return cell.closest('tr') as HTMLElement;
}

/** No text of the page calls anything final (Q1, R-HONEST). */
function sayNothingFinal(): void {
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/نهائي|نهائيًا|لا رجعة|final|irreversible|permanent/i);
}

describe('the disputes queue (FR-475, FR-451)', () => {
  it('draws the queue in both languages: who raised each dispute and when, the outcome under dispute, the count and the mark', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText(t('admin.disputes.queueLede'))).toBeTruthy();
        expect(
          await screen.findByRole('columnheader', {
            name: t('admin.disputes.queue.columns.dispute'),
          }),
        ).toBeTruthy();
        for (const column of [
          'admin.disputes.queue.columns.dispute',
          'admin.disputes.queue.columns.outcome',
          'admin.disputes.detail.noShowCount',
        ] as const) {
          expect(screen.getByRole('columnheader', { name: t(column) })).toBeTruthy();
        }
        const zone = panelTimeZone();
        const first = within(
          (
            await screen.findByText(
              t('admin.disputes.raisedByStudent', { date: dayMonth(ROW1.raisedAt, locale, zone) }),
            )
          ).closest('tr') as HTMLElement,
        );
        expect(first.getByText(t('admin.status.session.teacherNoShow'))).toBeTruthy();
        expect(first.getByText(t('admin.shared.noShows.count', { count: 5 }))).toBeTruthy();
        expect(first.getByText(t('admin.shared.noShows.mark'))).toBeTruthy();
        const second = within(
          screen
            .getByText(
              t('admin.disputes.raisedByTeacher', { date: dayMonth(ROW2.raisedAt, locale, zone) }),
            )
            .closest('tr') as HTMLElement,
        );
        expect(second.getByText(t('admin.disputes.queue.notEvaluated'))).toBeTruthy();
        expect(second.getByText(t('admin.shared.noShows.count', { count: 1 }))).toBeTruthy();
        expect(second.queryByText(t('admin.shared.noShows.mark'))).toBeNull();
        expect(
          screen.queryByText(
            t('admin.disputes.detail.noShowCountValue', { count: 5, threshold: 5 }),
          ),
        ).toBeNull();
        sayNothingFinal();
      },
    );
  });

  it('reads the first page with no cursor, and pages by the cursor the server wrote', async () => {
    const { api } = open();
    await rowOf('student', ROW1.raisedAt);
    expect(api.disputes.list.query).toHaveBeenLastCalledWith({});
    const pages = screen.getByRole('navigation', { name: ar('admin.common.a11y.pages') });
    fireEvent.click(within(pages).getByRole('button', { name: '2' }));
    await rowOf('student', ROW3.raisedAt);
    expect(api.disputes.list.query).toHaveBeenLastCalledWith({ cursor: `open:${D2}` });
  });

  it('says when there is no dispute', async () => {
    const api = fakeApi();
    api.disputes.list.query.mockResolvedValue({ items: [] });
    open(api);
    expect(await screen.findByText(ar('admin.disputes.queue.empty.title'))).toBeTruthy();
  });

  it('says the queue could not load in the generic words, and reads it again on retry', async () => {
    const api = fakeApi();
    api.disputes.list.query.mockRejectedValueOnce(refusal('INTERNAL'));
    open(api);
    expect(
      await screen.findByText(
        ar('admin.common.loadError.title', { page: ar('admin.disputes.title') }),
      ),
    ).toBeTruthy();
    expect(screen.getByText(ar('admin.common.loadError.text'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ar('admin.common.action.retry') }));
    await rowOf('student', ROW1.raisedAt);
  });

  it('opens a dispute beside the queue from its row', async () => {
    const { api } = open();
    fireEvent.click(await rowOf('teacher', ROW2.raisedAt));
    await detail();
    expect(api.disputes.get.query).toHaveBeenLastCalledWith({ disputeId: D2 });
  });
});

describe('a dispute’s detail (FR-475, FR-426)', () => {
  it('draws the dispute, its reason, the parties, the telemetry and the enrollment’s link in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/disputes?dispute=${D1}`),
      async (t, locale) => {
        const aside = await detail(t);
        const zone = panelTimeZone();
        expect(
          aside.getByText(
            t('admin.disputes.raisedByStudent', {
              date: dayMonth(OPEN_DETAIL.dispute.raisedAt, locale, zone),
            }),
          ),
        ).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.state.open'))).toBeTruthy();
        expect(aside.getByText(OPEN_DETAIL.dispute.reason)).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.view.partiesTitle'))).toBeTruthy();
        expect(aside.getByText('آمال علي')).toBeTruthy();
        expect(aside.getByText('سارة عادل')).toBeTruthy();
        // The telemetry, in the session's zone.
        expect(aside.getByText(t('admin.disputes.detail.attendance'))).toBeTruthy();
        expect(
          aside.getByText(
            t('admin.disputes.telemetry.scheduleValue', {
              date: dayMonthYear(TELEMETRY.schedule.localDate, locale, ZONE),
              time: timeOfDay(TELEMETRY.schedule.startsAt, locale, ZONE),
              city: cityName(ZONE, locale),
            }),
          ),
        ).toBeTruthy();
        expect(aside.getByText(t('admin.status.session.disputed'))).toBeTruthy();
        expect(
          aside.getByText(t('admin.disputes.telemetry.togetherValue', { duration: '38:10' })),
        ).toBeTruthy();
        expect(aside.getAllByText(t('admin.disputes.detail.events.studentJoined')).length).toBe(2);
        expect(aside.getAllByText(t('admin.disputes.detail.events.teacherJoined')).length).toBe(2);
        expect(aside.getByText(t('admin.disputes.telemetry.studentLeft'))).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.telemetry.teacherLeft'))).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.telemetry.roomEnded'))).toBeTruthy();
        expect(aside.getByText(timeOfDay('2026-11-08T06:20:00.000Z', locale, ZONE))).toBeTruthy();
        expect(
          aside.getByText(
            t('admin.disputes.telemetry.outage', {
              from: timeOfDay(TELEMETRY.outages[0].startsAt, locale, ZONE),
              to: timeOfDay(TELEMETRY.outages[0].endsAt, locale, ZONE),
            }),
          ),
        ).toBeTruthy();
        const link = aside.getByRole('link', { name: t('admin.disputes.view.enrollmentLink') });
        expect(link.getAttribute('href')).toBe(`/sessions?enrollment=${ENROLLMENT}`);
        sayNothingFinal();
      },
    );
  });

  it('names a deleted party by its stand-in, never an empty name', async () => {
    const api = fakeApi();
    api.disputes.get.query.mockResolvedValue({ ...OPEN_DETAIL, parties: STUDENT_DELETED });
    open(api, `/disputes?dispute=${D1}`);
    const aside = await detail();
    expect(aside.getByText(ar('admin.shared.party.deletedStudent'))).toBeTruthy();
    expect(aside.getByText('سارة عادل')).toBeTruthy();
  });

  it('says the dispute could not load in the generic words', async () => {
    const api = fakeApi();
    api.disputes.get.query.mockRejectedValue(refusal('INTERNAL'));
    open(api, `/disputes?dispute=${D1}`);
    const aside = await screen.findByRole('complementary', {
      name: ar('admin.disputes.detail.a11y'),
    });
    expect(await within(aside).findByText(ar('admin.common.loadError.text'))).toBeTruthy();
  });
});

describe('the enrollment’s chat on the dispute’s page (FR-475; the note under T049, Q2)', () => {
  it('reads the chat while the dispute is open, each message with its sender’s role, and its older pages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/disputes?dispute=${D1}`),
      async (t, locale) => {
        const aside = await detail(t);
        expect(await aside.findByText(CHAT_PAGE.messages[0].body)).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.detail.chatTitle'))).toBeTruthy();
        expect(aside.getByText(t('admin.chatLog.banner'))).toBeTruthy();
        const zone = panelTimeZone();
        const meta = (role: 'student' | 'teacher', sentAt: string) =>
          t('admin.disputes.chat.meta', {
            sender: t(
              role === 'student'
                ? 'admin.disputes.columns.student'
                : 'admin.disputes.columns.teacher',
            ),
            date: dayMonth(sentAt, locale, zone),
            time: timeOfDay(sentAt, locale, zone),
          });
        expect(aside.getByText(meta('student', CHAT_PAGE.messages[0].sentAt))).toBeTruthy();
        expect(aside.getByText(meta('teacher', CHAT_PAGE.messages[1].sentAt))).toBeTruthy();
        expect(
          aside.getByText(t('admin.disputes.chat.attachment', { name: 'plan.pdf' })),
        ).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.chat.purged'))).toBeTruthy();
        fireEvent.click(aside.getByRole('button', { name: t('admin.disputes.chat.more') }));
        expect(await aside.findByText(OLDER_PAGE.messages[0].body)).toBeTruthy();
        expect(aside.queryByRole('button', { name: t('admin.disputes.chat.more') })).toBeNull();
      },
    );
  });

  it('asks the chat with the dispute and each page’s cursor', async () => {
    const { api } = open(fakeApi(), `/disputes?dispute=${D1}`);
    const aside = await detail();
    await aside.findByText(CHAT_PAGE.messages[0].body);
    expect(api.disputes.chat.query).toHaveBeenCalledWith({ disputeId: D1 });
    fireEvent.click(aside.getByRole('button', { name: ar('admin.disputes.chat.more') }));
    await aside.findByText(OLDER_PAGE.messages[0].body);
    expect(api.disputes.chat.query).toHaveBeenLastCalledWith({ disputeId: D1, cursor: M3 });
  });

  it('neither reads nor draws the chat while the server says it is not available', async () => {
    const { api } = open(fakeApi(), `/disputes?dispute=${D3}`);
    const aside = await detail();
    await settle();
    expect(api.disputes.chat.query).not.toHaveBeenCalled();
    expect(aside.queryByText(ar('admin.disputes.detail.chatTitle'))).toBeNull();
  });

  it.each([
    ['CONFLICT', [{ path: 'cause', code: 'not_open' }], 'admin.disputes.chat.notOpen'],
    ['NOT_FOUND', [], 'admin.disputes.chat.notFound'],
    ['INTERNAL', [], 'admin.common.loadError.text'],
  ] as const)('says a chat read refused %s in plain words', async (code, details, words) => {
    const api = fakeApi();
    api.disputes.chat.query.mockRejectedValue(refusal(code, details));
    open(api, `/disputes?dispute=${D1}`);
    const aside = await detail();
    expect(await aside.findByText(ar(words))).toBeTruthy();
  });
});

describe('the held files (FR-487; the note under T049, Q5 (b))', () => {
  it('draws the held files while the dispute is open and a party is deleted, asking with the dispute', async () => {
    const api = fakeApi();
    api.disputes.get.query.mockResolvedValue({ ...OPEN_DETAIL, parties: STUDENT_DELETED });
    open(api, `/disputes?dispute=${D1}`);
    const aside = await detail();
    expect(await aside.findByText(ar('admin.shared.heldFiles.title'))).toBeTruthy();
    expect(await aside.findByText(ar('admin.shared.heldFiles.kind.photo'))).toBeTruthy();
    expect(api.disputes.heldFiles.query).toHaveBeenCalledWith({ disputeId: D1 });
  });

  it('neither draws nor asks for them while no party is deleted', async () => {
    const { api } = open(fakeApi(), `/disputes?dispute=${D1}`);
    const aside = await detail();
    await settle();
    expect(aside.queryByText(ar('admin.shared.heldFiles.title'))).toBeNull();
    expect(api.disputes.heldFiles.query).not.toHaveBeenCalled();
  });

  it('neither draws nor asks for them once the dispute is not open, a party deleted', async () => {
    const api = fakeApi();
    api.disputes.get.query.mockResolvedValue({ ...RESOLVED_DETAIL, parties: STUDENT_DELETED });
    open(api, `/disputes?dispute=${D3}`);
    const aside = await detail();
    await settle();
    expect(aside.queryByText(ar('admin.shared.heldFiles.title'))).toBeNull();
    expect(api.disputes.heldFiles.query).not.toHaveBeenCalled();
  });
});

/** Opens the resolution's dialog on the open dispute. */
async function resolution(api = fakeApi(), t: Translate = ar) {
  open(api, `/disputes?dispute=${D1}`);
  const aside = await detail(t);
  fireEvent.click(aside.getByRole('button', { name: t('admin.disputes.detail.issue') }));
  return dialog(t('admin.disputes.resolve.title'));
}

type Box = Awaited<ReturnType<typeof dialog>>;

function writeReason(box: Box, label: MessageKey, reason: string): void {
  fireEvent.change(box.getByLabelText(ar(label)), { target: { value: reason } });
}

describe('the resolution (FR-476; research R-308)', () => {
  it('offers R-308’s choices with what each does, and a mandatory reason, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/disputes?dispute=${D1}`),
      async (t) => {
        const aside = await detail(t);
        fireEvent.click(aside.getByRole('button', { name: t('admin.disputes.detail.issue') }));
        const box = await dialog(t('admin.disputes.resolve.title'));
        const choose = (key: MessageKey) =>
          fireEvent.click(box.getByRole('radio', { name: t(key) }));
        const outcome = t('admin.status.session.teacherNoShow');
        choose('admin.disputes.detail.choices.uphold');
        expect(
          box.getByText(t('admin.disputes.resolve.effect.keepsOutcome', { outcome })),
        ).toBeTruthy();
        expect(box.getByText(t('admin.disputes.resolve.effect.remedyLater'))).toBeTruthy();
        choose('admin.disputes.detail.choices.reclassifyConsumed');
        expect(
          box.getByText(t('admin.disputes.detail.choices.reclassifyConsumedHint')),
        ).toBeTruthy();
        choose('admin.disputes.detail.choices.reclassifyNotConsumed');
        expect(
          box.getByText(t('admin.disputes.detail.choices.reclassifyNotConsumedHint')),
        ).toBeTruthy();
        choose('admin.disputes.detail.choices.recordNoShow');
        fireEvent.click(box.getByRole('radio', { name: t('admin.disputes.columns.teacher') }));
        expect(box.getByText(t('admin.disputes.resolve.effect.teacherNoShow'))).toBeTruthy();
        fireEvent.click(box.getByRole('radio', { name: t('admin.disputes.columns.student') }));
        expect(box.getByText(t('admin.disputes.resolve.effect.studentNoShow'))).toBeTruthy();
        choose('admin.disputes.detail.choices.orderCompensation');
        expect(box.getByText(t('admin.disputes.detail.compensationNote'))).toBeTruthy();
        choose('admin.disputes.detail.suspendParty');
        expect(
          box.getByText(t('admin.disputes.resolve.effect.suspended', { outcome })),
        ).toBeTruthy();
        expect(
          box.getByRole('radio', {
            name: t('admin.disputes.detail.partyStudent', { name: 'آمال علي' }),
          }),
        ).toBeTruthy();
        choose('admin.disputes.detail.banParty');
        expect(box.getByText(t('admin.disputes.resolve.effect.banned', { outcome }))).toBeTruthy();
        expect(
          box.getByRole('radio', {
            name: t('admin.disputes.detail.partyTeacher', { name: 'سارة عادل' }),
          }),
        ).toBeTruthy();
        expect(box.getByLabelText(t('admin.disputes.detail.notesLabel'))).toBeTruthy();
        sayNothingFinal();
      },
    );
  });

  it('sends nothing without a reason, nor while a choice lacks whom it names', async () => {
    const api = fakeApi();
    const box = await resolution(api);
    const confirm = box.getByRole('button', { name: ar('admin.disputes.detail.issue') });
    fireEvent.click(box.getByRole('radio', { name: ar('admin.disputes.detail.choices.uphold') }));
    fireEvent.click(confirm);
    writeReason(box, 'admin.disputes.detail.notesLabel', '   ');
    fireEvent.click(confirm);
    writeReason(box, 'admin.disputes.detail.notesLabel', 'السجل يثبت الغياب');
    fireEvent.click(
      box.getByRole('radio', { name: ar('admin.disputes.detail.choices.recordNoShow') }),
    );
    fireEvent.click(confirm);
    fireEvent.click(box.getByRole('radio', { name: ar('admin.disputes.detail.banParty') }));
    fireEvent.click(confirm);
    await settle();
    expect(api.disputes.resolve.mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['admin.disputes.detail.choices.uphold', undefined, { resolution: 'upheld' }],
    [
      'admin.disputes.detail.choices.reclassifyConsumed',
      undefined,
      { resolution: 're_marked', consumed: true },
    ],
    [
      'admin.disputes.detail.choices.reclassifyNotConsumed',
      undefined,
      { resolution: 're_marked', consumed: false },
    ],
    [
      'admin.disputes.detail.choices.recordNoShow',
      'admin.disputes.columns.teacher',
      { resolution: 'no_show_recorded', against: 'teacher' },
    ],
    [
      'admin.disputes.detail.choices.orderCompensation',
      undefined,
      { resolution: 'compensation_ordered' },
    ],
    [
      'admin.disputes.detail.suspendParty',
      'student',
      { resolution: 'party_suspended', party: 'student' },
    ],
    ['admin.disputes.detail.banParty', 'teacher', { resolution: 'party_banned', party: 'teacher' }],
  ] as const)(
    'sends %s as R-308 names it, with the reason trimmed, and reads the page again',
    async (choice, second, sent) => {
      const api = fakeApi();
      api.disputes.resolve.mutate.mockResolvedValue({ disputeId: D1, sessionStatus: 'done' });
      const box = await resolution(api);
      fireEvent.click(box.getByRole('radio', { name: ar(choice) }));
      if (second === 'student' || second === 'teacher') {
        const key =
          second === 'student'
            ? 'admin.disputes.detail.partyStudent'
            : 'admin.disputes.detail.partyTeacher';
        const name = second === 'student' ? 'آمال علي' : 'سارة عادل';
        fireEvent.click(box.getByRole('radio', { name: ar(key, { name }) }));
      } else if (second !== undefined) {
        fireEvent.click(box.getByRole('radio', { name: ar(second) }));
      }
      writeReason(box, 'admin.disputes.detail.notesLabel', '  السجل يثبت الغياب  ');
      const reads = api.disputes.get.query.mock.calls.length;
      fireEvent.click(box.getByRole('button', { name: ar('admin.disputes.detail.issue') }));
      await waitFor(() => expect(api.disputes.resolve.mutate).toHaveBeenCalledTimes(1));
      expect(api.disputes.resolve.mutate).toHaveBeenCalledWith({
        disputeId: D1,
        reason: 'السجل يثبت الغياب',
        ...sent,
      });
      await waitFor(() =>
        expect(
          screen.queryByRole('heading', { name: ar('admin.disputes.resolve.title') }),
        ).toBeNull(),
      );
      await waitFor(() => expect(api.disputes.get.query.mock.calls.length).toBeGreaterThan(reads));
    },
  );

  it.each([
    [
      'CONFLICT',
      [{ path: 'cause', code: 'not_evaluated' }],
      'admin.disputes.resolve.refused.notEvaluated',
    ],
    ['CONFLICT', [{ path: 'cause', code: 'not_open' }], 'admin.disputes.resolve.refused.notOpen'],
    [
      'CONFLICT',
      [{ path: 'teacherUserId', code: 'suspended' }],
      'admin.disputes.resolve.refused.alreadySuspended',
    ],
    [
      'CONFLICT',
      [{ path: 'studentUserId', code: 'suspended' }],
      'admin.disputes.resolve.refused.alreadySuspended',
    ],
    [
      'CONFLICT',
      [{ path: 'studentUserId', code: 'banned' }],
      'admin.disputes.resolve.refused.alreadyBanned',
    ],
    [
      'CONFLICT',
      [{ path: 'teacherUserId', code: 'banned' }],
      'admin.disputes.resolve.refused.alreadyBanned',
    ],
    [
      'CONFLICT',
      [{ path: 'teacherUserId', code: 'revoked' }],
      'admin.disputes.resolve.refused.notApproved',
    ],
    [
      'CONFLICT',
      [{ path: 'studentUserId', code: 'deleted' }],
      'admin.disputes.resolve.refused.standing',
    ],
    ['NOT_FOUND', [], 'admin.disputes.resolve.refused.notFound'],
    ['INTERNAL', [], 'admin.dialogs.submitError'],
  ] as const)('says a resolution refused %s %j in plain words', async (code, details, words) => {
    const api = fakeApi();
    api.disputes.resolve.mutate.mockRejectedValue(refusal(code, details));
    const box = await resolution(api);
    fireEvent.click(box.getByRole('radio', { name: ar('admin.disputes.detail.suspendParty') }));
    fireEvent.click(
      box.getByRole('radio', {
        name: ar('admin.disputes.detail.partyStudent', { name: 'آمال علي' }),
      }),
    );
    writeReason(box, 'admin.disputes.detail.notesLabel', 'إساءة في المحادثة');
    fireEvent.click(box.getByRole('button', { name: ar('admin.disputes.detail.issue') }));
    expect(await box.findByText(ar(words))).toBeTruthy();
  });

  it('offers no resolution once the dispute is not open', async () => {
    open(fakeApi(), `/disputes?dispute=${D3}`);
    const aside = await detail();
    expect(aside.queryByRole('button', { name: ar('admin.disputes.detail.issue') })).toBeNull();
  });
});

/** Opens the revision's dialog on the resolved dispute. */
async function revision(api = fakeApi()) {
  open(api, `/disputes?dispute=${D3}`);
  const aside = await detail();
  fireEvent.click(aside.getByRole('button', { name: ar('admin.disputes.view.reviseButton') }));
  return { aside, box: await dialog(ar('admin.disputes.revise.title')) };
}

/** Chooses `outcome`, writes `reason`, and presses the revision. */
function revise(box: Box, outcome: MessageKey, reason: string): void {
  fireEvent.click(box.getByRole('radio', { name: ar(outcome) }));
  writeReason(box, 'admin.disputes.revise.reasonLabel', reason);
  fireEvent.click(box.getByRole('button', { name: ar('admin.disputes.view.reviseButton') }));
}

const REVISED = {
  disputeId: D3,
  sessionStatus: 'done',
  previousStatus: 'both_no_show',
  notUndone: ['party_suspended', 'enrollment_ended'],
};

describe('a ruling’s revision (FR-472; SRS FR-DISPUTE-7)', () => {
  it('shows the earlier ruling and its revisions beside the button, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/disputes?dispute=${D3}`),
      async (t, locale) => {
        const aside = await detail(t);
        const zone = panelTimeZone();
        expect(aside.getByText(t('admin.disputes.state.resolved'))).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.view.rulingTitle'))).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.ruling.no_show_recorded'))).toBeTruthy();
        expect(aside.getByText('السجل يثبت غياب المعلم')).toBeTruthy();
        expect(
          aside.getByText(
            t('admin.disputes.view.rulingAt', {
              date: dayMonth(RESOLVED_DETAIL.dispute.resolvedAt, locale, zone),
              time: timeOfDay(RESOLVED_DETAIL.dispute.resolvedAt, locale, zone),
            }),
          ),
        ).toBeTruthy();
        expect(
          aside.getByText(
            t('admin.disputes.view.revision', {
              before: t('admin.status.session.teacherNoShow'),
              after: t('admin.status.session.bothNoShow'),
              date: dayMonth('2026-11-03T11:00:00.000Z', locale, zone),
              time: timeOfDay('2026-11-03T11:00:00.000Z', locale, zone),
            }),
          ),
        ).toBeTruthy();
        expect(
          aside.getByRole('button', { name: t('admin.disputes.view.reviseButton') }),
        ).toBeTruthy();
        fireEvent.click(aside.getByRole('button', { name: t('admin.disputes.view.reviseButton') }));
        const box = await dialog(t('admin.disputes.revise.title'));
        expect(box.getByText(t('admin.disputes.revise.effect'))).toBeTruthy();
        for (const outcome of [
          'admin.status.session.done',
          'admin.status.session.studentNoShow',
          'admin.status.session.teacherNoShow',
          'admin.status.session.bothNoShow',
        ] as const) {
          expect(box.getByRole('radio', { name: t(outcome) })).toBeTruthy();
        }
        expect(box.getByLabelText(t('admin.disputes.revise.reasonLabel'))).toBeTruthy();
        sayNothingFinal();
      },
    );
  });

  it('says a ruling not yet revised', async () => {
    const api = fakeApi();
    api.disputes.get.query.mockResolvedValue({ ...RESOLVED_DETAIL, revisions: [] });
    open(api, `/disputes?dispute=${D3}`);
    const aside = await detail();
    expect(aside.getByText(ar('admin.disputes.view.revisionsNone'))).toBeTruthy();
  });

  it('offers no revision while the server says it is not revisable', async () => {
    const api = fakeApi();
    api.disputes.get.query.mockResolvedValue({ ...RESOLVED_DETAIL, revisable: false });
    open(api, `/disputes?dispute=${D3}`);
    const aside = await detail();
    expect(aside.getByText(ar('admin.disputes.view.rulingTitle'))).toBeTruthy();
    expect(
      aside.queryByRole('button', { name: ar('admin.disputes.view.reviseButton') }),
    ).toBeNull();
  });

  it('sends nothing without an outcome, or with a blank reason', async () => {
    const api = fakeApi();
    const { box } = await revision(api);
    const confirm = box.getByRole('button', { name: ar('admin.disputes.view.reviseButton') });
    writeReason(box, 'admin.disputes.revise.reasonLabel', 'خطأ في الحكم');
    fireEvent.click(confirm);
    fireEvent.click(box.getByRole('radio', { name: ar('admin.status.session.done') }));
    writeReason(box, 'admin.disputes.revise.reasonLabel', '   ');
    fireEvent.click(confirm);
    await settle();
    expect(api.disputes.revise.mutate).not.toHaveBeenCalled();
  });

  it('sends the outcome, the reason trimmed and a key, then says the answer and what stays as it was, in both languages', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.disputes.revise.mutate.mockResolvedValue(REVISED);
        return { ...open(api, `/disputes?dispute=${D3}`), api };
      },
      async (t) => {
        const aside = await detail(t);
        fireEvent.click(aside.getByRole('button', { name: t('admin.disputes.view.reviseButton') }));
        const box = await dialog(t('admin.disputes.revise.title'));
        fireEvent.click(box.getByRole('radio', { name: t('admin.status.session.done') }));
        fireEvent.change(box.getByLabelText(t('admin.disputes.revise.reasonLabel')), {
          target: { value: '  الحضور ثابت  ' },
        });
        fireEvent.click(box.getByRole('button', { name: t('admin.disputes.view.reviseButton') }));
        expect(
          await aside.findByText(
            t('admin.disputes.revise.done', {
              after: t('admin.status.session.done'),
              before: t('admin.status.session.bothNoShow'),
            }),
          ),
        ).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.revise.notUndone.party_suspended'))).toBeTruthy();
        expect(aside.getByText(t('admin.disputes.revise.notUndone.enrollment_ended'))).toBeTruthy();
        expect(aside.queryByText(t('admin.disputes.revise.notUndone.party_banned'))).toBeNull();
        sayNothingFinal();
      },
    );
  });

  it('sends the dispute, the outcome, the reason trimmed and the key', async () => {
    const api = fakeApi();
    api.disputes.revise.mutate.mockResolvedValue(REVISED);
    const { aside, box } = await revision(api);
    revise(box, 'admin.status.session.done', '  الحضور ثابت  ');
    await aside.findByText(
      ar('admin.disputes.revise.done', {
        after: ar('admin.status.session.done'),
        before: ar('admin.status.session.bothNoShow'),
      }),
    );
    expect(api.disputes.revise.mutate).toHaveBeenCalledWith({
      disputeId: D3,
      outcome: 'done',
      reason: 'الحضور ثابت',
      idempotencyKey: expect.stringMatching(KEY),
    });
  });

  it('mints the key when the dialog opens and reuses it on its retry; another dialog mints another', async () => {
    const api = fakeApi();
    api.disputes.revise.mutate
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(REVISED)
      .mockResolvedValueOnce(REVISED);
    const { aside, box } = await revision(api);
    revise(box, 'admin.status.session.done', 'الحضور ثابت');
    expect(await box.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: ar('admin.disputes.view.reviseButton') }));
    await waitFor(() => expect(api.disputes.revise.mutate).toHaveBeenCalledTimes(2));
    const keys = () =>
      api.disputes.revise.mutate.mock.calls.map(
        (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
      );
    expect(keys()[0]).toMatch(KEY);
    expect(keys()[1]).toBe(keys()[0]);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: ar('admin.disputes.revise.title') })).toBeNull(),
    );
    fireEvent.click(
      await aside.findByRole('button', { name: ar('admin.disputes.view.reviseButton') }),
    );
    const again = await dialog(ar('admin.disputes.revise.title'));
    revise(again, 'admin.status.session.done', 'الحضور ثابت');
    await waitFor(() => expect(api.disputes.revise.mutate).toHaveBeenCalledTimes(3));
    expect(keys()[2]).toMatch(KEY);
    expect(keys()[2]).not.toBe(keys()[0]);
  });

  it.each([
    [
      'RULING_FINAL',
      [{ path: 'cause', code: 'window_closed' }],
      'admin.disputes.revise.refused.windowClosed',
    ],
    [
      'RULING_FINAL',
      [{ path: 'cause', code: 'remedy_offered' }],
      'admin.disputes.revise.refused.remedyOffered',
    ],
    ['RULING_FINAL', [], 'admin.disputes.revise.refused.notNow'],
    ['RULING_SUPERSEDED', [], 'admin.disputes.revise.refused.superseded'],
    ['DISPUTE_OPEN', [], 'admin.disputes.revise.refused.disputeOpen'],
    ['SESSION_UNDER_REVIEW', [], 'admin.disputes.revise.refused.underReview'],
    ['CONFLICT', [], 'admin.disputes.revise.refused.keyReused'],
    ['NOT_FOUND', [], 'admin.disputes.revise.refused.notFound'],
    ['INTERNAL', [], 'admin.dialogs.submitError'],
  ] as const)('says a revision refused %s %j in plain words', async (code, details, words) => {
    const api = fakeApi();
    api.disputes.revise.mutate.mockRejectedValue(refusal(code, details));
    const { box } = await revision(api);
    revise(box, 'admin.status.session.done', 'الحضور ثابت');
    expect(await box.findByText(ar(words))).toBeTruthy();
    sayNothingFinal();
  });
});

describe('T058: RATE_LIMITED on /disputes', () => {
  const limited = (seconds?: string) =>
    refusal('RATE_LIMITED', seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }]);

  it('the queue says when to try again', async () => {
    const api = fakeApi();
    api.disputes.list.query.mockRejectedValue(limited('61'));
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('a dispute’s read says to wait a little when no time is given', async () => {
    const api = fakeApi();
    api.disputes.get.query.mockRejectedValue(limited());
    open(api, `/disputes?dispute=${D1}`);
    const aside = within(
      await screen.findByRole('complementary', { name: ar('admin.disputes.detail.a11y') }),
    );
    expect(await aside.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(aside.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('the chat read says when to try again', async () => {
    const api = fakeApi();
    api.disputes.chat.query.mockRejectedValue(limited('31'));
    open(api, `/disputes?dispute=${D1}`);
    const aside = await detail();
    expect(await aside.findByText(ar('admin.common.rateLimitedIn', { count: 1 }))).toBeTruthy();
    expect(aside.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('the resolution says when to try again', async () => {
    const api = fakeApi();
    api.disputes.resolve.mutate.mockRejectedValue(limited('120'));
    const box = await resolution(api);
    fireEvent.click(box.getByRole('radio', { name: ar('admin.disputes.detail.suspendParty') }));
    fireEvent.click(
      box.getByRole('radio', {
        name: ar('admin.disputes.detail.partyStudent', { name: 'آمال علي' }),
      }),
    );
    writeReason(box, 'admin.disputes.detail.notesLabel', 'إساءة في المحادثة');
    fireEvent.click(box.getByRole('button', { name: ar('admin.disputes.detail.issue') }));
    expect(await box.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(box.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });

  it('the revision says when to try again (rate_limit_dispute_revision)', async () => {
    const api = fakeApi();
    api.disputes.revise.mutate.mockRejectedValue(limited('61'));
    const { box } = await revision(api);
    revise(box, 'admin.status.session.done', 'الحضور ثابت');
    expect(await box.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(box.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
    sayNothingFinal();
  });
});
