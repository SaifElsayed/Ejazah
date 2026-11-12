// T042 of specs/004-sessions (FR-473, FR-474, FR-494, FR-495): the session's dispute panel, the same
// for both roles, in Arabic and English. The control only while `canRaiseDispute`, with the window's
// close in the session's zone and the viewer's; a free-text reason, nothing sent while it is blank;
// the state after raising (open by the viewer or by the other party, resolved, dismissed);
// `DISPUTE_WINDOW_CLOSED`, `DISPUTE_OPEN`, `SESSION_UNDER_REVIEW` and `NOT_DISPUTABLE` in plain
// words, a `RATE_LIMITED` one as «طلبات كثيرة…» (T065's `genericErrorKey`).
import type { MeOutput, SessionsGetOutput } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatTime, formatWeekdayDate } from '../../../lib/formatters';
import { apiError } from '../__tests__/api-double';
import { CAIRO, DUBAI, SESSION_ID, session } from '../room/__tests__/room-api';
import { sessionQueryKey } from '../room/api';
import { DisputePanel } from './index';

/** A day after the session's end (16:45 UTC on 2026-11-11), inside its 72-hour window. */
const NOW = '2026-11-12T16:45:00.000Z';
const CLOSES = '2026-11-14T16:45:00.000Z';

const mockGet = jest.fn<(input: unknown) => Promise<SessionsGetOutput>>();
const mockRaise = jest.fn<(input: unknown) => Promise<unknown>>();
jest.mock('../../../lib/api', () => ({
  useApi: () => ({
    client: {
      api: { sessions: { get: { query: mockGet }, dispute: { raise: { mutate: mockRaise } } } },
    },
  }),
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `dispute-key-${String(++mockKey)}` }));

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

const me = { userId: '0193a6f0-0000-7000-8000-000000000002', timezone: DUBAI } as MeOutput;

/** A session done yesterday, disputable until its window closes. */
const disputable = (of: Partial<SessionsGetOutput> = {}) =>
  session({ status: 'done', canRaiseDispute: true, disputeClosesAt: CLOSES, ...of });

let queries: QueryClient;
const ui = (): ReactElement => (
  <QueryClientProvider client={queries}>
    <DisputePanel sessionId={SESSION_ID} />
  </QueryClientProvider>
);

function answering(read: SessionsGetOutput): void {
  mockGet.mockResolvedValue(read);
  queries.setQueryData(sessionQueryKey(SESSION_ID), read);
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(NOW) });
  mockGet.mockReset();
  mockRaise.mockReset();
  mockKey = 0;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  queries.clear();
  jest.useRealTimers();
});

async function writeReason(direction: Direction, text: string): Promise<void> {
  await fireEvent.press(button(direction, 'session.dispute.raise'));
  await fireEvent.changeText(
    screen.getByLabelText(said(direction, 'session.dispute.form.reason')),
    text,
  );
}

describe('DisputePanel: the control (T042, FR-473)', () => {
  it('offers a dispute while canRaiseDispute, with the window’s close in both zones, and sends the reason', async () => {
    answering(disputable());
    mockRaise.mockResolvedValue({
      disputeId: '0193a6f0-0000-7000-8000-0000000000f1',
      status: 'open',
    });
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(screen.getByText(said(direction, 'session.dispute.closesAt'))).toBeTruthy();
      expect(screen.getByText(lineIn(direction, CLOSES, CAIRO))).toBeTruthy();
      expect(screen.getByText(lineIn(direction, CLOSES, DUBAI))).toBeTruthy();
      await writeReason(direction, '  انقطع الصوت  ');
      expect(screen.getByText(said(direction, 'session.dispute.form.hint'))).toBeTruthy();
      await act(async () => {
        await fireEvent.press(button(direction, 'session.dispute.form.send'));
      });
    });
    expect(mockRaise).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      reason: 'انقطع الصوت',
      idempotencyKey: 'dispute-key-1',
    });
  });

  it('offers no dispute while canRaiseDispute is false or not answered', async () => {
    for (const read of [
      disputable({ canRaiseDispute: false }),
      session({ status: 'cancelled_by_agreement' }),
    ]) {
      answering(read);
      await inBothDirections(ui, (_rendered, direction) => {
        expect(
          screen.queryByRole('button', { name: said(direction, 'session.dispute.raise') }),
        ).toBeNull();
        expect(screen.queryByText(said(direction, 'session.dispute.closesAt'))).toBeNull();
      });
    }
  });

  it('sends nothing while the reason is blank', async () => {
    answering(disputable());
    await inBothDirections(ui, async (_rendered, direction) => {
      await writeReason(direction, '   ');
      const send = button(direction, 'session.dispute.form.send');
      expect(send.props.accessibilityState?.disabled).toBe(true);
      await fireEvent.press(send);
    });
    expect(mockRaise).not.toHaveBeenCalled();
  });

  it('says each refusal in plain words', async () => {
    answering(disputable());
    const refusals = [
      ['DISPUTE_WINDOW_CLOSED', 'session.dispute.refused.windowClosed'],
      ['DISPUTE_OPEN', 'session.dispute.refused.open'],
      ['SESSION_UNDER_REVIEW', 'session.dispute.refused.underReview'],
      ['NOT_DISPUTABLE', 'session.dispute.refused.notDisputable'],
      ['RATE_LIMITED', 'common.state.rateLimited'],
    ] as const;
    await inBothDirections(ui, async (_rendered, direction) => {
      await writeReason(direction, 'انقطع الصوت');
      for (const [code, key] of refusals) {
        mockRaise.mockRejectedValueOnce(apiError(code));
        await act(async () => {
          await fireEvent.press(button(direction, 'session.dispute.form.send'));
        });
        expect(await screen.findByText(said(direction, key))).toBeTruthy();
      }
    });
  });
});

describe('DisputePanel: the state after raising (T042, FR-474, FR-495)', () => {
  it('says the dispute’s state: open by the viewer or the other party, resolved, dismissed', async () => {
    const states = [
      [{ status: 'open', raisedByMe: true }, 'session.dispute.state.openMine'],
      [{ status: 'open', raisedByMe: false }, 'session.dispute.state.openTheirs'],
      [{ status: 'resolved', raisedByMe: true }, 'session.dispute.state.resolved'],
      [{ status: 'dismissed', raisedByMe: false }, 'session.dispute.state.dismissed'],
    ] as const;
    for (const [dispute, key] of states) {
      answering(
        disputable({
          status: dispute.status === 'open' ? 'disputed' : 'done',
          canRaiseDispute: false,
          dispute: { ...dispute, closesAt: CLOSES },
        }),
      );
      await inBothDirections(ui, (_rendered, direction) => {
        expect(screen.getByText(said(direction, key))).toBeTruthy();
      });
    }
  });
});
