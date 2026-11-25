// 006:T021 (FR-727; SRS DEC-112, DEC-113; admin-surface.md `programmes.queue`, `programmes.get`): the
// ijazah programmes' queue and one programme's page through the router, in both languages. The tabs
// are paused, stop, no_offer, pay_blocked and charge_unknown, with no `refusal` tab; each tab says
// what its items are; the rows as the server answers them, oldest first, each with how late it is,
// its parties, its state, and its item's own words (the teacher's reason on a stop, the recorded
// reason on a no_offer item, «the assessment was not held», whether the payout account is verified
// now); pages by the server's cursor. A row opens the programme beside the table: its months, its
// offer, its orders by kind with a link each to the monitor, its items with their reasons, whether a
// card is saved (never a card detail).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { dayMonth, formatPounds } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { currentPath, inBothLocales, refusal, renderApp } from '../../test/app-harness';
import { piasters } from '@ijazah/money';
import {
  daysAgo,
  detailOf,
  E1,
  E2,
  fakeApi,
  O_ASSESSMENT,
  O_MONTH,
  openPage,
  R1,
  R2,
  requestOf,
  rowOf,
} from './programmes-fixtures';

afterEach(() => setLocale('ar'));

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const TAB_KEYS = [
  'admin.programme.tabs.paused',
  'admin.programme.tabs.stop',
  'admin.programme.tabs.noOffer',
  'admin.programme.tabs.payBlocked',
  'admin.programme.tabs.chargeUnknown',
] as const;

async function tabs() {
  const list = await screen.findByRole('tablist');
  return within(list)
    .getAllByRole('tab')
    .map((tab) => tab.textContent);
}

/** The table's row of the student `name`. */
async function rowNamed(text: string) {
  const cells = await screen.findAllByText(text, { exact: false });
  return within(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
}

async function detail() {
  return within(
    await screen.findByRole('complementary', { name: ar('admin.programme.detail.a11y') }),
  );
}

describe('the programmes queue (FR-727)', () => {
  it('draws the five tabs in order, with no refusal tab, the lede and the first tab’s words, in both languages', async () => {
    await inBothLocales(
      () => openPage(),
      async (t) => {
        expect(await screen.findByText(t('admin.programme.lede'))).toBeTruthy();
        expect(await tabs()).toEqual(TAB_KEYS.map((key) => t(key)));
        expect(screen.getByText(t('admin.programme.explain.paused'))).toBeTruthy();
      },
    );
  });

  it('offers no refusal tab and never reads the refusal filter (SRS DEC-112)', async () => {
    const { api } = openPage();
    const shown = await tabs();
    expect(shown).not.toContain(ar('admin.programme.kind.refusal'));
    expect(shown).toHaveLength(5);
    for (const key of TAB_KEYS) fireEvent.click(screen.getByRole('tab', { name: ar(key) }));
    await waitFor(() => expect(api.programmes.queue.query).toHaveBeenCalledTimes(5));
    const filters = api.programmes.queue.query.mock.calls.map(
      ([input]) => (input as { filter: string }).filter,
    );
    expect(filters).toEqual(['paused', 'stop', 'no_offer', 'pay_blocked', 'charge_unknown']);
  });

  it('reads each tab’s items and says what the tab holds', async () => {
    const { api } = openPage();
    fireEvent.click(
      await screen.findByRole('tab', { name: ar('admin.programme.tabs.chargeUnknown') }),
    );
    expect(await screen.findByText(ar('admin.programme.explain.chargeUnknown'))).toBeTruthy();
    await waitFor(() =>
      expect(api.programmes.queue.query).toHaveBeenLastCalledWith({ filter: 'charge_unknown' }),
    );
  });

  it('lists the rows as the server orders them, oldest first, each with its parties, how late it is and its state', async () => {
    const api = fakeApi();
    api.programmes.queue.query.mockResolvedValue({
      items: [
        rowOf('paused', { pausedSince: daysAgo(9) }),
        rowOf('paused', {
          enrollmentId: E2,
          student: { displayName: 'آمال علي' },
          pausedSince: daysAgo(0),
        }),
      ],
    });
    await inBothLocales(
      () => openPage(api),
      async (t, locale) => {
        const zone = panelTimeZone();
        const first = await rowNamed('Huda Samir');
        expect(first.getByText(t('admin.programme.row.late', { days: 9 }))).toBeTruthy();
        expect(
          first.getByText(
            t('admin.programme.row.pausedSince', {
              date: dayMonth(daysAgo(9), locale, zone),
            }),
            { exact: false },
          ),
        ).toBeTruthy();
        expect(first.getByText(t('admin.programme.state.paused'))).toBeTruthy();
        const second = await rowNamed('آمال علي');
        expect(second.getByText(t('admin.programme.row.late', { days: 0 }))).toBeTruthy();
        const order = screen
          .getAllByRole('row')
          .slice(1)
          .map((row) => row.textContent ?? '');
        expect(order[0]).toContain('Huda Samir');
        expect(order[1]).toContain('آمال علي');
      },
    );
  });

  it('shows the teacher’s reason beside a stop request', async () => {
    const api = fakeApi();
    api.programmes.queue.query.mockResolvedValue({
      items: [rowOf('stop', { request: requestOf('stop', { reason: 'الطالب لم يدفع منذ شهر' }) })],
    });
    openPage(api);
    fireEvent.click(await screen.findByRole('tab', { name: ar('admin.programme.tabs.stop') }));
    const row = await rowNamed('Huda Samir');
    expect(
      row.getByText(ar('admin.programme.row.stopReason', { reason: 'الطالب لم يدفع منذ شهر' })),
    ).toBeTruthy();
    expect(row.getByText(ar('admin.programme.kind.stop'))).toBeTruthy();
  });

  it('shows beside a no_offer item its recorded reason, or that none is recorded yet, and «the assessment was not held»', async () => {
    const api = fakeApi();
    api.programmes.queue.query.mockResolvedValue({
      items: [
        rowOf('no_offer', {
          request: requestOf('no_offer', { assessmentHeld: false }),
        }),
        rowOf('no_offer', {
          enrollmentId: E2,
          student: { displayName: 'آمال علي' },
          request: requestOf('no_offer', {
            requestId: R2,
            assessmentHeld: true,
            reason: 'المعلم سافر',
          }),
        }),
      ],
    });
    await inBothLocales(
      () => openPage(api, '/programmes'),
      async (t) => {
        fireEvent.click(
          await screen.findByRole('tab', { name: t('admin.programme.tabs.noOffer') }),
        );
        const open = await rowNamed('Huda Samir');
        expect(open.getByText(t('admin.programme.row.noReasonYet'))).toBeTruthy();
        expect(open.getByText(t('admin.programme.row.assessmentNotHeld'))).toBeTruthy();
        const recorded = await rowNamed('آمال علي');
        expect(
          recorded.getByText(t('admin.programme.row.recordedReason', { reason: 'المعلم سافر' })),
        ).toBeTruthy();
        expect(recorded.queryByText(t('admin.programme.row.assessmentNotHeld'))).toBeNull();
      },
    );
  });

  it('says on a pay_blocked item whether the payout account is verified now', async () => {
    const api = fakeApi();
    api.programmes.queue.query.mockResolvedValue({
      items: [
        rowOf('pay_blocked'),
        rowOf('pay_blocked', {
          enrollmentId: E2,
          student: { displayName: 'آمال علي' },
          payeeVerifiedNow: true,
          request: requestOf('pay_blocked', { requestId: R2 }),
        }),
      ],
    });
    openPage(api);
    fireEvent.click(
      await screen.findByRole('tab', { name: ar('admin.programme.tabs.payBlocked') }),
    );
    expect(
      (await rowNamed('Huda Samir')).getByText(ar('admin.programme.row.payeeUnverified')),
    ).toBeTruthy();
    expect(
      (await rowNamed('آمال علي')).getByText(ar('admin.programme.row.payeeVerified')),
    ).toBeTruthy();
  });

  it('pages by the cursor the server wrote, and a new tab starts at the first page', async () => {
    const api = fakeApi();
    api.programmes.queue.query.mockImplementation(async (input) => {
      const { cursor } = (input ?? {}) as { cursor?: string };
      return cursor === undefined
        ? { items: [rowOf('paused')], nextCursor: E1 }
        : { items: [rowOf('paused', { enrollmentId: E2, student: { displayName: 'آمال علي' } })] };
    });
    openPage(api);
    await rowNamed('Huda Samir');
    fireEvent.click(screen.getByRole('button', { name: ar('admin.common.a11y.nextPage') }));
    await rowNamed('آمال علي');
    expect(api.programmes.queue.query).toHaveBeenLastCalledWith({ filter: 'paused', cursor: E1 });
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.programme.tabs.stop') }));
    await waitFor(() =>
      expect(api.programmes.queue.query).toHaveBeenLastCalledWith({ filter: 'stop' }),
    );
  });

  it('says when a tab holds nothing', async () => {
    openPage();
    expect(await screen.findByText(ar('admin.programme.empty.title'))).toBeTruthy();
    expect(screen.getByText(ar('admin.programme.empty.text'))).toBeTruthy();
  });

  it('says the queue could not load, and reads it again on «إعادة المحاولة»', async () => {
    const api = fakeApi();
    api.programmes.queue.query.mockRejectedValueOnce(refusal('INTERNAL_SERVER_ERROR'));
    openPage(api);
    expect(
      await screen.findByText(
        ar('admin.common.loadError.title', { page: ar('admin.programme.title') }),
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ar('admin.common.action.retry') }));
    expect(await screen.findByText(ar('admin.programme.empty.title'))).toBeTruthy();
  });
});

describe('a programme’s page (FR-726, FR-727)', () => {
  it('opens beside the table from a row, and at once from `?programme=`', async () => {
    const api = fakeApi();
    api.programmes.queue.query.mockResolvedValue({ items: [rowOf('paused')] });
    openPage(api);
    fireEvent.click(
      (
        await screen.findAllByText(ar('admin.programme.row.student', { name: 'Huda Samir' }))
      )[0] as HTMLElement,
    );
    await detail();
    expect(currentPath()).toBe(`/programmes?programme=${E1}`);
    expect(api.programmes.get.query).toHaveBeenCalledWith({ enrollmentId: E1 });
  });

  it('shows the programme’s months, offer, plan and saved card, never a card detail, in both languages', async () => {
    await inBothLocales(
      () => openPage(fakeApi(), `/programmes?programme=${E1}`),
      async (t, locale) => {
        const box = within(
          await screen.findByRole('complementary', { name: t('admin.programme.detail.a11y') }),
        );
        expect(
          await box.findByText(t('admin.programme.detail.monthsOf', { paid: 3, count: 10 })),
        ).toBeTruthy();
        expect(box.getByText(t('admin.programme.detail.planMonthly'))).toBeTruthy();
        expect(
          box.getByText(
            t('admin.programme.detail.offerTerms', {
              sessions: t('admin.common.sessions', { count: 40 }),
              minutes: t('admin.common.minutes', { count: 60 }),
              total: formatPounds(piasters(1_000_000), locale),
            }),
          ),
        ).toBeTruthy();
        expect(box.getByText('يحفظ عشرة أجزاء')).toBeTruthy();
        expect(box.getByText(t('admin.programme.detail.cardSaved'))).toBeTruthy();
        expect(box.getByText(t('admin.common.yes'))).toBeTruthy();
        expect(box.getByText(t('admin.programme.state.paused'))).toBeTruthy();
      },
    );
  });

  it('lists the orders by kind, the month and how each was paid, each with its link to the monitor', async () => {
    openPage(fakeApi(), `/programmes?programme=${E1}`);
    const box = await detail();
    expect(await box.findByText(ar('admin.payments.terms.kind.assessment'))).toBeTruthy();
    expect(box.getByText(ar('admin.payments.terms.kind.instalment'))).toBeTruthy();
    expect(box.getByText(ar('admin.payments.terms.month', { month: 4 }))).toBeTruthy();
    expect(box.getByText(ar('admin.payments.terms.declineSoft'))).toBeTruthy();
    const links = box
      .getAllByRole('link', { name: ar('admin.common.action.openInPayments') })
      .map((link) => link.getAttribute('href'));
    expect(links).toEqual([`/payments?payment=${O_ASSESSMENT}`, `/payments?payment=${O_MONTH}`]);
  });

  it('lists the items with their reasons: the teacher’s on a stop, the recorded one on a no_offer item', async () => {
    const api = fakeApi();
    api.programmes.get.query.mockResolvedValue(
      detailOf({
        requests: [
          requestOf('no_offer', {
            requestId: R2,
            status: 'extended',
            reason: 'المعلم مريض',
            decidedAt: daysAgo(20),
          }),
          requestOf('stop', { status: 'declined', reason: 'تأخر الدفع', decidedAt: daysAgo(2) }),
        ],
      }),
    );
    openPage(api, `/programmes?programme=${E1}`);
    const box = await detail();
    expect(await box.findByText('المعلم مريض')).toBeTruthy();
    expect(box.getByText(ar('admin.programme.detail.noOfferReason'))).toBeTruthy();
    expect(box.getByText('تأخر الدفع')).toBeTruthy();
    expect(box.getByText(ar('admin.programme.detail.stopReason'))).toBeTruthy();
    expect(box.getByText(ar('admin.programme.requestStatus.extended'))).toBeTruthy();
    expect(box.getByText(ar('admin.programme.requestStatus.declined'))).toBeTruthy();
  });

  it('says the programme could not load', async () => {
    const api = fakeApi();
    api.programmes.get.query.mockRejectedValue(refusal('INTERNAL_SERVER_ERROR'));
    openPage(api, `/programmes?programme=${E1}`);
    const box = await detail();
    expect(await box.findByText(ar('admin.common.loadError.text'))).toBeTruthy();
  });
});

describe('the second factor and the navigation', () => {
  it('is an entry of the sidebar’s queues, current on its page', async () => {
    openPage();
    const nav = within(
      await screen.findByRole('complementary', { name: ar('admin.nav.a11y.panel') }),
    );
    const link = nav.getByRole('link', { name: ar('admin.programme.nav') });
    expect(link.getAttribute('href')).toBe('/programmes');
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('sends a session whose second factor is not verified to /mfa', async () => {
    const api = fakeApi();
    renderApp({ at: '/programmes', session: { token: 't', step: 'mfa' }, api });
    await waitFor(() => expect(currentPath()).toBe('/mfa'));
    expect(api.programmes.queue.query).not.toHaveBeenCalled();
  });
});
