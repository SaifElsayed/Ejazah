// T045 (FR-358, FR-382, FR-BOOK-12 (c), R-217; screens.md §5): the checkout on the phone, in both
// languages. `Checkout` shows the one payment summary `checkout.current` gives (the teacher, then
// the package with its track, then the price), the track's caption and the gateway's, and a
// countdown to `payBy` (the last moment Pay is accepted, the hold's expiry minus the grace) read by
// `secondsUntil` from the phone's clock, which keeps counting with no connection and falls to
// `CheckoutExpired` at zero. Pay sends the summary the screen shows; on
// `SUMMARY_CHANGED` the screen reads the summary again and pays only on a new press. The hosted
// page opens through `openAuthSessionAsync(checkoutUrl, 'ijazah://checkout/return')`, and whatever
// the session answers the phone goes to `processing` with the enrollment's id. `CheckoutPrevious`
// continues the payable order (`checkout.continue`) with the time left on it. T085: `Checkout`'s
// summary shows the first and last session dates `checkout.current` answers (FR-386), each a local
// calendar date in the slot's zone. Each case waits for the loaded content with `findBy*` before it
// reads anything with `getBy*`.
import type {
  CheckoutCurrentOutput,
  CheckoutStatusOutput,
  CheckoutSummary,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters } from '@ijazah/money';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { formatCalendarDate, formatPounds } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import {
  Checkout,
  CHECKOUT_CURRENT_QUERY_KEY,
  CHECKOUT_PROCESSING_ROUTE,
  CHECKOUT_RETURN_URL,
  CheckoutExpiredRoute,
  CheckoutPrevious,
} from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockNavigate = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockNavigate('push', route),
    replace: (route: unknown) => mockNavigate('replace', route),
    dismissTo: (route: unknown) => mockNavigate('dismissTo', route),
    back: () => mockNavigate('back'),
  },
  useLocalSearchParams: () => mockParams,
}));

const mockOpenAuthSession = jest.fn(async (_url: string, _redirect: string) => ({
  type: 'success' as string,
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (url: string, redirect: string) => mockOpenAuthSession(url, redirect),
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `pay-key-${++mockKey}` }));

type Direction = 'rtl' | 'ltr';

const NOW = '2026-11-09T10:00:00.000Z';
const HOLD_ID = '0193a6f0-0000-7000-8000-0000000000c1';
const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const TEACHER_ID = '0193a6f0-0000-7000-8000-0000000000d1';
const CHECKOUT_URL = 'http://localhost:3000/stand-in/checkout/order-1';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000a1',
  nameAr: 'حفظ القرآن',
  nameEn: 'Quran memorization',
};

const recitationSummary: CheckoutSummary = {
  teacher: { teacherId: TEACHER_ID, displayName: 'أحمد المصري' },
  subject: QURAN,
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 120_000,
};

/** The run a confirmation now would give: eight Thursdays at 09:00 in Cairo (FR-368, FR-386). */
const FIRST_SESSION = { localDate: '2026-11-12', startsAt: '2026-11-12T07:00:00Z' };
const LAST_SESSION = { localDate: '2026-12-31', startsAt: '2026-12-31T07:00:00Z' };

/** A hold placed at `NOW`: ten minutes to pay, then five of grace. */
const hold = (
  overrides: Partial<NonNullable<CheckoutCurrentOutput['hold']>> = {},
): CheckoutCurrentOutput => ({
  hold: {
    holdId: HOLD_ID,
    expiresAt: '2026-11-09T10:15:00.000Z',
    payBy: '2026-11-09T10:10:00.000Z',
    summary: recitationSummary,
    firstSession: FIRST_SESSION,
    lastSession: LAST_SESSION,
    ...overrides,
  },
});

const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(direction === 'rtl' ? 'ar' : 'en', key, values);
const locale = (direction: Direction) => (direction === 'rtl' ? 'ar' : 'en');
const price = (direction: Direction, amount: number) =>
  formatPounds(piasters(amount), locale(direction));
const packageValue = (direction: Direction, summary = recitationSummary) =>
  said(direction, 'student.checkout.packageValue', {
    subject: direction === 'rtl' ? summary.subject.nameAr : summary.subject.nameEn,
    sessions: said(direction, 'common.sessions', { count: summary.sessionCount }),
    minutes: summary.sessionDurationMinutes,
  });
const payWithin = (direction: Direction, time: string) =>
  said(direction, 'student.checkout.payWithin', { time });
/** A run the `ltr` Text isolates left to right (U+2066 … U+2069). */
const ltr = (text: string) => `⁦${text}⁩`;

let queries: QueryClient;
const withQueries = (ui: () => ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui()}</QueryClientProvider>
);
const renderAr = (ui: ReactElement) =>
  renderIn('rtl', <QueryClientProvider client={queries}>{ui}</QueryClientProvider>);

/** Runs the pending effects and the timers of `ms` milliseconds. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(NOW) });
  mockApi = fakeApi();
  mockNavigate.mockReset();
  mockOpenAuthSession.mockReset();
  mockOpenAuthSession.mockResolvedValue({ type: 'success' });
  mockParams = {};
  onlineManager.setOnline(true);
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  queries.clear();
  jest.useRealTimers();
});

describe('Checkout: the one payment summary (FR-358)', () => {
  it('shows the teacher, the package with its track, the total, both captions and Pay', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(hold());
    await inBothDirections(
      withQueries(() => <Checkout />),
      async (_rendered, direction) => {
        expect(await screen.findByText(recitationSummary.teacher.displayName)).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.teacher'))).toBeTruthy();
        expect(screen.getByText(packageValue(direction))).toBeTruthy();
        expect(screen.getByText(said(direction, 'common.track.recitation'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.total'))).toBeTruthy();
        expect(screen.getByText(price(direction, 120_000))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.note.recitation'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.note.gateway'))).toBeTruthy();
        expect(
          screen.getByRole('button', {
            name: said(direction, 'student.checkout.pay', { amount: price(direction, 120_000) }),
          }),
        ).toBeTruthy();
      },
    );
  });

  it('shows the first and last session dates the student would get if confirmed now, in both languages (FR-386, T085)', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(hold());
    await inBothDirections(
      withQueries(() => <Checkout />),
      async (_rendered, direction) => {
        expect(await screen.findByText(recitationSummary.teacher.displayName)).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.firstSession'))).toBeTruthy();
        expect(
          screen.getByText(formatCalendarDate(FIRST_SESSION.localDate, locale(direction))),
        ).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.lastSession'))).toBeTruthy();
        expect(
          screen.getByText(formatCalendarDate(LAST_SESSION.localDate, locale(direction))),
        ).toBeTruthy();
      },
    );
  });

  it('draws the dates `checkout.current` answers, computing none of its own', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(
      hold({
        firstSession: { localDate: '2026-11-19', startsAt: '2026-11-19T07:00:00Z' },
        lastSession: { localDate: '2027-01-07', startsAt: '2027-01-07T07:00:00Z' },
      }),
    );
    await renderAr(<Checkout />);
    expect(await screen.findByText(formatCalendarDate('2026-11-19', 'ar'))).toBeTruthy();
    expect(screen.getByText(formatCalendarDate('2027-01-07', 'ar'))).toBeTruthy();
    expect(screen.queryByText(formatCalendarDate(FIRST_SESSION.localDate, 'ar'))).toBeNull();
  });

  it('draws no recitation caption for an ijazah-track package (its variant is not drawn)', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(
      hold({ summary: { ...recitationSummary, track: 'ijazah_track' } }),
    );
    await renderAr(<Checkout />);
    expect(await screen.findByText(said('rtl', 'common.track.ijazahTrack'))).toBeTruthy();
    expect(screen.queryByText(said('rtl', 'student.checkout.note.recitation'))).toBeNull();
    expect(screen.getByText(said('rtl', 'student.checkout.note.gateway'))).toBeTruthy();
  });
});

describe('Checkout: the countdown by secondsUntil (FR-358, R-217)', () => {
  it('counts down every second, and keeps counting with no connection', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(hold());
    await renderAr(<Checkout />);
    expect(await screen.findByText(payWithin('rtl', '10:00'))).toBeTruthy();
    await advance(1_000);
    expect(screen.getByText(payWithin('rtl', '9:59'))).toBeTruthy();
    await act(async () => {
      onlineManager.setOnline(false);
    });
    await advance(108_000);
    expect(screen.getByText(payWithin('rtl', '8:11'))).toBeTruthy();
    expect(screen.getByText(said('rtl', 'common.state.offline'))).toBeTruthy();
  });

  it('falls to CheckoutExpired at zero, with the summary and «ملغى»', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(
      hold({ payBy: '2026-11-09T10:00:03.000Z' }),
    );
    await renderAr(<Checkout />);
    expect(await screen.findByText(payWithin('rtl', '0:03'))).toBeTruthy();
    await advance(3_000);
    expect(await screen.findByText(said('rtl', 'student.checkoutExpired.title'))).toBeTruthy();
    expect(screen.getByText(said('rtl', 'student.checkoutExpired.lede'))).toBeTruthy();
    expect(screen.getByText(recitationSummary.teacher.displayName)).toBeTruthy();
    expect(screen.getByText(said('rtl', 'status.enrollment.cancelled'))).toBeTruthy();
    expect(screen.queryByText(said('rtl', 'student.checkout.note.gateway'))).toBeNull();
  });

  it('runs to payBy, not to the hold’s expiry: at payBy the grace is left but Pay is not', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(
      hold({ expiresAt: '2026-11-09T10:05:01.000Z', payBy: '2026-11-09T10:00:01.000Z' }),
    );
    await renderAr(<Checkout />);
    expect(await screen.findByText(payWithin('rtl', '0:01'))).toBeTruthy();
    await advance(1_000);
    expect(await screen.findByText(said('rtl', 'student.checkoutExpired.title'))).toBeTruthy();
    expect(mockApi.api.checkout.pay.mutate).not.toHaveBeenCalled();
  });

  it('is CheckoutExpired when the student holds nothing', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue({});
    await renderAr(<Checkout />);
    expect(await screen.findByText(said('rtl', 'student.checkoutExpired.title'))).toBeTruthy();
  });

  it('goes to processing when Pay was already pressed on the hold', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(
      hold({
        enrollmentId: ENROLLMENT_ID,
        lastOrder: { status: 'created', expiresAt: '2026-11-09T10:10:00.000Z', canContinue: true },
      }),
    );
    await renderAr(<Checkout />);
    await advance(0);
    expect(mockNavigate).toHaveBeenCalledWith('replace', {
      pathname: CHECKOUT_PROCESSING_ROUTE,
      params: { enrollmentId: ENROLLMENT_ID },
    });
    expect(mockApi.api.checkout.pay.mutate).not.toHaveBeenCalled();
  });
});

describe('Checkout: Pay sends the summary the screen shows (the owner, 2026-11-03)', () => {
  const pressPay = async (amount = 120_000) => {
    await fireEvent.press(
      await screen.findByRole('button', {
        name: said('rtl', 'student.checkout.pay', { amount: price('rtl', amount) }),
      }),
    );
    await advance(0);
  };

  it.each(['success', 'cancel', 'dismiss'])(
    'opens the hosted page and goes to processing when the session answers %s',
    async (type) => {
      mockApi.api.checkout.current.query.mockResolvedValue(hold());
      mockApi.api.checkout.pay.mutate.mockResolvedValue({
        enrollmentId: ENROLLMENT_ID,
        checkoutUrl: CHECKOUT_URL,
        orderExpiresAt: '2026-11-09T10:10:00.000Z',
      });
      mockOpenAuthSession.mockResolvedValue({ type });
      await renderAr(<Checkout />);
      await pressPay();
      expect(mockApi.api.checkout.pay.mutate).toHaveBeenCalledWith({
        holdId: HOLD_ID,
        quoted: {
          price_piasters: 120_000,
          sessionCount: 8,
          sessionDurationMinutes: 45,
          track: 'recitation',
        },
        idempotencyKey: expect.any(String),
      });
      expect(mockOpenAuthSession).toHaveBeenCalledWith(CHECKOUT_URL, 'ijazah://checkout/return');
      expect(CHECKOUT_RETURN_URL).toBe('ijazah://checkout/return');
      expect(mockNavigate).toHaveBeenCalledWith('replace', {
        pathname: '/(student)/checkout/processing',
        params: { enrollmentId: ENROLLMENT_ID },
      });
    },
  );

  // PR #121's review, rounds 1 and 2 (N2): once Pay is accepted the server's `checkout.current`
  // carries the enrollment, as these doubles answer from then on. The cache is marked stale for the
  // next screen, and nothing reads it again while this one is open.
  const afterPay = () => {
    mockApi.api.checkout.current.query
      .mockResolvedValueOnce(hold())
      .mockResolvedValue(hold({ enrollmentId: ENROLLMENT_ID }));
    mockApi.api.checkout.pay.mutate.mockResolvedValue({
      enrollmentId: ENROLLMENT_ID,
      checkoutUrl: CHECKOUT_URL,
      orderExpiresAt: '2026-11-09T10:10:00.000Z',
    });
  };

  it('marks the summary stale once Pay is accepted, and stays while the hosted page is open', async () => {
    afterPay();
    mockOpenAuthSession.mockReturnValue(new Promise(() => undefined));
    await renderAr(<Checkout />);
    await pressPay();
    await advance(0);
    expect(queries.getQueryState(CHECKOUT_CURRENT_QUERY_KEY)?.isInvalidated).toBe(true);
    expect(mockApi.api.checkout.current.query).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalledWith('replace', expect.anything());
  });

  it('with no browser, after an accepted Pay, says so and stays rather than leave for processing', async () => {
    afterPay();
    mockOpenAuthSession.mockRejectedValue(new Error('no browser'));
    await renderAr(<Checkout />);
    await pressPay();
    expect(await screen.findByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
    await advance(1_000);
    expect(mockNavigate).not.toHaveBeenCalledWith('replace', expect.anything());
  });

  it('says so and stays when no browser could open, for a new press to ask again', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(hold());
    mockApi.api.checkout.pay.mutate.mockResolvedValue({
      enrollmentId: ENROLLMENT_ID,
      checkoutUrl: CHECKOUT_URL,
      orderExpiresAt: '2026-11-09T10:10:00.000Z',
    });
    mockOpenAuthSession.mockRejectedValue(new Error('no browser'));
    await renderAr(<Checkout />);
    await pressPay();
    expect(await screen.findByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('replace', expect.anything());
  });

  it('on SUMMARY_CHANGED reads the summary again, shows it, and pays only on a new press', async () => {
    const changed = { ...recitationSummary, price_piasters: 150_000, sessionCount: 10 };
    mockApi.api.checkout.current.query
      .mockResolvedValueOnce(hold())
      .mockResolvedValue(hold({ summary: changed }));
    mockApi.api.checkout.pay.mutate
      .mockRejectedValueOnce(
        apiError('SUMMARY_CHANGED', [{ path: 'summary.price_piasters', code: '150000' }]),
      )
      .mockResolvedValue({
        enrollmentId: ENROLLMENT_ID,
        checkoutUrl: CHECKOUT_URL,
        orderExpiresAt: '2026-11-09T10:10:00.000Z',
      });
    await renderAr(<Checkout />);
    await pressPay();
    expect(await screen.findByText(price('rtl', 150_000))).toBeTruthy();
    expect(screen.getByText(packageValue('rtl', changed))).toBeTruthy();
    expect(screen.getByText(said('rtl', 'student.checkout.summaryChanged'))).toBeTruthy();
    expect(mockApi.api.checkout.current.query).toHaveBeenCalledTimes(2);
    expect(mockApi.api.checkout.pay.mutate).toHaveBeenCalledTimes(1);
    expect(mockOpenAuthSession).not.toHaveBeenCalled();

    await pressPay(150_000);
    expect(mockApi.api.checkout.pay.mutate).toHaveBeenCalledTimes(2);
    const [first, second] = mockApi.api.checkout.pay.mutate.mock.calls.map(
      ([input]) => input as { quoted: unknown; idempotencyKey: string },
    );
    expect(second?.quoted).toEqual({
      price_piasters: 150_000,
      sessionCount: 10,
      sessionDurationMinutes: 45,
      track: 'recitation',
    });
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
    expect(mockOpenAuthSession).toHaveBeenCalledWith(CHECKOUT_URL, 'ijazah://checkout/return');
  });

  it('keeps the same key when the same summary is sent again after a failed call', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(hold());
    mockApi.api.checkout.pay.mutate.mockRejectedValueOnce(new Error('network')).mockResolvedValue({
      enrollmentId: ENROLLMENT_ID,
      checkoutUrl: CHECKOUT_URL,
      orderExpiresAt: '2026-11-09T10:10:00.000Z',
    });
    await renderAr(<Checkout />);
    await pressPay();
    expect(await screen.findByText(said('rtl', 'common.state.actionError'))).toBeTruthy();
    await pressPay();
    const keys = mockApi.api.checkout.pay.mutate.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('falls to CheckoutExpired on HOLD_EXPIRED, opening nothing', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(hold());
    mockApi.api.checkout.pay.mutate.mockRejectedValue(apiError('HOLD_EXPIRED'));
    await renderAr(<Checkout />);
    await pressPay();
    expect(await screen.findByText(said('rtl', 'student.checkoutExpired.title'))).toBeTruthy();
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith('replace', expect.anything());
  });
});

describe('CheckoutExpired (FR-PAYG-6, FR-BOOK-9)', () => {
  const cancelled: CheckoutStatusOutput = {
    status: 'cancelled',
    cancellationReason: 'payment_expired',
    lastOrder: { status: 'expired', reference: 'IJZ-2026-000123' },
    summary: recitationSummary,
  };

  it('shows the enrollment it is given, «ملغى», and never the backend reason', async () => {
    mockParams = { enrollmentId: ENROLLMENT_ID };
    mockApi.api.checkout.status.query.mockResolvedValue(cancelled);
    await inBothDirections(
      withQueries(() => <CheckoutExpiredRoute />),
      async (_rendered, direction) => {
        expect(await screen.findByText(recitationSummary.teacher.displayName)).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkoutExpired.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkoutExpired.lede'))).toBeTruthy();
        expect(screen.getByText(packageValue(direction))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkoutExpired.status'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'status.enrollment.cancelled'))).toBeTruthy();
        expect(screen.queryByText(/payment_expired/)).toBeNull();
      },
    );
    expect(mockApi.api.checkout.status.query).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
    });
  });

  it('starts over on the teacher’s profile, and goes home', async () => {
    mockParams = { enrollmentId: ENROLLMENT_ID };
    mockApi.api.checkout.status.query.mockResolvedValue(cancelled);
    await renderAr(<CheckoutExpiredRoute />);
    await fireEvent.press(
      await screen.findByRole('button', { name: said('rtl', 'student.checkoutExpired.startOver') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('dismissTo', {
      pathname: '/(student)/discovery/[teacherId]',
      params: { teacherId: TEACHER_ID },
    });
    await fireEvent.press(screen.getByRole('button', { name: said('rtl', 'common.action.home') }));
    expect(mockNavigate).toHaveBeenCalledWith('dismissTo', '/');
  });

  it('asks nothing without an enrollment, and starts over from discovery', async () => {
    await renderAr(<CheckoutExpiredRoute />);
    expect(await screen.findByText(said('rtl', 'student.checkoutExpired.title'))).toBeTruthy();
    expect(mockApi.api.checkout.status.query).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: said('rtl', 'student.checkoutExpired.startOver') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('dismissTo', '/(student)/(tabs)/discovery');
  });
});

describe('CheckoutPrevious (FR-BOOK-12 (c))', () => {
  const payable = hold({
    enrollmentId: ENROLLMENT_ID,
    lastOrder: { status: 'created', expiresAt: '2026-11-09T10:06:40.000Z', canContinue: true },
  });

  it('shows the previous order, its amount and the time left on it', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(payable);
    await inBothDirections(
      withQueries(() => <CheckoutPrevious />),
      async (_rendered, direction) => {
        expect(await screen.findByText(recitationSummary.teacher.displayName)).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.title'))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkoutPrevious.title'))).toBeTruthy();
        expect(screen.getByText(packageValue(direction))).toBeTruthy();
        expect(screen.getByText(said(direction, 'student.checkout.amount'))).toBeTruthy();
        expect(screen.getByText(price(direction, 120_000))).toBeTruthy();
        expect(
          screen.getByText(said(direction, 'student.checkoutPrevious.payWithin')),
        ).toBeTruthy();
        expect(screen.getByText(ltr('6:40'))).toBeTruthy();
        expect(
          screen.getByRole('button', {
            name: said(direction, 'student.checkoutPrevious.continuePrevious'),
          }),
        ).toBeTruthy();
        expect(
          screen.getByRole('button', { name: said(direction, 'student.checkoutPrevious.wait') }),
        ).toBeTruthy();
      },
    );
  });

  it.each(['success', 'cancel'])(
    'continues the previous payment and goes to processing when the session answers %s',
    async (type) => {
      mockApi.api.checkout.current.query.mockResolvedValue(payable);
      mockApi.api.checkout.continue.query.mockResolvedValue({
        checkoutUrl: CHECKOUT_URL,
        orderExpiresAt: '2026-11-09T10:06:40.000Z',
      });
      mockOpenAuthSession.mockResolvedValue({ type });
      await renderAr(<CheckoutPrevious />);
      await fireEvent.press(
        await screen.findByRole('button', {
          name: said('rtl', 'student.checkoutPrevious.continuePrevious'),
        }),
      );
      await advance(0);
      expect(mockApi.api.checkout.continue.query).toHaveBeenCalledWith({
        enrollmentId: ENROLLMENT_ID,
      });
      expect(mockOpenAuthSession).toHaveBeenCalledWith(CHECKOUT_URL, 'ijazah://checkout/return');
      expect(mockNavigate).toHaveBeenCalledWith('replace', {
        pathname: CHECKOUT_PROCESSING_ROUTE,
        params: { enrollmentId: ENROLLMENT_ID },
      });
    },
  );

  it('counts the previous order down and falls to CheckoutExpired at zero', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(
      hold({
        enrollmentId: ENROLLMENT_ID,
        lastOrder: { status: 'created', expiresAt: '2026-11-09T10:00:02.000Z', canContinue: true },
      }),
    );
    await renderAr(<CheckoutPrevious />);
    expect(await screen.findByText(ltr('0:02'))).toBeTruthy();
    await advance(2_000);
    expect(await screen.findByText(said('rtl', 'student.checkoutExpired.title'))).toBeTruthy();
  });

  it('goes to processing when the previous payment can no longer be continued', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(
      hold({
        enrollmentId: ENROLLMENT_ID,
        lastOrder: { status: 'paid', expiresAt: '2026-11-09T10:06:40.000Z', canContinue: false },
      }),
    );
    await renderAr(<CheckoutPrevious />);
    await advance(0);
    expect(mockNavigate).toHaveBeenCalledWith('replace', {
      pathname: CHECKOUT_PROCESSING_ROUTE,
      params: { enrollmentId: ENROLLMENT_ID },
    });
  });

  it('reads the order again on ORDER_NOT_PAYABLE', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(payable);
    mockApi.api.checkout.continue.query.mockRejectedValue(apiError('ORDER_NOT_PAYABLE'));
    await renderAr(<CheckoutPrevious />);
    await fireEvent.press(
      await screen.findByRole('button', {
        name: said('rtl', 'student.checkoutPrevious.continuePrevious'),
      }),
    );
    await advance(0);
    expect(mockApi.api.checkout.current.query).toHaveBeenCalledTimes(2);
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
  });

  it('waits: back to the teacher, and back when nothing is left to continue', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue(payable);
    await renderAr(<CheckoutPrevious />);
    await fireEvent.press(
      await screen.findByRole('button', { name: said('rtl', 'student.checkoutPrevious.wait') }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('back');
  });

  it('goes back when the student no longer holds a previous checkout', async () => {
    mockApi.api.checkout.current.query.mockResolvedValue({});
    await renderAr(<CheckoutPrevious />);
    await advance(0);
    expect(mockNavigate).toHaveBeenCalledWith('back');
  });
});

// PR #121's review, round 1, Major (the note under T045): `Checkout` and `CheckoutPrevious` share
// `checkout.current`'s cache, so each mount below shares the test's one `QueryClient`, a minute
// apart, as the phone does when the student books again.
describe('the shared checkout.current cache, read again on each screen', () => {
  const payable = hold({
    enrollmentId: ENROLLMENT_ID,
    lastOrder: { status: 'created', expiresAt: '2026-11-09T10:10:00.000Z', canContinue: true },
  });

  it('CheckoutPrevious after Checkout shows the payable order the server answers, not the cached hold', async () => {
    mockApi.api.checkout.current.query.mockResolvedValueOnce(hold());
    const first = await renderAr(<Checkout />);
    await advance(0);
    await first.unmount();
    // Pay ran and the student closed the hosted page; a minute later a new hold is refused
    // PREVIOUS_CHECKOUT and the phone opens CheckoutPrevious.
    await advance(60_000);
    mockApi.api.checkout.current.query.mockResolvedValue(payable);
    mockNavigate.mockReset();
    await renderAr(<CheckoutPrevious />);
    expect(await screen.findByText(said('rtl', 'student.checkoutPrevious.title'))).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('back');
  });

  it('Checkout after CheckoutPrevious shows the new hold, not the cached enrollment’s processing', async () => {
    mockApi.api.checkout.current.query.mockResolvedValueOnce(payable);
    const first = await renderAr(<CheckoutPrevious />);
    await advance(0);
    await first.unmount();
    await advance(60_000);
    mockApi.api.checkout.current.query.mockResolvedValue(
      hold({ holdId: '0193a6f0-0000-7000-8000-0000000000c2' }),
    );
    mockNavigate.mockReset();
    await renderAr(<Checkout />);
    expect(await screen.findByText(recitationSummary.teacher.displayName)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalledWith('replace', expect.anything());
  });
});
