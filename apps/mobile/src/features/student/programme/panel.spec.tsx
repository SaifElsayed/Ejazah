// 006:T019 (FR-706, FR-706b, FR-710, FR-713, FR-713a, FR-715, FR-716, FR-726, FR-BOOK-19): the
// student's programme on the enrollment's page, in Arabic and English, read from `programme.get`.
// The offer with its total, its months and its deadline as a date and a time; «pay in full» or
// «pay monthly», the consent line on «monthly» only, unticked; the cancellation behind a dialog.
// While the teacher's payment details are unverified (`payeePending`) the line and no pay button;
// while an administrator decides (`payBlocked`) its line, no pay button, the cancellation kept. A
// running programme: the months paid and the next due; «renew now» with no card, «pay now» and
// «change card» with one, from `renewOpen`, «change card» behind the same consent line, unticked and
// required (PR #161 r1 Follow-up 1 (a)); none while `payeePending` or `chargePending`, each with
// its line; the automatic renewal's off row only while a card is saved, behind a dialog. Paused
// since when; the teacher unavailable. Each payment opens the gateway's hosted page through the
// checkout's `hosted.ts`, and once it closes the student stays on the page, read again, never sent to
// `processing` or its «payment success» (Q-A1 (a), R-HONEST-1). The cancellation is worded as declining
// the offer; refused `payment_processing`, it says so. An enrollment that is no programme (NOT_FOUND)
// shows none of it. After lane s's contract (B-P4, Q-3 (a), Q-5 (b), Q-4 (a)): the panel hangs on the
// enrollment's `programme` marker, and an enrollment without one reads no `programme.get`; the
// reminder «ادفع قبل {date} {time}» shows from the marker's `payReminderFrom` while `offered`, never
// with no instant or before it; a programme of more than 51 sessions is drawn.
import {
  enrollmentsGetOutput,
  type EnrollmentsGetOutput,
  type ListedSession,
  type MeOutput,
  type ProgrammeGetOutput,
} from '@ijazah/contracts';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piasters } from '@ijazah/money';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { inBothDirections, renderIn } from '../../../design/primitives/__tests__/harness';
import { type MessageKey, type MessageValues, translate } from '../../../i18n';
import { ME_QUERY_KEY } from '../../../lib/account';
import type { Direction } from '../../../lib/direction';
import { formatDate, formatNumber, formatPounds, formatTime } from '../../../lib/formatters';
import { apiError, fakeApi } from '../../shared/__tests__/api-double';
import { EnrollmentDetail } from '../enrollments';

let mockApi = fakeApi();
jest.mock('../../../lib/api', () => ({ useApi: () => mockApi.value }));
const mockRouter = { push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => mockRouter.push(route),
    navigate: (route: unknown) => mockRouter.navigate(route),
    replace: (route: unknown) => mockRouter.replace(route),
    back: () => mockRouter.back(),
  },
  useLocalSearchParams: () => ({ id: '0193a6f0-0000-7000-8000-0000000000e1' }),
}));
const mockOpenAuth = jest.fn(async (_url: string, _back: string) => ({ type: 'cancel' }));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (url: string, back: string) => mockOpenAuth(url, back),
}));
let mockKey = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `programme-key-${++mockKey}` }));

const ENROLLMENT_ID = '0193a6f0-0000-7000-8000-0000000000e1';
const CAIRO = 'Africa/Cairo';
const TEACHER = 'الشيخ أحمد المصري';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const CHECKOUT_URL = 'https://pay.ijazah.test/checkout/p1';

const assessment: ListedSession = {
  sessionId: '0193a6f0-0000-7000-8000-000000000501',
  sequenceNumber: 1,
  localDate: '2026-11-19',
  startTimeLocal: '20:00',
  timezone: CAIRO,
  startsAt: '2026-11-19T18:00:00.000Z',
  endsAt: '2026-11-19T18:30:00.000Z',
  status: 'done',
  pendingCancellation: false,
  disputed: false,
};

/** The programme's enrollment, `ijazah_track`, confirmed on its assessment. */
const detail: EnrollmentsGetOutput = {
  enrollmentId: ENROLLMENT_ID,
  teacher: {
    teacherId: '0193a6f0-0000-7000-8000-0000000000d1',
    displayName: TEACHER,
    displayNameOrNull: TEACHER,
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
  complaintOpen: false,
  ijazahRequest: null,
  programme: { state: 'active', payBy: null, payReminderFrom: null },
};

/** An ijazah-track enrollment that is no programme: no marker (a pre-switch package). */
const { programme: _marker, ...notAProgramme } = detail;

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
const CARD = { last4: '4242', brand: 'Visa' } as const;
/** Wednesday 18:00 in Cairo: the offer of Monday 18:00 plus its 48 hours. */
const PAY_BY = '2026-11-25T16:00:00.000Z';
const NEXT_DUE = '2026-12-21T18:00:00.000Z';
const SINCE = '2026-12-21T18:00:00.000Z';

function programme(of: Partial<ProgrammeGetOutput> = {}): ProgrammeGetOutput {
  return {
    state: 'active',
    offerDueAt: '2026-11-20T18:30:00.000Z',
    payBy: PAY_BY,
    offer: OFFER,
    plan: 'monthly',
    monthsPaid: 2,
    monthCount: 10,
    nextDueAt: NEXT_DUE,
    paused: null,
    renewOpen: false,
    chargePending: false,
    payeePending: false,
    payBlocked: false,
    teacherUnavailable: false,
    card: null,
    stopRequestFrom: null,
    payReminderFrom: null,
    // B-P4 round 2 (Q-B2 (a), Q-B3 (a); rule d): the teacher's two fields, none to the student.
    offerTerms: null,
    stopRequestOpen: false,
    ...of,
  };
}
const offered = (of: Partial<ProgrammeGetOutput> = {}) =>
  programme({ state: 'offered', plan: null, monthsPaid: 0, nextDueAt: null, ...of });

const me = { userId: '0193a6f0-0000-7000-8000-000000000001', timezone: CAIRO } as MeOutput;
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
const get = () => mockApi.api.programme.get.query;
/** The hosted page opened, and `programme.get` was read after it closed. */
const readAfterTheHostedPage = () => {
  const opened = mockOpenAuth.mock.invocationCallOrder.at(-1);
  const read = get().mock.invocationCallOrder.at(-1);
  return opened !== undefined && read !== undefined && read > opened;
};

let queries: QueryClient;
const ui = () => (
  <QueryClientProvider client={queries}>
    <EnrollmentDetail />
  </QueryClientProvider>
);

beforeEach(() => {
  mockApi = fakeApi();
  mockKey = 0;
  for (const call of Object.values(mockRouter)) call.mockReset();
  mockOpenAuth.mockClear();
  Object.assign(mockApi.api.account, {
    pushToken: { register: { mutate: jest.fn(async () => undefined) } },
  });
  mockApi.api.enrollments.get.query.mockResolvedValue(detail);
  mockApi.api.programme.pay.mutate.mockResolvedValue({ checkoutUrl: CHECKOUT_URL });
  mockApi.api.programme.renew.mutate.mockResolvedValue({ checkoutUrl: CHECKOUT_URL });
  mockApi.api.programme.autoRenewOff.mutate.mockResolvedValue({ ok: true });
  mockApi.api.programme.cancel.mutate.mockResolvedValue({ ok: true });
  onlineManager.setOnline(true);
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queries.setQueryData(ME_QUERY_KEY, me);
});

afterEach(async () => {
  await cleanup();
  onlineManager.setOnline(true);
  queries.clear();
});

/** The panel has drawn: its title. */
const shown = async (direction: Direction) =>
  expect(await screen.findByText(said(direction, 'programme.student.title'))).toBeTruthy();

describe('the offer (FR-706, FR-710, FR-713)', () => {
  it('shows the offer: its texts, sessions, total, months and the deadline as a date and a time', async () => {
    get().mockResolvedValue(offered());
    await inBothDirections(ui, async (_rendered, direction) => {
      const locale = localeOf(direction);
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.state.offered'))).toBeTruthy();
      expect(screen.getByText(said(direction, 'programme.student.offer.title'))).toBeTruthy();
      expect(screen.getByText(OFFER.level)).toBeTruthy();
      expect(screen.getByText(OFFER.readiness)).toBeTruthy();
      expect(screen.getByText(OFFER.expectedLength)).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'common.format.packageLine', { count: 40, minutes: 60 }),
        ),
      ).toBeTruthy();
      expect(screen.getByText(formatPounds(piasters(1_000_000), locale))).toBeTruthy();
      expect(screen.getByText(formatNumber(10, locale))).toBeTruthy();
      expect(screen.getByText(when(direction, PAY_BY))).toBeTruthy();
      expect(button(direction, 'programme.student.pay.inFull')).toBeTruthy();
      expect(button(direction, 'programme.student.cancel.action')).toBeTruthy();
    });
  });

  it('no consent line on in full; «monthly» shows it unticked', async () => {
    get().mockResolvedValue(offered());
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.queryByText(said(direction, 'programme.student.consent'))).toBeNull();
      await fireEvent.press(
        screen.getByRole('radio', { name: said(direction, 'programme.student.pay.planMonthly') }),
      );
      expect(screen.getByText(said(direction, 'programme.student.consent'))).toBeTruthy();
      expect(screen.getByRole('checkbox').props.accessibilityState).toMatchObject({
        checked: false,
      });
      expect(button(direction, 'programme.student.pay.monthly')).toBeTruthy();
      expect(button(direction, 'programme.student.pay.inFull')).toBeNull();
    });
  });

  it('pays monthly with the consent given, opens the hosted page, then stays here and reads again', async () => {
    get().mockResolvedValue(offered());
    await renderIn('rtl', ui());
    await shown('rtl');
    await fireEvent.press(screen.getByRole('radio', { name: ar('programme.student.pay.planMonthly') }));
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: ar('programme.student.pay.monthly') }));
    await waitFor(() => expect(readAfterTheHostedPage()).toBe(true));
    expect(mockApi.api.programme.pay.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      plan: 'monthly',
      saveCard: true,
      idempotencyKey: 'programme-key-1',
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(CHECKOUT_URL, 'ijazah://checkout/return');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('monthly with the box left unticked sends saveCard: false (renewed by hand)', async () => {
    get().mockResolvedValue(offered());
    await renderIn('rtl', ui());
    await shown('rtl');
    await fireEvent.press(screen.getByRole('radio', { name: ar('programme.student.pay.planMonthly') }));
    await fireEvent.press(screen.getByRole('button', { name: ar('programme.student.pay.monthly') }));
    await waitFor(() => expect(mockApi.api.programme.pay.mutate).toHaveBeenCalled());
    expect(mockApi.api.programme.pay.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'monthly', saveCard: false }),
    );
  });

  it('in full sends saveCard: false, even after the box was ticked on «monthly»', async () => {
    get().mockResolvedValue(offered());
    await renderIn('rtl', ui());
    await shown('rtl');
    await fireEvent.press(screen.getByRole('radio', { name: ar('programme.student.pay.planMonthly') }));
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('radio', { name: ar('programme.student.pay.planInFull') }));
    await fireEvent.press(screen.getByRole('button', { name: ar('programme.student.pay.inFull') }));
    await waitFor(() => expect(mockApi.api.programme.pay.mutate).toHaveBeenCalled());
    expect(mockApi.api.programme.pay.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'in_full', saveCard: false }),
    );
  });

  it('no pay button while payeePending: the line, the cancellation kept', async () => {
    get().mockResolvedValue(offered({ payeePending: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.payeePending'))).toBeTruthy();
      expect(button(direction, 'programme.student.pay.inFull')).toBeNull();
      expect(button(direction, 'programme.student.pay.monthly')).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();
      expect(button(direction, 'programme.student.cancel.action')).toBeTruthy();
    });
  });

  it('no pay button while payBlocked: the administration’s line, the cancellation kept', async () => {
    get().mockResolvedValue(offered({ payBlocked: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.payBlocked'))).toBeTruthy();
      expect(button(direction, 'programme.student.pay.inFull')).toBeNull();
      expect(button(direction, 'programme.student.pay.monthly')).toBeNull();
      expect(button(direction, 'programme.student.cancel.action')).toBeTruthy();
    });
  });

  it('cancels behind a dialog that says the fee is kept', async () => {
    get().mockResolvedValue(offered({ payBlocked: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'programme.student.cancel.action') }),
      );
      expect(screen.getByText(said(direction, 'programme.student.cancel.dialog.text'))).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'programme.student.cancel.dialog.confirm'),
        }),
      );
      await waitFor(() => expect(mockApi.api.programme.cancel.mutate).toHaveBeenCalled());
    });
    expect(mockApi.api.programme.cancel.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      idempotencyKey: expect.stringMatching(/^programme-key-/),
    });
  });

  it('a declining refused payment_processing says the payment is being confirmed, not the generic error', async () => {
    get().mockResolvedValue(offered());
    mockApi.api.programme.cancel.mutate.mockRejectedValue(
      apiError('CONFLICT', [{ path: 'cause', code: 'payment_processing' }]),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'programme.student.cancel.action') }),
      );
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'programme.student.cancel.dialog.confirm'),
        }),
      );
      expect(
        await screen.findByText(said(direction, 'programme.student.cancel.paymentProcessing')),
      ).toBeTruthy();
      expect(screen.queryByText(said(direction, 'common.state.actionError'))).toBeNull();
    });
  });

  it('another refusal of the declining is the generic error', async () => {
    get().mockResolvedValue(offered());
    mockApi.api.programme.cancel.mutate.mockRejectedValue(
      apiError('CONFLICT', [{ path: 'cause', code: 'assessment_not_settled' }]),
    );
    await renderIn('rtl', ui());
    await shown('rtl');
    await fireEvent.press(screen.getByRole('button', { name: ar('programme.student.cancel.action') }));
    await fireEvent.press(
      screen.getByRole('button', { name: ar('programme.student.cancel.dialog.confirm') }),
    );
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(screen.queryByText(ar('programme.student.cancel.paymentProcessing'))).toBeNull();
  });

  it('PREVIOUS_CHECKOUT goes to the previous checkout; another refusal is said in place', async () => {
    get().mockResolvedValue(offered());
    mockApi.api.programme.pay.mutate.mockRejectedValueOnce(apiError('PREVIOUS_CHECKOUT'));
    mockApi.api.programme.pay.mutate.mockRejectedValueOnce(
      apiError('CONFLICT', [{ path: 'cause', code: 'pay_by_passed' }]),
    );
    await renderIn('rtl', ui());
    await shown('rtl');
    const pay = () =>
      fireEvent.press(screen.getByRole('button', { name: ar('programme.student.pay.inFull') }));
    await pay();
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith('/(student)/checkout/previous'),
    );
    await pay();
    expect(await screen.findByText(ar('common.state.actionError'))).toBeTruthy();
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });
});

describe('a running programme (FR-713a, FR-715, FR-716, FR-726)', () => {
  it('the months paid and the next due as a date and a time', async () => {
    get().mockResolvedValue(programme());
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.state.active'))).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'programme.student.months', { paid: 2, count: 10 })),
      ).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.student.nextDue', { when: when(direction, NEXT_DUE) }),
        ),
      ).toBeTruthy();
      // No offer part once paid.
      expect(button(direction, 'programme.student.pay.inFull')).toBeNull();
      expect(button(direction, 'programme.student.cancel.action')).toBeNull();
    });
  });

  it('«renew now» with no card saved, sent without saving one', async () => {
    get().mockResolvedValue(programme({ renewOpen: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(button(direction, 'programme.student.renew.now')).toBeTruthy();
      expect(button(direction, 'programme.student.renew.payNow')).toBeNull();
      expect(button(direction, 'programme.student.renew.changeCard')).toBeNull();
    });
    await renderIn('rtl', ui());
    await shown('rtl');
    await fireEvent.press(screen.getByRole('button', { name: ar('programme.student.renew.now') }));
    await waitFor(() => expect(readAfterTheHostedPage()).toBe(true));
    expect(mockApi.api.programme.renew.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      saveCard: false,
      idempotencyKey: 'programme-key-1',
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(CHECKOUT_URL, 'ijazah://checkout/return');
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('«pay now» and «change card» with a card saved; change card saves the new one', async () => {
    get().mockResolvedValue(programme({ renewOpen: true, card: CARD }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(button(direction, 'programme.student.renew.payNow')).toBeTruthy();
      expect(button(direction, 'programme.student.renew.changeCard')).toBeTruthy();
      expect(button(direction, 'programme.student.renew.now')).toBeNull();
    });
    await renderIn('rtl', ui());
    await shown('rtl');
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(
      screen.getByRole('button', { name: ar('programme.student.renew.changeCard') }),
    );
    await waitFor(() => expect(readAfterTheHostedPage()).toBe(true));
    expect(mockApi.api.programme.renew.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      saveCard: true,
      idempotencyKey: 'programme-key-1',
    });
  });

  // PR #161 r1 Follow-up 1 (a): FR-713's consent line before the new card is saved.
  it('«change card» shows the consent line unticked; unticked, it sends nothing, and «pay now» needs no tick', async () => {
    get().mockResolvedValue(programme({ renewOpen: true, card: CARD }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.consent'))).toBeTruthy();
      expect(screen.getByRole('checkbox').props.accessibilityState).toMatchObject({
        checked: false,
      });
    });
    await renderIn('rtl', ui());
    await shown('rtl');
    await fireEvent.press(
      screen.getByRole('button', { name: ar('programme.student.renew.changeCard') }),
    );
    await fireEvent.press(screen.getByRole('button', { name: ar('programme.student.renew.payNow') }));
    await waitFor(() => expect(readAfterTheHostedPage()).toBe(true));
    expect(mockApi.api.programme.renew.mutate).toHaveBeenCalledTimes(1);
    expect(mockApi.api.programme.renew.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      saveCard: false,
      idempotencyKey: 'programme-key-1',
    });
  });

  it('no pay now or change card while payeePending: the line instead', async () => {
    get().mockResolvedValue(programme({ renewOpen: true, card: CARD, payeePending: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.payeePending'))).toBeTruthy();
      expect(button(direction, 'programme.student.renew.payNow')).toBeNull();
      expect(button(direction, 'programme.student.renew.changeCard')).toBeNull();
      expect(button(direction, 'programme.student.renew.now')).toBeNull();
    });
  });

  it('no renewal while chargePending: the line that this month’s charge is under way', async () => {
    get().mockResolvedValue(programme({ renewOpen: true, card: CARD, chargePending: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.chargePending'))).toBeTruthy();
      expect(button(direction, 'programme.student.renew.payNow')).toBeNull();
      expect(button(direction, 'programme.student.renew.changeCard')).toBeNull();
    });
  });

  it('the automatic renewal: the card by its brand and last four, turned off behind a dialog', async () => {
    get().mockResolvedValue(programme({ card: CARD }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(
        screen.getByText(
          said(direction, 'programme.student.autoRenew.cardLine', CARD),
        ),
      ).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', { name: said(direction, 'programme.student.autoRenew.off') }),
      );
      expect(
        screen.getByText(said(direction, 'programme.student.autoRenew.dialog.text')),
      ).toBeTruthy();
      await fireEvent.press(
        screen.getByRole('button', {
          name: said(direction, 'programme.student.autoRenew.dialog.confirm'),
        }),
      );
      await waitFor(() => expect(mockApi.api.programme.autoRenewOff.mutate).toHaveBeenCalled());
    });
    expect(mockApi.api.programme.autoRenewOff.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      idempotencyKey: expect.stringMatching(/^programme-key-/),
    });
  });

  it('no off row without a card', async () => {
    get().mockResolvedValue(programme({ card: null }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(button(direction, 'programme.student.autoRenew.off')).toBeNull();
    });
  });

  it('paused: the line with since when, and the renewal', async () => {
    get().mockResolvedValue(
      programme({ state: 'paused', paused: { since: SINCE }, renewOpen: true }),
    );
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.state.paused'))).toBeTruthy();
      expect(
        screen.getByText(
          said(direction, 'programme.student.paused', { when: when(direction, SINCE) }),
        ),
      ).toBeTruthy();
      expect(button(direction, 'programme.student.renew.now')).toBeTruthy();
    });
  });

  it('the teacher unavailable (FR-BOOK-19)', async () => {
    get().mockResolvedValue(programme({ teacherUnavailable: true }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(said(direction, 'programme.student.unavailable'))).toBeTruthy();
    });
  });
});

describe('an enrollment that is not a programme', () => {
  it('no programme panel on a non-programme enrollment: no marker, programme.get never read', async () => {
    mockApi.api.enrollments.get.query.mockResolvedValue(notAProgramme);
    get().mockResolvedValue(programme());
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      expect(screen.queryByText(said(direction, 'programme.student.title'))).toBeNull();
    });
    expect(get()).not.toHaveBeenCalled();
  });
});

describe('the reminder before the 48 hours end (FR-708, SRS DEC-114)', () => {
  /** The phone's clock is real here: an instant long past, and one far ahead. */
  const PAST = '2026-01-01T00:00:00.000Z';
  const FUTURE = '2099-01-01T00:00:00.000Z';
  const reminder = (direction: Direction) =>
    said(direction, 'programme.student.payReminder', {
      date: formatDate(PAY_BY, CAIRO, localeOf(direction)),
      time: formatTime(PAY_BY, CAIRO, localeOf(direction)),
    });
  const withMarker = (payReminderFrom: string | null, state: 'offered' | 'active' = 'offered') =>
    mockApi.api.enrollments.get.query.mockResolvedValue({
      ...detail,
      programme: { state, payBy: PAY_BY, payReminderFrom },
    });

  it('from payReminderFrom on: «pay before» with payBy as a date and a time', async () => {
    withMarker(PAST);
    get().mockResolvedValue(offered({ payReminderFrom: PAST }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.getByText(reminder(direction))).toBeTruthy();
    });
  });

  it('no line when payReminderFrom is null', async () => {
    withMarker(null);
    get().mockResolvedValue(offered());
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.queryByText(reminder(direction))).toBeNull();
    });
  });

  it('no line when payReminderFrom is in the future', async () => {
    withMarker(FUTURE);
    get().mockResolvedValue(offered({ payReminderFrom: FUTURE }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(screen.queryByText(reminder(direction))).toBeNull();
    });
  });
});

describe('a programme of more than 51 sessions (Q-4 (a))', () => {
  it('an answer with 61 sessions is a valid enrollment, drawn with its count and its programme', async () => {
    const long = enrollmentsGetOutput.parse({
      ...detail,
      summary: { ...detail.summary, sessionCount: 61, sessionDurationMinutes: 60 },
    });
    mockApi.api.enrollments.get.query.mockResolvedValue(long);
    get().mockResolvedValue(programme({ offer: { ...OFFER, sessionCount: 60 }, monthCount: 15 }));
    await inBothDirections(ui, async (_rendered, direction) => {
      await shown(direction);
      expect(
        screen.getByText(
          said(direction, 'common.format.packageFull', {
            subject: direction === 'rtl' ? QURAN.nameAr : QURAN.nameEn,
            count: 61,
            minutes: 60,
          }),
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(said(direction, 'programme.student.months', { paid: 2, count: 15 })),
      ).toBeTruthy();
    });
  });
});
