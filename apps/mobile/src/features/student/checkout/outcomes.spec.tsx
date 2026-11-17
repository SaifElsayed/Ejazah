// T046 (FR-380 to FR-382, FR-386; screens.md §5): the checkout's outcomes on the phone, in both
// languages. `Processing` reads `checkout.status` every `processingPollSeconds` of the public
// configuration and leaves for the outcome the server reports; with no confirmation by
// `confirmationTimeoutSeconds` it releases the student (`ProcessingDelayed`), stops its schedule
// and reads again only on a return to the foreground (FR-383). `PaymentSuccess` draws only on the
// server's `confirmed` (R-HONEST-1): the receipt, the order reference, the amount, the sessions and
// the first session moved, said plainly. `PaymentFailed` retries on the same hold through the
// hosted page; `PaymentSlotUnavailable` says the booking was cancelled. Each case waits for the
// loaded content itself (`findBy*`) before reading it; the schedule runs on Jest's fake timers.
// T065 of specs/004-sessions: a read refused `RATE_LIMITED` says when to try again on every outcome.
import type { CheckoutStatusOutput, EnrollmentSession, MeOutput } from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters } from '@ijazah/money';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type Locale, type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import {
  formatCalendarDate,
  formatDate,
  formatPounds,
  formatTime,
  formatWeekday,
  weekdayIn,
} from '../../../lib/formatters';
import { apiError, CHECKOUT_POLLING, fakeApi } from '../../shared/__tests__/api-double';
import { PaymentFailed, PaymentSlotUnavailable, PaymentSuccess, Processing } from './index';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    replace: (route: unknown) => mockReplace(route),
    push: (route: unknown) => mockPush(route),
    navigate: (route: unknown) => mockPush(route),
  },
  useLocalSearchParams: () => mockParams,
}));

const mockOpenAuthSession = jest.fn(async (_url: string, _redirect: string) => ({
  type: 'dismiss',
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (url: string, redirect: string) => mockOpenAuthSession(url, redirect),
}));

let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `retry-key-${++mockKey}` }));

type Direction = 'rtl' | 'ltr';

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const TEACHER_ID = '0193a6f0-0000-7000-8000-0000000000d1';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const REFERENCE = 'IJZ-7Q4K2M';
/** The reference as the screen writes it: a left-to-right run, isolated (`Text`'s `ltr`). */
const REFERENCE_RUN = `\u2066${REFERENCE}\u2069`;
const CHECKOUT_URL = 'https://pay.ijazah.test/checkout/order-2';

/** The slot is in Cairo's zone; the student lives in Riyadh, an hour ahead. */
const SLOT_ZONE = 'Africa/Cairo';
const STUDENT_ZONE = 'Asia/Riyadh';

const me: MeOutput = {
  userId: '0193a6f0-0000-7000-8000-000000000001',
  role: 'student',
  displayName: 'أمل حسن',
  email: 'amal@example.com',
  gender: 'female',
  dateOfBirth: '2004-03-12',
  preferredLanguage: 'ar',
  timezone: STUDENT_ZONE,
  signInMethod: 'google',
  memberSince: '2026-02-02T09:00:00Z',
  accountStatus: 'active',
  landing: 'student_home',
};

const summary: CheckoutStatusOutput['summary'] = {
  teacher: { teacherId: TEACHER_ID, displayName: 'الشيخ أحمد المصري' },
  subject: QURAN,
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 120_000,
};

/** Eight Thursdays at 20:00 in Cairo (UTC+2 in November and December 2026). */
const WEEKS = [
  ['2026-11-12', '2026-11-12T18:00:00Z', '2026-11-12T18:45:00Z'],
  ['2026-11-19', '2026-11-19T18:00:00Z', '2026-11-19T18:45:00Z'],
  ['2026-11-26', '2026-11-26T18:00:00Z', '2026-11-26T18:45:00Z'],
  ['2026-12-03', '2026-12-03T18:00:00Z', '2026-12-03T18:45:00Z'],
  ['2026-12-10', '2026-12-10T18:00:00Z', '2026-12-10T18:45:00Z'],
  ['2026-12-17', '2026-12-17T18:00:00Z', '2026-12-17T18:45:00Z'],
  ['2026-12-24', '2026-12-24T18:00:00Z', '2026-12-24T18:45:00Z'],
  ['2026-12-31', '2026-12-31T18:00:00Z', '2026-12-31T18:45:00Z'],
] as const;
const sessions: EnrollmentSession[] = WEEKS.map(([localDate, startsAt, endsAt], index) => ({
  sequenceNumber: index + 1,
  localDate,
  startTimeLocal: '20:00',
  timezone: SLOT_ZONE,
  startsAt,
  endsAt,
}));

const pending: CheckoutStatusOutput = {
  status: 'pending_payment',
  lastOrder: { status: 'created', reference: REFERENCE },
  summary,
};
const confirmed: CheckoutStatusOutput = {
  status: 'confirmed',
  lastOrder: { status: 'paid', reference: REFERENCE },
  summary,
  sessions,
};
const failed: CheckoutStatusOutput = {
  status: 'pending_payment',
  lastOrder: { status: 'failed', reference: REFERENCE },
  summary,
};
const slotUnavailable: CheckoutStatusOutput = {
  status: 'cancelled',
  cancellationReason: 'slot_unavailable',
  lastOrder: { status: 'paid', reference: REFERENCE },
  summary,
};

const route = (screenName: string) => ({
  pathname: `/(student)/checkout/${screenName}`,
  params: { enrollmentId: ENROLLMENT_ID },
});
const ENROLLMENTS = '/(student)/(tabs)/enrollments';

const localeOf = (direction: Direction): Locale => (direction === 'rtl' ? 'ar' : 'en');
const said = (direction: Direction, key: MessageKey, values?: MessageValues) =>
  translate(localeOf(direction), key, values);
const ar = (key: MessageKey, values?: MessageValues) => translate('ar', key, values);
const named = (direction: Direction) => (direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn);
const pounds = (direction: Direction) =>
  formatPounds(piasters(summary.price_piasters), localeOf(direction));
const packageShort = (direction: Direction) =>
  said(direction, 'common.format.packageShort', { subject: named(direction), count: 8 });

/** A `RATE_LIMITED` refusal, with the seconds until its window ends (T065 of specs/004-sessions). */
const rateLimited = (seconds: string) =>
  apiError('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: seconds }]);
/** The banner after a `RATE_LIMITED` read: when to try again, never the generic words (T065). */
async function saysTryAgainIn(direction: Direction, count: number): Promise<void> {
  expect(
    await screen.findByText(said(direction, 'common.state.rateLimitedIn', { count })),
  ).toBeTruthy();
  expect(screen.queryByText(said(direction, 'common.state.loadError'))).toBeNull();
}

const statusCalls = () => mockApi.api.checkout.status.query.mock.calls.length;

let queries: QueryClient;
const within = (ui: ReactElement) => () => (
  <QueryClientProvider client={queries}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockReplace.mockReset();
  mockPush.mockReset();
  mockOpenAuthSession.mockClear();
  mockKey = 0;
  mockParams = { enrollmentId: ENROLLMENT_ID };
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});
afterEach(() => {
  // The cache's collection timers would keep Jest from exiting.
  queries.clear();
  jest.useRealTimers();
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

/** Advances the fake clock by `ms` and lets the reads it starts settle. */
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

describe('Processing', () => {
  it('says the payment is completing, with the package and the amount', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(pending);
    await inBothDirections(within(<Processing />), async (_rendered, direction) => {
      const line = said(direction, 'student.checkoutProcessing.summary', {
        package: packageShort(direction),
        amount: pounds(direction),
      });
      expect(await screen.findByText(line)).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.checkoutProcessing.title'))).toBeTruthy();
    });
    expect(mockApi.api.checkout.status.query).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('reads checkout.status every processingPollSeconds and opens success only on the server’s confirmed', async () => {
    jest.useFakeTimers();
    mockApi.api.checkout.status.query.mockResolvedValue(pending);
    await renderIn('rtl', within(<Processing />)());
    expect(await screen.findByText(ar('student.checkoutProcessing.title'))).toBeTruthy();
    expect(statusCalls()).toBe(1);
    await elapse(1_900);
    expect(statusCalls()).toBe(1);
    await elapse(100);
    expect(statusCalls()).toBe(2);
    await elapse(2_000);
    expect(statusCalls()).toBe(3);
    expect(mockReplace).not.toHaveBeenCalled();

    mockApi.api.checkout.status.query.mockResolvedValue(confirmed);
    await elapse(2_000);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route('confirmed')));
  });

  it('takes its schedule and its timeout from the public configuration', async () => {
    jest.useFakeTimers();
    mockApi.value.client.publicConfig.mockResolvedValue({
      supportEmail: 'support@ijazah.test',
      termsVersion: '2026-10',
      checkout: { ...CHECKOUT_POLLING, processingPollSeconds: 5, confirmationTimeoutSeconds: 20 },
      teacherSharePercent: 70,
    });
    mockApi.api.checkout.status.query.mockResolvedValue(pending);
    await renderIn('rtl', within(<Processing />)());
    expect(await screen.findByText(ar('student.checkoutProcessing.title'))).toBeTruthy();
    await elapse(4_500);
    expect(statusCalls()).toBe(1);
    await elapse(500);
    expect(statusCalls()).toBe(2);
    await elapse(10_000);
    expect(screen.queryByText(ar('student.checkoutProcessing.delayed.title'))).toBeNull();
    await elapse(5_000);
    expect(await screen.findByText(ar('student.checkoutProcessing.delayed.title'))).toBeTruthy();
  });

  it('after the timeout releases the student (ProcessingDelayed), stops reading and says no failure', async () => {
    jest.useFakeTimers();
    mockApi.api.checkout.status.query.mockResolvedValue(pending);
    await renderIn('rtl', within(<Processing />)());
    expect(await screen.findByText(ar('student.checkoutProcessing.title'))).toBeTruthy();
    await elapse(CHECKOUT_POLLING.confirmationTimeoutSeconds * 1_000);

    expect(await screen.findByText(ar('student.checkoutProcessing.delayed.title'))).toBeTruthy();
    expect(screen.getByText(ar('student.checkoutProcessing.delayed.inApp'))).toBeTruthy();
    expect(screen.queryByText(ar('student.checkoutProcessing.delayed.text'))).toBeNull();
    expect(screen.queryByText(ar('student.checkoutFailed.title'))).toBeNull();
    const reads = statusCalls();
    await elapse(60_000);
    expect(statusCalls()).toBe(reads);

    fireEvent.press(screen.getByText(ar('student.checkout.toEnrollments')));
    expect(mockReplace).toHaveBeenCalledWith(ENROLLMENTS);
  });

  it('released, reads again on a return to the foreground and opens success when confirmed', async () => {
    jest.useFakeTimers();
    mockApi.api.checkout.status.query.mockResolvedValue(pending);
    await renderIn('rtl', within(<Processing />)());
    expect(await screen.findByText(ar('student.checkoutProcessing.title'))).toBeTruthy();
    await elapse(CHECKOUT_POLLING.confirmationTimeoutSeconds * 1_000);
    expect(await screen.findByText(ar('student.checkoutProcessing.delayed.title'))).toBeTruthy();

    mockApi.api.checkout.status.query.mockResolvedValue(confirmed);
    const reads = statusCalls();
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await jest.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route('confirmed')));
    expect(statusCalls()).toBe(reads + 1);
  });

  it.each<[string, CheckoutStatusOutput, string]>([
    ['an order the gateway failed', failed, 'failed'],
    ['a paid order the slot could not honour', slotUnavailable, 'slot-unavailable'],
    [
      'an enrollment cancelled on expiry',
      {
        ...pending,
        status: 'cancelled',
        cancellationReason: 'payment_expired',
        lastOrder: { status: 'expired', reference: REFERENCE },
      },
      'expired',
    ],
  ])('leaves for the outcome the server reports: %s', async (_name, status, screenName) => {
    mockApi.api.checkout.status.query.mockResolvedValue(status);
    await renderIn('rtl', within(<Processing />)());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route(screenName)));
  });

  it('stays on Processing while an expired order’s hold grace runs (no failure claimed)', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue({
      ...pending,
      lastOrder: { status: 'expired', reference: REFERENCE },
    });
    await renderIn('rtl', within(<Processing />)());
    const line = ar('student.checkoutProcessing.summary', {
      package: packageShort('rtl'),
      amount: pounds('rtl'),
    });
    expect(await screen.findByText(line)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('a RATE_LIMITED status read with nothing read yet says when to try again (T065)', async () => {
    mockApi.api.checkout.status.query.mockRejectedValue(rateLimited('61'));
    await inBothDirections(within(<Processing />), async (_rendered, direction) => {
      await saysTryAgainIn(direction, 2);
    });
  });

  it('a failed configuration read says its own refusal before the status read’s (T065)', async () => {
    mockApi.value.client.publicConfig.mockRejectedValue(rateLimited('61'));
    mockApi.api.checkout.status.query.mockRejectedValue(rateLimited('180'));
    await inBothDirections(within(<Processing />), async (_rendered, direction) => {
      await saysTryAgainIn(direction, 2);
      expect(
        screen.queryByText(said(direction, 'common.state.rateLimitedIn', { count: 3 })),
      ).toBeNull();
    });
  });
});

describe('PaymentSuccess', () => {
  const first = sessions[0]!;
  const last = sessions[sessions.length - 1]!;

  it('on the server’s confirmed: the receipt, the reference, the amount and the sessions', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(confirmed);
    await inBothDirections(within(<PaymentSuccess />), async (_rendered, direction) => {
      const locale = localeOf(direction);
      expect(
        await screen.findByText(said(direction, 'student.checkoutConfirmed.title')),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'student.checkoutConfirmed.lede', {
            weekday: formatWeekday(weekdayIn(first.startsAt, STUDENT_ZONE), locale),
            time: formatTime(first.startsAt, STUDENT_ZONE, locale),
            date: formatDate(first.startsAt, STUDENT_ZONE, locale),
          }),
        ),
      ).toBeTruthy();
      expect(
        screen.getByLabelText(said(direction, 'student.checkoutConfirmed.a11y.receipt')),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'common.package.withTeacher', {
            teacher: summary.teacher.displayName,
            package: packageShort(direction),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'common.track.recitation'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.checkout.orderNumber'))).toBeTruthy();
      expect(screen.getByText(REFERENCE_RUN)).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.checkout.amountPaid'))).toBeTruthy();
      expect(screen.getByText(pounds(direction))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.checkoutConfirmed.sessions'))).toBeTruthy();
      for (const session of sessions.slice(0, 2)) {
        expect(
          screen.getByText(
            said(direction, 'student.checkoutConfirmed.sessionN', { n: session.sequenceNumber }),
          ),
        ).toBeTruthy();
        expect(
          screen.getByText(
            said(direction, 'student.checkoutConfirmed.sessionDate', {
              date: formatDate(session.startsAt, STUDENT_ZONE, locale),
              time: formatTime(session.startsAt, STUDENT_ZONE, locale),
            }),
          ),
        ).toBeTruthy();
      }
      expect(
        screen.queryByText(said(direction, 'student.checkoutConfirmed.sessionN', { n: 3 })),
      ).toBeNull();
      expect(
        screen.getByText(
          said(direction, 'student.checkoutConfirmed.untilSession', {
            n: last.sequenceNumber,
            date: formatDate(last.startsAt, STUDENT_ZONE, locale),
          }),
        ),
      ).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('says plainly that the first session moved, with the new date', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue({
      ...confirmed,
      firstSessionMoved: { quoted: '2026-11-05', actual: '2026-11-12' },
    });
    await inBothDirections(within(<PaymentSuccess />), async (_rendered, direction) => {
      const locale = localeOf(direction);
      expect(
        await screen.findByText(
          said(direction, 'student.checkoutConfirmed.firstSessionMoved', {
            quoted: formatCalendarDate('2026-11-05', locale),
            actual: formatCalendarDate('2026-11-12', locale),
          }),
        ),
      ).toBeTruthy();
    });
  });

  it('says nothing of a move when the first session is the one the student was shown', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(confirmed);
    await renderIn('rtl', within(<PaymentSuccess />)());
    expect(await screen.findByText(ar('student.checkoutConfirmed.title'))).toBeTruthy();
    expect(screen.queryByText(/تأخّر تأكيد الدفع/u)).toBeNull();
  });

  it('never draws success unless the server reports confirmed: back to Processing', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue({
      ...pending,
      lastOrder: { status: 'paid', reference: REFERENCE },
    });
    await renderIn('rtl', within(<PaymentSuccess />)());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route('processing')));
    expect(screen.queryByText(ar('student.checkoutConfirmed.title'))).toBeNull();
    expect(screen.queryByText(REFERENCE_RUN)).toBeNull();
  });

  it('leaves for the enrollments', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(confirmed);
    await renderIn('rtl', within(<PaymentSuccess />)());
    fireEvent.press(await screen.findByText(ar('student.checkout.toEnrollments')));
    expect(mockReplace).toHaveBeenCalledWith(ENROLLMENTS);
  });

  it('a RATE_LIMITED status read says when to try again (T065)', async () => {
    mockApi.api.checkout.status.query.mockRejectedValue(rateLimited('61'));
    await inBothDirections(within(<PaymentSuccess />), async (_rendered, direction) => {
      await saysTryAgainIn(direction, 2);
    });
  });
});

describe('PaymentFailed', () => {
  it('says the payment was not completed, with the package, the teacher and the two ways on', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(failed);
    await inBothDirections(within(<PaymentFailed />), async (_rendered, direction) => {
      expect(await screen.findByText(said(direction, 'student.checkoutFailed.title'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.checkoutFailed.lede'))).toBeTruthy();
      expect(screen.getByText(packageShort(direction))).toBeTruthy();
      expect(screen.getByText(summary.teacher.displayName)).toBeTruthy();
      expect(screen.getByText(said(direction, 'common.action.retry'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'student.checkoutFailed.chooseAnotherSlot')),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.track.recitation'))).toBeNull();
    });
  });

  it('Retry: a new order on the same hold, its hosted page, then Processing', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(failed);
    mockApi.api.checkout.retry.mutate.mockResolvedValue({
      checkoutUrl: CHECKOUT_URL,
      orderExpiresAt: '2026-11-03T10:10:00Z',
    });
    await renderIn('rtl', within(<PaymentFailed />)());
    fireEvent.press(await screen.findByText(ar('common.action.retry')));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route('processing')));
    expect(mockApi.api.checkout.retry.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      idempotencyKey: 'retry-key-1',
    });
    expect(mockOpenAuthSession).toHaveBeenCalledWith(CHECKOUT_URL, 'ijazah://checkout/return');
    expect(mockOpenAuthSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockReplace.mock.invocationCallOrder[0]!,
    );
  });

  it('Retry past the hold’s last order: CheckoutExpired, no page opened', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(failed);
    mockApi.api.checkout.retry.mutate.mockRejectedValue(apiError('ORDER_NOT_PAYABLE'));
    await renderIn('rtl', within(<PaymentFailed />)());
    fireEvent.press(await screen.findByText(ar('common.action.retry')));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route('expired')));
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
  });

  it('a Retry that did not go through says so, and the next press repeats the same key', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(failed);
    mockApi.api.checkout.retry.mutate.mockRejectedValueOnce(apiError('INTERNAL'));
    mockApi.api.checkout.retry.mutate.mockResolvedValueOnce({
      checkoutUrl: CHECKOUT_URL,
      orderExpiresAt: '2026-11-03T10:10:00Z',
    });
    await renderIn('rtl', within(<PaymentFailed />)());
    fireEvent.press(await screen.findByText(ar('common.action.retry')));
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText(ar('common.action.retry')));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route('processing')));
    const keys = mockApi.api.checkout.retry.mutate.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual(['retry-key-1', 'retry-key-1']);
  });

  it('another slot opens the teacher’s page', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(failed);
    await renderIn('rtl', within(<PaymentFailed />)());
    fireEvent.press(await screen.findByText(ar('student.checkoutFailed.chooseAnotherSlot')));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(student)/discovery/[teacherId]',
      params: { teacherId: TEACHER_ID },
    });
  });

  it('draws no failure the server did not report: confirmed goes to success', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(confirmed);
    await renderIn('rtl', within(<PaymentFailed />)());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route('confirmed')));
    expect(screen.queryByText(ar('student.checkoutFailed.title'))).toBeNull();
  });
});

describe('PaymentSlotUnavailable', () => {
  it('says the payment arrived but the booking was cancelled, with the order and the amount', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(slotUnavailable);
    await inBothDirections(within(<PaymentSlotUnavailable />), async (_rendered, direction) => {
      expect(
        await screen.findByText(said(direction, 'student.checkoutSlotUnavailable.title')),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'student.checkoutSlotUnavailable.lede')),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'common.package.withTeacher', {
            teacher: summary.teacher.displayName,
            package: packageShort(direction),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(REFERENCE_RUN)).toBeTruthy();
      expect(screen.getByText(said(direction, 'student.checkout.amountPaid'))).toBeTruthy();
      expect(screen.getByText(pounds(direction))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'student.checkoutSlotUnavailable.enrollmentStatus')),
      ).toBeTruthy();
      expect(screen.getByText(said(direction, 'status.enrollment.cancelled'))).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.track.recitation'))).toBeNull();
    });
  });

  it('leaves for the enrollments', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(slotUnavailable);
    await renderIn('rtl', within(<PaymentSlotUnavailable />)());
    fireEvent.press(await screen.findByText(ar('student.checkout.toEnrollments')));
    expect(mockReplace).toHaveBeenCalledWith(ENROLLMENTS);
  });

  it('draws nothing of it for an enrollment the server did not cancel', async () => {
    mockApi.api.checkout.status.query.mockResolvedValue(pending);
    await renderIn('rtl', within(<PaymentSlotUnavailable />)());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route('processing')));
    expect(screen.queryByText(ar('student.checkoutSlotUnavailable.title'))).toBeNull();
  });

  it('a RATE_LIMITED status read says when to try again (T065)', async () => {
    mockApi.api.checkout.status.query.mockRejectedValue(rateLimited('61'));
    await inBothDirections(within(<PaymentSlotUnavailable />), async (_rendered, direction) => {
      await saysTryAgainIn(direction, 2);
    });
  });
});
