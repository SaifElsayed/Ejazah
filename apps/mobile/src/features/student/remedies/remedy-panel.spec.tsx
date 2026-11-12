// T043 of specs/004-sessions (FR-463 to FR-466, FR-494, FR-495; R-MOBILE-12; R-320): the student's
// remedy sheets on the session's screen, in Arabic and English. The panel draws what
// `sessions.get`'s `remedy` answers and nothing it decides itself: the choice of a make-up (accept
// the proposal, or counter-propose) or a refund where `canChooseRefund`; the proposal with the
// choice window's close; a pending counter-proposal with its answer window's close, the proposal
// still accepted while it is pending; every time in its own zone and the viewer's. The counter
// options are `sessions.remedy.counterOptions`' and the counter is keyed, one key per chosen option,
// kept for that option's retry. A refund carries no amount (SC-410). An answer the server refuses
// reads the session again, so the panel shows what the server holds; a failure with no words of
// its own is `genericErrorKey`'s.
import type {
  CounterOption,
  MeOutput,
  RemedyView,
  SessionsGetOutput,
  SessionsRemedyCounterOptionsOutput,
} from '@ijazah/contracts';
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
import { CAIRO, DUBAI, roomApi, SESSION_ID, session } from '../../shared/room/__tests__/room-api';
import { StudentRemedyPanel } from './index';

type Mutation = jest.Mock<(input: unknown) => Promise<RemedyView>>;

/** `useApi()`'s client with `sessions.remedy` beside `sessions.get`. */
function remedyApi() {
  const room = roomApi();
  const remedy = {
    choose: { mutate: jest.fn() as Mutation },
    accept: { mutate: jest.fn() as Mutation },
    counter: { mutate: jest.fn() as Mutation },
    counterOptions: {
      query: jest.fn<(input: unknown) => Promise<SessionsRemedyCounterOptionsOutput>>(),
    },
  };
  const sessions = { ...room.sessions, remedy };
  const api = { ...room.api, sessions };
  return { sessions, remedy, value: { ...room.value, client: { ...room.value.client, api } } };
}

let mockApi = remedyApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

let mockKeys = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => {
    mockKeys += 1;
    return `0193a6f0-0000-7000-8000-0000000009${String(mockKeys).padStart(2, '0')}`;
  },
}));

/** The student lives in Dubai; the session and its times are Cairo's. */
const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: DUBAI } as MeOutput;

const PROPOSAL = {
  localDate: '2026-12-02',
  startTimeLocal: '18:00',
  timezone: CAIRO,
  startsAt: '2026-12-02T16:00:00.000Z',
};
const COUNTER = {
  localDate: '2026-12-05',
  startTimeLocal: '10:00',
  timezone: CAIRO,
  startsAt: '2026-12-05T08:00:00.000Z',
  answerClosesAt: '2026-11-20T10:00:00.000Z',
};
const CHOICE_CLOSES = '2026-11-21T16:45:00.000Z';

function remedy(of: Partial<RemedyView> = {}): RemedyView {
  return {
    status: 'awaiting_choice',
    kind: 'makeup',
    offeredAt: '2026-11-14T16:45:00.000Z',
    choiceClosesAt: CHOICE_CLOSES,
    proposal: PROPOSAL,
    canChooseRefund: true,
    ...of,
  };
}

const read = (of: Partial<RemedyView> | undefined): SessionsGetOutput =>
  session({
    status: 'teacher_no_show',
    ...(of === undefined ? {} : { remedy: remedy(of) }),
  });

const OPTIONS: CounterOption[] = [
  {
    slotId: '0193a6f0-0000-7000-8000-0000000007a1',
    localDate: '2026-12-05',
    startTimeLocal: '10:00',
    timezone: CAIRO,
    startsAt: '2026-12-05T08:00:00.000Z',
  },
  {
    slotId: '0193a6f0-0000-7000-8000-0000000007a2',
    localDate: '2026-12-07',
    startTimeLocal: '19:30',
    timezone: CAIRO,
    startsAt: '2026-12-07T17:30:00.000Z',
  },
];

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
/** The instant in the session's zone and the viewer's. */
const expectBothZones = (direction: Direction, instant: string) => {
  expect(screen.getAllByText(timeIn(direction, instant, CAIRO)).length).toBeGreaterThan(0);
  expect(screen.getAllByText(timeIn(direction, instant, DUBAI)).length).toBeGreaterThan(0);
};

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <StudentRemedyPanel sessionId={SESSION_ID} />
  </QueryClientProvider>
);

const button = (direction: Direction, key: MessageKey) =>
  screen.queryByRole('button', { name: said(direction, key) });

beforeEach(() => {
  mockApi = remedyApi();
  mockKeys = 0;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
});

describe('the choice (FR-463)', () => {
  it('awaiting a choice with a refund owed: the proposal and the choice window’s close in both zones, accept, a counter and the refund', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({}));
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'student.remedy.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.remedy.text.choice'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.remedy.proposal'))).toBeTruthy();
      expectBothZones(direction, PROPOSAL.startsAt);
      expect(screen.getByText(said(direction, 'student.remedy.choiceClosesAt'))).toBeTruthy();
      expectBothZones(direction, CHOICE_CLOSES);
      expect(button(direction, 'student.remedy.accept')).toBeTruthy();
      expect(button(direction, 'student.remedy.proposeOther')).toBeTruthy();
      expect(button(direction, 'student.remedy.refund')).toBeTruthy();
    });
  });

  it('offers no refund where `canChooseRefund` is false, nor once the remedy is past its choice', async () => {
    for (const shape of [
      { canChooseRefund: false },
      { status: 'proposed', canChooseRefund: false },
      { status: 'proposed', canChooseRefund: true },
    ] as const) {
      mockApi.sessions.get.query.mockResolvedValue(read(shape));
      await inBothDirections(ui, async (_rendered, direction) => {
        expect(
          await screen.findByText(said(direction, 'student.remedy.text.proposed')),
        ).toBeTruthy();
        expect(button(direction, 'student.remedy.accept')).toBeTruthy();
        expect(button(direction, 'student.remedy.proposeOther')).toBeTruthy();
        expect(button(direction, 'student.remedy.refund')).toBeNull();
      });
      queries.removeQueries({ queryKey: ['sessions'] });
    }
  });

  it('a refund is chosen with no amount anywhere (SC-410), and the session read again', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({}));
    mockApi.remedy.choose.mutate.mockResolvedValue(remedy({ status: 'refund_case' }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await fireEvent.press(
        await screen.findByRole('button', { name: said(direction, 'student.remedy.refund') }),
      );
      expect(screen.getByText(said(direction, 'student.remedy.refundSheet.text'))).toBeTruthy();
      // Nothing priced: no pound, no figure but the times' own.
      expect(screen.queryByText(/EGP|E£|جنيه|ج\.م/)).toBeNull();
      expect(
        screen.queryByText(said(direction, 'student.makeupChoice.refund', { amount: '' })),
      ).toBeNull();
    });
    await renderIn('rtl', ui());
    await fireEvent.press(await screen.findByRole('button', { name: ar('student.remedy.refund') }));
    const readsBefore = mockApi.sessions.get.query.mock.calls.length;
    await fireEvent.press(
      screen.getByRole('button', { name: ar('student.remedy.refundSheet.confirm') }),
    );
    expect(mockApi.remedy.choose.mutate).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      choice: 'refund',
    });
    await waitFor(() =>
      expect(mockApi.sessions.get.query.mock.calls.length).toBeGreaterThan(readsBefore),
    );
    expect(screen.queryByText(ar('student.remedy.refundSheet.text'))).toBeNull();
  });
});

describe('the proposal and its acceptance (FR-464, FR-465, FR-466)', () => {
  it('accepts the proposal from the sheet, then reads the session again', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({ status: 'proposed' }));
    mockApi.remedy.accept.mutate.mockResolvedValue(
      remedy({ status: 'booked', makeupSessionId: '0193a6f0-0000-7000-8000-0000000000c9' }),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      await fireEvent.press(
        await screen.findByRole('button', { name: said(direction, 'student.remedy.accept') }),
      );
      expect(screen.getByText(said(direction, 'student.remedy.acceptSheet.text'))).toBeTruthy();
      expect(
        screen.queryByText(said(direction, 'student.remedy.acceptSheet.withdraws')),
      ).toBeNull();
    });
    await renderIn('rtl', ui());
    await fireEvent.press(await screen.findByRole('button', { name: ar('student.remedy.accept') }));
    const readsBefore = mockApi.sessions.get.query.mock.calls.length;
    await fireEvent.press(
      screen.getByRole('button', { name: ar('student.remedy.acceptSheet.confirm') }),
    );
    expect(mockApi.remedy.accept.mutate).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    await waitFor(() =>
      expect(mockApi.sessions.get.query.mock.calls.length).toBeGreaterThan(readsBefore),
    );
    expect(screen.queryByText(ar('student.remedy.acceptSheet.text'))).toBeNull();
  });

  it('a pending counter-proposal: its time and its answer window’s close in both zones, the proposal still accepted, which withdraws it, and no second counter', async () => {
    mockApi.sessions.get.query.mockResolvedValue(
      read({ status: 'counter_proposed', canChooseRefund: false, counter: COUNTER }),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'student.remedy.text.counter'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.remedy.counter'))).toBeTruthy();
      expectBothZones(direction, COUNTER.startsAt);
      expect(screen.getByText(said(direction, 'student.remedy.answerClosesAt'))).toBeTruthy();
      expectBothZones(direction, COUNTER.answerClosesAt);
      expectBothZones(direction, PROPOSAL.startsAt);
      expect(button(direction, 'student.remedy.proposeOther')).toBeNull();
      expect(button(direction, 'student.remedy.refund')).toBeNull();
      await fireEvent.press(button(direction, 'student.remedy.accept')!);
      expect(
        screen.getByText(said(direction, 'student.remedy.acceptSheet.withdraws')),
      ).toBeTruthy();
    });
  });

  it('no acceptance, counter or refund outside awaiting_choice, proposed and counter_proposed: each says where it stands', async () => {
    const settled = [
      [{ status: 'frozen', canChooseRefund: false, proposal: undefined }, 'student.remedy.frozen'],
      [
        {
          status: 'booked',
          canChooseRefund: false,
          makeupSessionId: '0193a6f0-0000-7000-8000-0000000000c9',
        },
        'student.remedy.booked',
      ],
      [
        { status: 'refund_case', kind: 'refund', canChooseRefund: false },
        'student.remedy.refundCase',
      ],
    ] as const;
    for (const [shape, words] of settled) {
      mockApi.sessions.get.query.mockResolvedValue(read(shape));
      await inBothDirections(ui, async (_rendered, direction) => {
        expect(await screen.findByText(said(direction, words))).toBeTruthy();
        expect(button(direction, 'student.remedy.accept')).toBeNull();
        expect(button(direction, 'student.remedy.proposeOther')).toBeNull();
        expect(button(direction, 'student.remedy.refund')).toBeNull();
        expect(screen.queryByText(said(direction, 'student.remedy.choiceClosesAt'))).toBeNull();
      });
      queries.removeQueries({ queryKey: ['sessions'] });
    }
  });

  it('draws nothing for a session with no remedy, nor for a status the parties never see', async () => {
    for (const answer of [read(undefined), read({ status: 'lapsed' as RemedyView['status'] })]) {
      mockApi.sessions.get.query.mockResolvedValue(answer);
      const rendered = await renderIn('rtl', ui());
      await waitFor(() => expect(mockApi.sessions.get.query).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByText(ar('student.remedy.title'))).toBeNull();
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      await rendered.unmount();
      queries.removeQueries({ queryKey: ['sessions'] });
    }
  });
});

describe('the counter-proposal (FR-465)', () => {
  const choose = async (option: CounterOption) =>
    fireEvent.press(screen.getByText(timeIn('rtl', option.startsAt, CAIRO)));
  const send = async () =>
    fireEvent.press(screen.getByRole('button', { name: ar('student.remedy.counterSheet.send') }));

  it('lists `counterOptions`’ times in both zones and sends the chosen one, keyed', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({ status: 'proposed' }));
    mockApi.remedy.counterOptions.query.mockResolvedValue({ options: OPTIONS });
    await inBothDirections(ui, async (_rendered, direction) => {
      await fireEvent.press(
        await screen.findByRole('button', { name: said(direction, 'student.remedy.proposeOther') }),
      );
      expect(
        await screen.findByText(said(direction, 'student.remedy.counterSheet.text')),
      ).toBeTruthy();
      for (const option of OPTIONS) {
        expect(await screen.findByText(timeIn(direction, option.startsAt, CAIRO))).toBeTruthy();
        expect(screen.getByText(timeIn(direction, option.startsAt, DUBAI))).toBeTruthy();
      }
    });
    expect(mockApi.remedy.counterOptions.query).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    mockApi.remedy.counter.mutate.mockResolvedValue(
      remedy({ status: 'counter_proposed', canChooseRefund: false, counter: COUNTER }),
    );
    await renderIn('rtl', ui());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('student.remedy.proposeOther') }),
    );
    await screen.findByText(timeIn('rtl', OPTIONS[1]!.startsAt, CAIRO));
    await choose(OPTIONS[1]!);
    await send();
    expect(mockApi.remedy.counter.mutate).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      slotId: OPTIONS[1]!.slotId,
      localDate: OPTIONS[1]!.localDate,
      idempotencyKey: expect.stringMatching(/^0193a6f0-/),
    });
    await waitFor(() =>
      expect(screen.queryByText(ar('student.remedy.counterSheet.text'))).toBeNull(),
    );
  });

  it('a fresh key per chosen option and per opening, the same key on that option’s retry', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({ status: 'proposed' }));
    mockApi.remedy.counterOptions.query.mockResolvedValue({ options: OPTIONS });
    mockApi.remedy.counter.mutate.mockRejectedValue(new Error('network'));
    await renderIn('rtl', ui());
    await fireEvent.press(
      await screen.findByRole('button', { name: ar('student.remedy.proposeOther') }),
    );
    await screen.findByText(timeIn('rtl', OPTIONS[0]!.startsAt, CAIRO));
    const keys = () =>
      mockApi.remedy.counter.mutate.mock.calls.map(
        ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
      );
    await choose(OPTIONS[0]!);
    await send();
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    await send();
    await choose(OPTIONS[1]!);
    await send();
    await waitFor(() => expect(keys()).toHaveLength(3));
    const [first, retry, other] = keys();
    expect(retry).toBe(first);
    expect(other).not.toBe(first);
    // Closed and opened again: a new action, a new key, even for the same option.
    await fireEvent.press(screen.getByRole('button', { name: ar('common.action.cancel') }));
    await fireEvent.press(screen.getByRole('button', { name: ar('student.remedy.proposeOther') }));
    await screen.findByText(timeIn('rtl', OPTIONS[0]!.startsAt, CAIRO));
    await choose(OPTIONS[0]!);
    await send();
    await waitFor(() => expect(keys()).toHaveLength(4));
    expect(keys()[3]).not.toBe(first);
    expect(keys()[3]).not.toBe(other);
  });

  it('says plainly that no time is free, and sends nothing', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({ status: 'proposed' }));
    mockApi.remedy.counterOptions.query.mockResolvedValue({ options: [] });
    await inBothDirections(ui, async (_rendered, direction) => {
      await fireEvent.press(
        await screen.findByRole('button', { name: said(direction, 'student.remedy.proposeOther') }),
      );
      expect(
        await screen.findByText(said(direction, 'student.remedy.counterSheet.empty')),
      ).toBeTruthy();
      expect(button(direction, 'student.remedy.counterSheet.send')).toBeNull();
    });
    expect(mockApi.remedy.counter.mutate).not.toHaveBeenCalled();
  });
});

describe('failures (T065’s genericErrorKey; R-320)', () => {
  it('a RATE_LIMITED answer says when to try again; any other refusal is the generic failure and reads the session again', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({ status: 'proposed' }));
    mockApi.remedy.accept.mutate
      .mockRejectedValueOnce(apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '120' }]))
      .mockRejectedValueOnce(apiError('REMEDY_NOT_OPEN'));
    await renderIn('rtl', ui());
    await fireEvent.press(await screen.findByRole('button', { name: ar('student.remedy.accept') }));
    const confirm = () =>
      fireEvent.press(
        screen.getByRole('button', { name: ar('student.remedy.acceptSheet.confirm') }),
      );
    await confirm();
    expect(await screen.findByText(ar('common.state.rateLimitedIn', { count: 2 }))).toBeTruthy();
    const readsBefore = mockApi.sessions.get.query.mock.calls.length;
    await confirm();
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    await waitFor(() =>
      expect(mockApi.sessions.get.query.mock.calls.length).toBeGreaterThan(readsBefore),
    );
  });

  it('an answer that never reached the server reads nothing again', async () => {
    mockApi.sessions.get.query.mockResolvedValue(read({}));
    mockApi.remedy.choose.mutate.mockRejectedValue(new Error('network'));
    await renderIn('ltr', ui());
    await fireEvent.press(
      await screen.findByRole('button', { name: said('ltr', 'student.remedy.refund') }),
    );
    const readsBefore = mockApi.sessions.get.query.mock.calls.length;
    await fireEvent.press(
      screen.getByRole('button', { name: said('ltr', 'student.remedy.refundSheet.confirm') }),
    );
    expect(await screen.findByText(said('ltr', 'common.state.actionError'))).toBeTruthy();
    expect(mockApi.sessions.get.query.mock.calls.length).toBe(readsBefore);
  });
});
