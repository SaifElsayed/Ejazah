// T041 of specs/004-sessions (FR-456, FR-458, FR-494, FR-495; US3 acceptance 1 to 3): the session's
// cancellation panel, the same for both roles, in Arabic and English. The request control on a
// scheduled session before its start, a free-text reason (nothing sent while it is blank), the
// request keyed; a pending request with its reason and its expiry at the start in the session's
// zone and the viewer's; the counterparty's accept and decline; a pending request shown expired by
// the phone's clock (T065); an answered request's answer; the refusals in plain words, a
// `RATE_LIMITED` one as «طلبات كثيرة…» (T065's `genericErrorKey`).
import type { MeOutput, SessionsGetOutput } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatTime, formatWeekdayDate } from '../../../lib/formatters';
import { apiError } from '../__tests__/api-double';
import { CAIRO, DUBAI, SESSION_ID, session } from '../room/__tests__/room-api';
import { sessionQueryKey } from '../room/api';
import { CancellationPanel } from './index';

const REQUEST_ID = '0193a6f0-0000-7000-8000-0000000000a1';
/** An hour before the session's start (16:00 UTC). */
const NOW = '2026-11-11T15:00:00.000Z';
const STARTS = '2026-11-11T16:00:00.000Z';

type Cancellation = NonNullable<SessionsGetOutput['cancellation']>;

function pending(of: Partial<Cancellation> = {}): Cancellation {
  return {
    requestId: REQUEST_ID,
    requestedByMe: false,
    reason: 'سفر طارئ',
    status: 'pending',
    expiresAt: STARTS,
    ...of,
  };
}

const mockGet = jest.fn<(input: unknown) => Promise<SessionsGetOutput>>();
const mockRequest = jest.fn<(input: unknown) => Promise<unknown>>();
const mockAnswer = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({
  useApi: () => ({
    client: {
      api: {
        sessions: {
          get: { query: mockGet },
          cancellation: { request: { mutate: mockRequest }, answer: { mutate: mockAnswer } },
        },
      },
    },
  }),
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `cancel-key-${String(++mockKey)}` }));

const localeOf = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: Record<string, string | number>) =>
  translate(localeOf(direction), key, values);
const lineIn = (direction: Direction, instant: string, zone: string) =>
  said(direction, 'session.pre.timeIn', {
    date: formatWeekdayDate(instant, zone, localeOf(direction)),
    time: formatTime(instant, zone, localeOf(direction)),
    city: cityOf(zone, localeOf(direction)) ?? zone,
  });
const button = (direction: Direction, key: MessageKey) =>
  screen.getByRole('button', { name: said(direction, key) });
const absentButton = (direction: Direction, key: MessageKey) =>
  screen.queryByRole('button', { name: said(direction, key) });

const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: DUBAI } as MeOutput;

let queries: QueryClient;
const ui = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <CancellationPanel sessionId={SESSION_ID} />
  </QueryClientProvider>
);

/** The panel over `read`, as `sessions.get` answers it. */
function answering(read: SessionsGetOutput): void {
  mockGet.mockResolvedValue(read);
  queries.setQueryData(sessionQueryKey(SESSION_ID), read);
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(NOW) });
  mockGet.mockReset();
  mockRequest.mockReset();
  mockAnswer.mockReset();
  mockKey = 0;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
  jest.useRealTimers();
});

async function openForm(direction: Direction): Promise<void> {
  await fireEvent.press(button(direction, 'session.cancellation.request'));
}

async function typeReason(direction: Direction, text: string): Promise<void> {
  await fireEvent.changeText(
    screen.getByLabelText(said(direction, 'session.cancellation.form.reason')),
    text,
  );
}

describe('CancellationPanel: the request (T041, FR-456)', () => {
  it('asks to cancel a scheduled session before its start, with the reason the party wrote', async () => {
    answering(session());
    mockRequest.mockResolvedValue({ requestId: REQUEST_ID, status: 'pending', expiresAt: STARTS });
    await inBothDirections(ui, async (_rendered, direction) => {
      await openForm(direction);
      expect(screen.getByText(said(direction, 'session.cancellation.form.hint'))).toBeTruthy();
      await typeReason(direction, '  سفر طارئ  ');
      await act(async () => {
        await fireEvent.press(button(direction, 'session.cancellation.form.send'));
      });
    });
    expect(mockRequest).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      reason: 'سفر طارئ',
      idempotencyKey: 'cancel-key-1',
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('sends nothing while the reason is blank', async () => {
    answering(session());
    await inBothDirections(ui, async (_rendered, direction) => {
      await openForm(direction);
      const send = button(direction, 'session.cancellation.form.send');
      expect(send.props.accessibilityState?.disabled).toBe(true);
      await typeReason(direction, '   ');
      expect(
        button(direction, 'session.cancellation.form.send').props.accessibilityState?.disabled,
      ).toBe(true);
      await fireEvent.press(button(direction, 'session.cancellation.form.send'));
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('says a reason past 500 characters is too long, and sends nothing', async () => {
    answering(session());
    await renderIn('rtl', ui());
    await openForm('rtl');
    await typeReason('rtl', 'س'.repeat(501));
    expect(screen.getByText(said('rtl', 'session.cancellation.form.tooLong'))).toBeTruthy();
    await fireEvent.press(button('rtl', 'session.cancellation.form.send'));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('says CANCELLATION_PENDING and CANCELLATION_EXPIRED in plain words, RATE_LIMITED with its time', async () => {
    answering(session());
    const refusals = [
      [apiError('CANCELLATION_PENDING'), 'session.cancellation.refused.pending', undefined],
      [apiError('CANCELLATION_EXPIRED'), 'session.cancellation.refused.expired', undefined],
      [
        apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '90' }]),
        'common.state.rateLimitedIn',
        { count: 2 },
      ],
    ] as const;
    await inBothDirections(ui, async (_rendered, direction) => {
      await openForm(direction);
      await typeReason(direction, 'سفر طارئ');
      for (const [error, key, values] of refusals) {
        mockRequest.mockRejectedValueOnce(error);
        await act(async () => {
          await fireEvent.press(button(direction, 'session.cancellation.form.send'));
        });
        expect(await screen.findByText(said(direction, key, values))).toBeTruthy();
      }
    });
  });

  it('shows no request control from the start on, on a session not scheduled, or while a request is pending', async () => {
    const hidden: [string, SessionsGetOutput][] = [
      [STARTS, session()],
      [NOW, session({ status: 'done' })],
      [NOW, session({ status: 'cancelled_by_admin' })],
      [NOW, session({ cancellation: pending({ requestedByMe: true }) })],
    ];
    for (const [now, read] of hidden) {
      jest.setSystemTime(new Date(now));
      answering(read);
      await inBothDirections(ui, (_rendered, direction) => {
        expect(absentButton(direction, 'session.cancellation.request')).toBeNull();
      });
    }
  });
});

describe('CancellationPanel: a pending request (T041, FR-456, FR-458, FR-494)', () => {
  it('shows the party’s own pending request, its reason and its expiry at the start in both zones', async () => {
    answering(session({ cancellation: pending({ requestedByMe: true }) }));
    await inBothDirections(ui, (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'session.cancellation.pending.mine'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'session.cancellation.reason', { reason: 'سفر طارئ' })),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'session.cancellation.expiresAt'))).toBeTruthy();
      expect(screen.getByText(lineIn(direction, STARTS, CAIRO))).toBeTruthy();
      expect(screen.getByText(lineIn(direction, STARTS, DUBAI))).toBeTruthy();
      expect(absentButton(direction, 'session.cancellation.accept')).toBeNull();
      expect(absentButton(direction, 'session.cancellation.decline')).toBeNull();
    });
  });

  it('lets the counterparty accept or decline it', async () => {
    answering(session({ cancellation: pending() }));
    mockAnswer.mockResolvedValue({
      requestId: REQUEST_ID,
      status: 'accepted',
      sessionStatus: 'cancelled_by_agreement',
    });
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'session.cancellation.pending.theirs'))).toBeTruthy();
      expect(screen.getByText(lineIn(direction, STARTS, CAIRO))).toBeTruthy();
      expect(screen.getByText(lineIn(direction, STARTS, DUBAI))).toBeTruthy();
      expect(screen.getByText(said(direction, 'session.cancellation.ifAnswer'))).toBeTruthy();
      await act(async () => {
        await fireEvent.press(button(direction, 'session.cancellation.accept'));
      });
      await act(async () => {
        await fireEvent.press(button(direction, 'session.cancellation.decline'));
      });
    });
    expect(mockAnswer.mock.calls.map(([input]) => input)).toEqual([
      { requestId: REQUEST_ID, accept: true },
      { requestId: REQUEST_ID, accept: false },
      { requestId: REQUEST_ID, accept: true },
      { requestId: REQUEST_ID, accept: false },
    ]);
  });

  it('says a refused answer in plain words, and reads sessions.get again', async () => {
    answering(session({ cancellation: pending() }));
    await renderIn('rtl', ui());
    const reads = mockGet.mock.calls.length;
    mockAnswer.mockRejectedValueOnce(apiError('CANCELLATION_EXPIRED'));
    await act(async () => {
      await fireEvent.press(button('rtl', 'session.cancellation.accept'));
    });
    expect(
      await screen.findByText(said('rtl', 'session.cancellation.refused.expired')),
    ).toBeTruthy();
    expect(mockGet.mock.calls.length).toBeGreaterThan(reads);
    mockAnswer.mockRejectedValueOnce(apiError('RATE_LIMITED'));
    await act(async () => {
      await fireEvent.press(button('rtl', 'session.cancellation.decline'));
    });
    expect(await screen.findByText(said('rtl', 'common.state.rateLimited'))).toBeTruthy();
  });

  it('shows a pending request expired from the start by the phone’s clock, with no answer offered', async () => {
    jest.setSystemTime(new Date(STARTS));
    answering(session({ cancellation: pending() }));
    await inBothDirections(ui, (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'session.cancellation.expired'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'session.cancellation.pending.theirs'))).toBeNull();
      expect(absentButton(direction, 'session.cancellation.accept')).toBeNull();
    });
  });

  it('says an answered request’s answer', async () => {
    const answered = [
      [
        session({
          status: 'cancelled_by_agreement',
          cancellation: pending({ status: 'accepted' }),
        }),
        'session.cancellation.accepted',
      ],
      [session({ cancellation: pending({ status: 'declined' }) }), 'session.cancellation.declined'],
      [session({ cancellation: pending({ status: 'expired' }) }), 'session.cancellation.expired'],
    ] as const;
    for (const [read, key] of answered) {
      answering(read);
      await inBothDirections(ui, (_rendered, direction) => {
        expect(screen.getByText(said(direction, key))).toBeTruthy();
      });
    }
  });

  it('never says «the session stands» on a session an administrator cancelled (PR #136, Saif r1)', async () => {
    const over = [
      ['expired', 'session.cancellation.over', 'session.cancellation.expired'],
      ['declined', 'session.cancellation.declinedOnly', 'session.cancellation.declined'],
    ] as const;
    for (const [status, key, stands] of over) {
      answering(session({ status: 'cancelled_by_admin', cancellation: pending({ status }) }));
      await inBothDirections(ui, (_rendered, direction) => {
        expect(screen.getByText(said(direction, key))).toBeTruthy();
        expect(screen.queryByText(said(direction, stands))).toBeNull();
      });
    }
  });
});
