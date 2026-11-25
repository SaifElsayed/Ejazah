// 006:T020 (FR-705, FR-706b, FR-723, FR-726; SRS DEC-112; B-P4's conflict check, Q-2 (a), Q-3 (a)):
// the teacher's programme on `TeacherEnrollment`, in Arabic and English, read from `programme.get`
// only for an enrollment the read marks as a programme. After the delivered assessment, while
// awaiting the offer: the offer form (level, readiness, expected length, each 1 to 500; the session
// length; the count 1 to 200), its deadline as a date and a time, the total and the months as
// `packages/money` computes them from the teacher's price for the length; the offer sent keyed, each
// refusal in its own words. Never the form before the assessment is delivered or once the offer is
// sent. Once offered, the offer as sent; while `payBlocked`, the administration's line. While it
// runs, the months paid and the next due; while paused, «late since». The stop request only from the
// server's `stopRequestFrom` on (none while it is null, none before it, the button drawn when the
// instant comes on an open screen): a reason form (1 to 500), `programme.request` kind `stop`, each
// refusal in its own words. No refusal button and no hint anywhere (SRS DEC-112).
import type {
  MeOutput,
  ProgrammeGetOutput,
  TeacherPackage,
  TeacherStudentsGetOutput,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters } from '@ijazah/money';
import { addSeconds } from '@ijazah/time';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import {
  inBothDirections,
  nodesOf,
  renderIn,
  unmarked,
} from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatDate, formatNumber, formatPounds, formatTime } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { TeacherEnrollment } from '../students';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ enrollmentId: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => undefined) }));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `programme-key-${++mockKey}` }));

const CAIRO = 'Africa/Cairo';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const STUDENT = 'يوسف أحمد';
/** The phone's clock is real here: an instant long past, and one far ahead. */
const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const OFFER_DUE = '2026-11-20T18:30:00.000Z';
const PAY_BY = '2026-11-25T16:00:00.000Z';
const NEXT_DUE = '2026-12-21T18:00:00.000Z';
const SINCE = '2026-12-21T18:00:00.000Z';

const assessment = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-19',
  startTimeLocal: '20:00',
  timezone: CAIRO,
  startsAt: '2026-11-19T18:00:00.000Z',
  endsAt: '2026-11-19T18:30:00.000Z',
  status: 'done' as const,
  pendingCancellation: false,
  disputed: false,
};

function enrollment(of: Partial<TeacherStudentsGetOutput> = {}): TeacherStudentsGetOutput {
  return {
    enrollmentId: ENROLLMENT_ID,
    student: {
      studentId: '0193a6f0-0000-7000-8000-0000000000b9',
      displayName: STUDENT,
      displayNameOrNull: STUDENT,
      deleted: false,
    },
    summary: { subject: QURAN, track: 'ijazah_track', sessionCount: 1, sessionDurationMinutes: 30 },
    status: 'confirmed',
    paused: false,
    last: assessment,
    upcoming: 0,
    completed: 1,
    remaining: 0,
    sessions: [assessment],
    ijazahRequest: null,
    programme: { state: 'awaiting_offer', payBy: null, payReminderFrom: null },
    ...of,
  };
}
/** An ijazah-track enrollment that is no programme: no marker. */
const { programme: _marker, ...notAProgramme } = enrollment();

const OFFER = {
  level: 'حافظ لعشرة أجزاء',
  readiness: 'جاهز للإجازة بعد المراجعة',
  expectedLength: 'سنة تقريبًا',
  durationMinutes: 60,
  sessionCount: 40,
  total_piasters: 1_000_000,
  sessionPrice_piasters: 25_000,
  offeredAt: '2026-11-23T16:00:00.000Z',
} as const;

function programme(of: Partial<ProgrammeGetOutput> = {}): ProgrammeGetOutput {
  return {
    state: 'awaiting_offer',
    offerDueAt: OFFER_DUE,
    payBy: null,
    offer: null,
    plan: null,
    monthsPaid: 0,
    monthCount: null,
    nextDueAt: null,
    paused: null,
    renewOpen: false,
    chargePending: false,
    payeePending: false,
    payBlocked: false,
    teacherUnavailable: false,
    card: null,
    stopRequestFrom: null,
    payReminderFrom: null,
    ...of,
  };
}
const offered = (of: Partial<ProgrammeGetOutput> = {}) =>
  programme({ state: 'offered', offer: OFFER, payBy: PAY_BY, monthCount: 10, ...of });
const paused = (of: Partial<ProgrammeGetOutput> = {}) =>
  programme({
    state: 'paused',
    offer: OFFER,
    payBy: PAY_BY,
    plan: 'monthly',
    monthsPaid: 2,
    monthCount: 10,
    nextDueAt: NEXT_DUE,
    paused: { since: SINCE },
    ...of,
  });

const programmePackage: TeacherPackage = {
  id: '0193a6f0-0000-7000-8000-0000000000c1',
  subject: QURAN,
  track: 'ijazah_track',
  isProgramme: true,
  prices: { m30_piasters: 15_000, m45_piasters: 20_000, m60_piasters: 25_000 },
  isActive: true,
  activeEnrollmentCount: 1,
  frozen: true,
};

const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: CAIRO } as MeOutput;
const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);
const when = (direction: Direction, instant: string) =>
  said(direction, 'common.format.dateTime', {
    date: formatDate(instant, CAIRO, localeOf(direction)),
    time: formatTime(instant, CAIRO, localeOf(direction)),
  });
const button = (direction: Direction, key: MessageKey) =>
  screen.queryByRole('button', { name: said(direction, key) });
const typeIn = async (direction: Direction, label: MessageKey, text: string) =>
  fireEvent.changeText(screen.getByLabelText(said(direction, label)), text);
const get = () => mockApi.api.programme.get.query;
const offer = () => mockApi.api.programme.offer.mutate;
const request = () => mockApi.api.programme.request.mutate;

let queries: QueryClient;
const ui = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <TeacherEnrollment />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockKey = 0;
  mockApi.api.teacher.students.get.query.mockResolvedValue(enrollment());
  mockApi.api.teacher.packages.list.query.mockResolvedValue({
    published: true,
    packages: [programmePackage],
  });
  offer().mockResolvedValue({
    total_piasters: 1_000_000,
    sessionPrice_piasters: 25_000,
    monthCount: 10,
  });
  request().mockResolvedValue({ requestId: '0193a6f0-0000-7000-8000-0000000000f9' });
  Object.assign(mockApi.api.teacher, {
    ijazahRequests: { preview: { query: jest.fn() }, send: { mutate: jest.fn() } },
  });
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

/** The panel has drawn: its title. */
const shown = async (direction: Direction) =>
  expect(await screen.findByText(said(direction, 'programme.teacher.title'))).toBeTruthy();

/** Every word the screen draws or reads out (texts and accessibility labels), its marks taken out. */
const everyWord = (rendered: Parameters<typeof nodesOf>[0]): string[] =>
  nodesOf(rendered)
    .flatMap((node) => [
      ...(node.children ?? []).filter((child): child is string => typeof child === 'string'),
      ...(typeof node.props['accessibilityLabel'] === 'string'
        ? [node.props['accessibilityLabel']]
        : []),
    ])
    .map(unmarked);

/** Words a refusal button or hint would carry (SRS DEC-112: none in the app). */
const REFUSAL_WORDS = /رفض|رافض|يرفض|refus|declin|reject|الدعم|support/i;

describe('the marker (Q-3 (a))', () => {
  it('no programme panel on an enrollment without the marker: programme.get is never read', async () => {
    mockApi.api.teacher.students.get.query.mockResolvedValue(notAProgramme);
    get().mockResolvedValue(programme());
    await renderIn('rtl', ui());
    expect(await screen.findByText(STUDENT)).toBeTruthy();
    expect(screen.queryByText(ar('programme.teacher.title'))).toBeNull();
    expect(get()).not.toHaveBeenCalled();
  });
});

describe('the offer (FR-705)', () => {
  it('shows the form after the delivered assessment: its fields and the deadline as a date and a time', async () => {
    get().mockResolvedValue(programme());
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(
        screen.getByText(said(direction, 'programme.teacher.state.awaiting_offer')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'programme.teacher.offer.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'programme.teacher.offer.lede'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.teacher.offer.dueBy', { when: when(direction, OFFER_DUE) }),
        ),
      ).toBeTruthy();
      for (const label of [
        'programme.teacher.offer.level',
        'programme.teacher.offer.readiness',
        'programme.teacher.offer.expectedLength',
        'programme.teacher.offer.sessionCount',
      ] as const) {
        expect(screen.getByLabelText(said(direction, label))).toBeTruthy();
      }
      for (const minutes of [30, 45, 60]) {
        expect(
          screen.getByRole('radio', {
            name: said(direction, 'teacher.packages.editor.durationOption', { minutes }),
          }),
        ).toBeTruthy();
      }
      expect(button(direction, 'programme.teacher.offer.send')).toBeTruthy();
    });
  });

  it('shows the total and the months as packages/money computes them, from the price for the length', async () => {
    get().mockResolvedValue(programme());
    await inBothDirections(ui, async (_rendered, direction) => {
      const locale = localeOf(direction);
      await shown(direction);
      await fireEvent.press(
        screen.getByRole('radio', {
          name: said(direction, 'teacher.packages.editor.durationOption', { minutes: 60 }),
        }),
      );
      await typeIn(direction, 'programme.teacher.offer.sessionCount', '42');
      expect(screen.getByText(formatPounds(piasters(1_050_000), locale))).toBeTruthy();
      expect(screen.getByText(formatNumber(11, locale))).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('radio', {
          name: said(direction, 'teacher.packages.editor.durationOption', { minutes: 30 }),
        }),
      );
      expect(screen.getByText(formatPounds(piasters(630_000), locale))).toBeTruthy();
    });
  });

  it('sends the offer keyed, with the texts trimmed, and reads the enrollment again', async () => {
    get().mockResolvedValue(programme());
    await renderIn('rtl', ui());
    await shown('rtl');
    await typeIn('rtl', 'programme.teacher.offer.level', `  ${OFFER.level} `);
    await typeIn('rtl', 'programme.teacher.offer.readiness', OFFER.readiness);
    await typeIn('rtl', 'programme.teacher.offer.expectedLength', OFFER.expectedLength);
    await fireEvent.press(
      screen.getByRole('radio', {
        name: ar('teacher.packages.editor.durationOption', { minutes: 60 }),
      }),
    );
    await typeIn('rtl', 'programme.teacher.offer.sessionCount', '٤٠');
    const reads = get().mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: ar('programme.teacher.offer.send') }));
    await waitFor(() =>
      expect(offer()).toHaveBeenCalledWith({
        enrollmentId: ENROLLMENT_ID,
        level: OFFER.level,
        readiness: OFFER.readiness,
        expectedLength: OFFER.expectedLength,
        durationMinutes: 60,
        sessionCount: 40,
        idempotencyKey: 'programme-key-1',
      }),
    );
    await waitFor(() => expect(get().mock.calls.length).toBeGreaterThan(reads));
  });

  it('cannot send with a blank text or a count outside 1 to 200', async () => {
    get().mockResolvedValue(programme());
    await renderIn('rtl', ui());
    await shown('rtl');
    await typeIn('rtl', 'programme.teacher.offer.level', OFFER.level);
    await typeIn('rtl', 'programme.teacher.offer.readiness', '   ');
    await typeIn('rtl', 'programme.teacher.offer.expectedLength', OFFER.expectedLength);
    await typeIn('rtl', 'programme.teacher.offer.sessionCount', '40');
    const send = () => screen.getByRole('button', { name: ar('programme.teacher.offer.send') });
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await typeIn('rtl', 'programme.teacher.offer.readiness', OFFER.readiness);
    await typeIn('rtl', 'programme.teacher.offer.sessionCount', '201');
    expect(
      screen.getByText(ar('programme.teacher.offer.countError', { min: 1, max: 200 })),
    ).toBeTruthy();
    expect(send().props.accessibilityState).toMatchObject({ disabled: true });
    await typeIn('rtl', 'programme.teacher.offer.sessionCount', '200');
    expect(send().props.accessibilityState).not.toMatchObject({ disabled: true });
  });

  it('says each refusal of programme.offer in its own words', async () => {
    get().mockResolvedValue(programme());
    const words: Record<string, string> = {
      assessment_not_delivered: ar('programme.teacher.offer.refusal.assessment_not_delivered'),
      not_awaiting_offer: ar('programme.teacher.offer.refusal.not_awaiting_offer'),
      offer_due_passed: ar('programme.teacher.offer.refusal.offer_due_passed'),
      length_exceeds_slot: ar('programme.teacher.offer.refusal.length_exceeds_slot'),
      count_out_of_bounds: ar('programme.teacher.offer.countError', { min: 1, max: 200 }),
      teacher_not_active: ar('programme.teacher.offer.refusal.teacher_not_active'),
    };
    for (const [cause, line] of Object.entries(words)) {
      offer().mockRejectedValueOnce(apiError('CONFLICT', [{ path: 'cause', code: cause }]));
      const rendered = await renderIn('rtl', ui());
      await shown('rtl');
      await typeIn('rtl', 'programme.teacher.offer.level', OFFER.level);
      await typeIn('rtl', 'programme.teacher.offer.readiness', OFFER.readiness);
      await typeIn('rtl', 'programme.teacher.offer.expectedLength', OFFER.expectedLength);
      await typeIn('rtl', 'programme.teacher.offer.sessionCount', '40');
      await fireEvent.press(
        screen.getByRole('button', { name: ar('programme.teacher.offer.send') }),
      );
      expect(await screen.findByText(line)).toBeTruthy();
      await rendered.unmount();
    }
  });

  it('no offer form before the assessment is delivered', async () => {
    get().mockResolvedValue(programme({ offerDueAt: null }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(
        screen.getByText(said(direction, 'programme.teacher.state.awaiting_offer')),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'programme.teacher.offer.title'))).toBeNull();
      expect(button(direction, 'programme.teacher.offer.send')).toBeNull();
    });
  });

  it('no offer form when not awaiting_offer: the offer as sent, its total, months and the student’s deadline', async () => {
    get().mockResolvedValue(offered());
    await inBothDirections(ui, async (_rendered, direction) => {
      const locale = localeOf(direction);
      await shown(direction);
      expect(screen.queryByText(said(direction, 'programme.teacher.offer.title'))).toBeNull();
      expect(button(direction, 'programme.teacher.offer.send')).toBeNull();
      expect(screen.getByText(said(direction, 'programme.teacher.state.offered'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'programme.teacher.sent.title'))).toBeTruthy();
      expect(screen.getByText(OFFER.level)).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'common.format.packageLine', { count: 40, minutes: 60 })),
      ).toBeTruthy();
      expect(screen.getByText(formatPounds(piasters(1_000_000), locale))).toBeTruthy();
      expect(screen.getByText(formatNumber(10, locale))).toBeTruthy();
      expect(screen.getByText(when(direction, PAY_BY))).toBeTruthy();
    });
  });

  it('while payBlocked: the line that the offer is with the administration', async () => {
    get().mockResolvedValue(offered({ payBlocked: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.teacher.payBlocked'))).toBeTruthy();
    });
  });

  it('no payBlocked line while the administration is not deciding', async () => {
    get().mockResolvedValue(offered());
    await renderIn('rtl', ui());
    await shown('rtl');
    expect(screen.queryByText(ar('programme.teacher.payBlocked'))).toBeNull();
  });
});

describe('a running programme (FR-726)', () => {
  it('shows the months paid and the next due; paused, «late since» when', async () => {
    get().mockResolvedValue(paused());
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.teacher.state.paused'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'programme.teacher.months', { paid: 2, count: 10 })),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.teacher.nextDue', { when: when(direction, NEXT_DUE) }),
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.teacher.lateSince', { when: when(direction, SINCE) }),
        ),
      ).toBeTruthy();
    });
  });

  it('no «late since» while active', async () => {
    get().mockResolvedValue(paused({ state: 'active', paused: null }));
    await renderIn('rtl', ui());
    await shown('rtl');
    expect(screen.getByText(ar('programme.teacher.months', { paid: 2, count: 10 }))).toBeTruthy();
    expect(
      screen.queryByText(ar('programme.teacher.lateSince', { when: when('rtl', SINCE) })),
    ).toBeNull();
  });
});

describe('the stop request (FR-723, SRS DEC-112, Q-2 (a))', () => {
  it('no stop button when stopRequestFrom is null', async () => {
    get().mockResolvedValue(paused({ stopRequestFrom: null }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(button(direction, 'programme.teacher.stop.action')).toBeNull();
    });
  });

  it('no stop button before stopRequestFrom', async () => {
    get().mockResolvedValue(paused({ stopRequestFrom: FUTURE }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(button(direction, 'programme.teacher.stop.action')).toBeNull();
    });
  });

  it('draws the button when stopRequestFrom comes on an open screen', async () => {
    get().mockResolvedValue(paused({ stopRequestFrom: addSeconds(new Date(), 2) }));
    await renderIn('rtl', ui());
    await shown('rtl');
    expect(button('rtl', 'programme.teacher.stop.action')).toBeNull();
    expect(
      await screen.findByRole(
        'button',
        { name: ar('programme.teacher.stop.action') },
        { timeout: 4_000 },
      ),
    ).toBeTruthy();
  });

  it('from stopRequestFrom on: the button opens the reason form, sends kind stop keyed, and says it was sent', async () => {
    get().mockResolvedValue(paused({ stopRequestFrom: PAST }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'programme.teacher.stop.action') }),
      );
      expect(screen.getByText(said(direction, 'programme.teacher.stop.text'))).toBeTruthy();
      const send = screen.getByRole('button', {
        name: said(direction, 'programme.teacher.stop.send'),
      });
      expect(send.props.accessibilityState).toMatchObject({ disabled: true });
      await typeIn(direction, 'programme.teacher.stop.reason', 'الطالب متأخر منذ أسبوعين');
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'programme.teacher.stop.send') }),
      );
      expect(await screen.findByText(said(direction, 'programme.teacher.stop.sent'))).toBeTruthy();
    });
    expect(request()).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      kind: 'stop',
      reason: 'الطالب متأخر منذ أسبوعين',
      idempotencyKey: expect.stringMatching(/^programme-key-/),
    });
  });

  it('says each refusal of the stop request in its own words', async () => {
    get().mockResolvedValue(paused({ stopRequestFrom: PAST }));
    for (const cause of ['too_early', 'request_open', 'not_paused'] as const) {
      request().mockRejectedValueOnce(apiError('CONFLICT', [{ path: 'cause', code: cause }]));
      const rendered = await renderIn('rtl', ui());
      await shown('rtl');
      await fireEvent.press(
        screen.getByRole('button', { name: ar('programme.teacher.stop.action') }),
      );
      await typeIn('rtl', 'programme.teacher.stop.reason', 'سبب');
      await fireEvent.press(
        screen.getByRole('button', { name: ar('programme.teacher.stop.send') }),
      );
      expect(await screen.findByText(ar(`programme.teacher.stop.refusal.${cause}`))).toBeTruthy();
      await rendered.unmount();
    }
  });
});

describe('no refusal (SRS DEC-112)', () => {
  it('no refusal button or hint, in any state of the programme', async () => {
    for (const read of [
      programme(),
      programme({ offerDueAt: null }),
      offered(),
      offered({ payBlocked: true }),
      paused({ stopRequestFrom: PAST }),
      paused({ state: 'active', paused: null }),
    ]) {
      get().mockResolvedValue(read);
      await inBothDirections(ui, async (rendered, direction) => {
        await shown(direction);
        expect(everyWord(rendered).filter((text) => REFUSAL_WORDS.test(text))).toEqual([]);
      });
    }
    for (const [input] of request().mock.calls) {
      expect(input).toMatchObject({ kind: 'stop' });
    }
  });
});
