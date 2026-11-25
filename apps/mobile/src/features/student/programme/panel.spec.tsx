// 006:T019 (FR-706, FR-706b, FR-710, FR-713, FR-713a, FR-715, FR-716, FR-726, FR-BOOK-19): the
// student's programme on the enrollment's page, in Arabic and English, read from `programme.get`.
// The offer with its total, its months and its deadline as a date and a time; «pay in full» or
// «pay monthly», the consent line on «monthly» only, unticked; the cancellation behind a dialog.
// While the teacher's payment details are unverified (`payeePending`) the line and no pay button;
// while an administrator decides (`payBlocked`) its line, no pay button, the cancellation kept. A
// running programme: the months paid and the next due; «renew now» with no card, «pay now» and
// «change card» with one, from `renewOpen`; none while `payeePending` or `chargePending`, each with
// its line; the automatic renewal's off row only while a card is saved, behind a dialog. Paused
// since when; the teacher unavailable. Each payment opens the gateway's hosted page through the
// checkout's `hosted.ts`. An enrollment that is no programme (NOT_FOUND) shows none of it.
import type {
  EnrollmentsGetOutput,
  ListedSession,
  MeOutput,
  ProgrammeGetOutput,
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
const PROCESSING = {
  pathname: '/(student)/checkout/processing',
  params: { enrollmentId: ENROLLMENT_ID },
};

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
};

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

  it('pays monthly with the consent given, then opens the hosted page and goes to processing', async () => {
    get().mockResolvedValue(offered());
    await renderIn('rtl', ui());
    await shown('rtl');
    await fireEvent.press(screen.getByRole('radio', { name: ar('programme.student.pay.planMonthly') }));
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByRole('button', { name: ar('programme.student.pay.monthly') }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(PROCESSING));
    expect(mockApi.api.programme.pay.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      plan: 'monthly',
      saveCard: true,
      idempotencyKey: 'programme-key-1',
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(CHECKOUT_URL, 'ijazah://checkout/return');
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
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(PROCESSING));
    expect(mockApi.api.programme.renew.mutate).toHaveBeenCalledWith({
      enrollmentId: ENROLLMENT_ID,
      saveCard: false,
      idempotencyKey: 'programme-key-1',
    });
    expect(mockOpenAuth).toHaveBeenCalledWith(CHECKOUT_URL, 'ijazah://checkout/return');
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
    await fireEvent.press(
      screen.getByRole('button', { name: ar('programme.student.renew.changeCard') }),
    );
    await waitFor(() => expect(mockApi.api.programme.renew.mutate).toHaveBeenCalled());
    expect(mockApi.api.programme.renew.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ saveCard: true }),
    );
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
  it('NOT_FOUND: no programme part', async () => {
    await inBothDirections(ui, async (_rendered, direction) => {
      expect(await screen.findByText(TEACHER)).toBeTruthy();
      await waitFor(() => expect(get()).toHaveBeenCalled());
      expect(screen.queryByText(said(direction, 'programme.student.title'))).toBeNull();
    });
  });
});
