// T044 of specs/004-sessions (FR-465, FR-494, FR-495): the teacher's answer to a counter-proposal,
// a teacher-only panel on the session's screen, in Arabic and English. While `sessions.get`'s
// remedy has a counter-proposal pending, the panel draws its time and its answer window's close,
// each in its own zone and the viewer's, and accepts or declines it through
// `sessions.remedy.answerCounter`; the decline says what FR-465 says it does. Nothing for any other
// remedy. `REMEDY_NOT_OPEN` is said in plain words and stays said once the session, read again,
// has no counter left; any other failure is `genericErrorKey`'s.
import type { MeOutput, RemedyView, SessionsGetOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cityOf } from '@ijazah/time/cities';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatTime, formatWeekdayDate } from '../../../lib/formatters';
import { apiError } from '../../shared/__tests__/api-double';
import { sessionQueryKey } from '../../shared/room';
import { CAIRO, DUBAI, roomApi, SESSION_ID, session } from '../../shared/room/__tests__/room-api';
import { CounterAnswerPanel } from './index';

/** `useApi()`'s client with `sessions.remedy.answerCounter` beside `sessions.get`. */
function answerApi() {
  const room = roomApi();
  const remedy = {
    answerCounter: { mutate: jest.fn<(input: unknown) => Promise<RemedyView>>() },
  };
  const sessions = { ...room.sessions, remedy };
  const api = { ...room.api, sessions };
  return { sessions, remedy, value: { ...room.value, client: { ...room.value.client, api } } };
}

let mockApi = answerApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

/** The teacher lives in Dubai; the session and the counter-proposal are Cairo's. */
const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: DUBAI } as MeOutput;

const COUNTER = {
  localDate: '2026-12-05',
  startTimeLocal: '10:00',
  timezone: CAIRO,
  startsAt: '2026-12-05T08:00:00.000Z',
  answerClosesAt: '2026-11-20T10:00:00.000Z',
};

function remedy(of: Partial<RemedyView> = {}): RemedyView {
  return {
    status: 'counter_proposed',
    kind: 'makeup',
    offeredAt: '2026-11-14T16:45:00.000Z',
    choiceClosesAt: '2026-11-21T16:45:00.000Z',
    proposal: {
      localDate: '2026-12-02',
      startTimeLocal: '18:00',
      timezone: CAIRO,
      startsAt: '2026-12-02T16:00:00.000Z',
    },
    counter: COUNTER,
    canChooseRefund: false,
    ...of,
  };
}

const read = (of: Partial<RemedyView> | undefined): SessionsGetOutput =>
  session({
    status: 'teacher_no_show',
    ...(of === undefined ? {} : { remedy: remedy(of) }),
  });

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);

/** An instant as the zone lines write it in `zone` (FR-494). */
const timeIn = (direction: Direction, instant: string, zone: string) => {
  const locale = localeOf(direction);
  return said(direction, 'session.pre.timeIn', {
    date: formatWeekdayDate(instant, zone, locale),
    time: formatTime(instant, zone, locale),
    city: cityOf(zone, locale) ?? zone,
  });
};

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <CounterAnswerPanel sessionId={SESSION_ID} />
  </QueryClientProvider>
);
const press = (key: MessageKey) => fireEvent.press(screen.getByRole('button', { name: ar(key) }));

beforeEach(() => {
  mockApi = answerApi();
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

describe('CounterAnswerPanel (FR-465, FR-494)', () => {
  it('draws the pending counter-proposal and its answer window’s close in both zones, with accept and decline', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({}));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'teacher.counter.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.counter.proposal'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.counter.answerClosesAt'))).toBeTruthy();
      for (const instant of [COUNTER.startsAt, COUNTER.answerClosesAt]) {
        expect(screen.getByText(timeIn(direction, instant, CAIRO))).toBeTruthy();
        expect(screen.getByText(timeIn(direction, instant, DUBAI))).toBeTruthy();
      }
      expect(screen.getByText(said(direction, 'teacher.counter.text'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'teacher.counter.declineNote'))).toBeTruthy();
      expect(
        screen.getByRole('button', { name: said(direction, 'teacher.counter.accept') }),
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: said(direction, 'teacher.counter.decline') }),
      ).toBeTruthy();
    });
  });

  it('draws nothing without a pending counter-proposal, whatever else the remedy carries', async () => {
    const shapes: (Partial<RemedyView> | undefined)[] = [
      undefined,
      { status: 'awaiting_choice', counter: undefined, canChooseRefund: true },
      { status: 'proposed', counter: undefined },
      // A counter on a remedy no longer counter_proposed is not pending (FR-465).
      { status: 'proposed' },
      { status: 'frozen', counter: undefined, proposal: undefined },
      { status: 'booked', counter: undefined },
      { status: 'refund_case', kind: 'refund', counter: undefined },
      { status: 'counter_proposed', counter: undefined },
    ];
    for (const shape of shapes) {
      mockApi.sessions.get.query.mockResolvedValue(read(shape));
      const rendered = await renderIn('rtl', ui());
      // This read's own answer, not an earlier case's call.
      await waitFor(() =>
        expect(queries.getQueryState(sessionQueryKey(SESSION_ID))?.status).toBe('success'),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByText(ar('teacher.counter.title'))).toBeNull();
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      await rendered.unmount();
      queries.removeQueries({ queryKey: ['sessions'] });
    }
  });

  it('accepts or declines through answerCounter, then reads the session again', async () => {
    for (const [key, accept] of [
      ['teacher.counter.accept', true],
      ['teacher.counter.decline', false],
    ] as const) {
      mockApi.sessions.get.query.mockResolvedValue(read({}));
      mockApi.remedy.answerCounter.mutate.mockResolvedValue(
        remedy({ status: accept ? 'booked' : 'proposed', counter: undefined }),
      );
      const rendered = await renderIn('rtl', ui());
      await screen.findByText(ar('teacher.counter.title'));
      const readsBefore = mockApi.sessions.get.query.mock.calls.length;
      await press(key);
      expect(mockApi.remedy.answerCounter.mutate).toHaveBeenLastCalledWith({
        sessionId: SESSION_ID,
        accept,
      });
      await waitFor(() =>
        expect(mockApi.sessions.get.query.mock.calls.length).toBeGreaterThan(readsBefore),
      );
      await rendered.unmount();
      queries.removeQueries({ queryKey: ['sessions'] });
    }
  });

  it('says REMEDY_NOT_OPEN in plain words, still said once the session read again has no counter', async () => {
    mockApi.remedy.answerCounter.mutate.mockRejectedValue(apiError('REMEDY_NOT_OPEN'));
    for (const direction of ['rtl', 'ltr'] as const) {
      mockApi.sessions.get.query
        .mockReset()
        .mockResolvedValueOnce(read({}))
        .mockResolvedValue(read({ status: 'proposed', counter: undefined }));
      const rendered = await renderIn(direction, ui());
      await fireEvent.press(
        await screen.findByRole('button', { name: said(direction, 'teacher.counter.accept') }),
      );
      expect(await screen.findByText(said(direction, 'teacher.counter.notOpen'))).toBeTruthy();
      await waitFor(() =>
        expect(screen.queryByText(said(direction, 'teacher.counter.title'))).toBeNull(),
      );
      expect(mockApi.sessions.get.query.mock.calls.length).toBeGreaterThan(1);
      expect(screen.getByText(said(direction, 'teacher.counter.notOpen'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.state.actionError'))).toBeNull();
      await rendered.unmount();
      queries.removeQueries({ queryKey: ['sessions'] });
    }
  });

  it('a RATE_LIMITED answer says when to try again; any other failure is the generic one', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({}));
    mockApi.remedy.answerCounter.mutate
      .mockRejectedValueOnce(apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '120' }]))
      .mockRejectedValueOnce(apiError('MAKEUP_REFUSED'))
      .mockRejectedValueOnce(new Error('network'));
    await renderIn('rtl', ui());
    await screen.findByText(ar('teacher.counter.title'));
    await press('teacher.counter.decline');
    expect(await screen.findByText(ar('common.state.rateLimitedIn', { count: 2 }))).toBeTruthy();
    await press('teacher.counter.accept');
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    const readsBefore = mockApi.sessions.get.query.mock.calls.length;
    await press('teacher.counter.accept');
    await waitFor(() => expect(mockApi.remedy.answerCounter.mutate).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    // An answer that never reached the server reads nothing again.
    expect(mockApi.sessions.get.query.mock.calls.length).toBe(readsBefore);
  });
});
