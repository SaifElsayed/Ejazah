// T053 (FR-400, FR-402, `AdminPayments`): the payments monitor through the router, in both languages.
// The list newest first as the server answers it, each order's reference and time, student, gross,
// fee and net as reported (a dash for one not reported, whatever the status, a paid order included,
// never 0), its status, and a paid order of a cancelled enrollment marked; the status filter as a
// removable chip, «مسح الكل», the search; keyset pages; the detail beside the table with the amounts,
// the references, the enrollment's package and progress, every paid order of the enrollment, and the
// order's history as a timeline; nothing on the page writes (FR-401); the page behind the second
// factor as every console page (FR-402); `?payment=` opening one order.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale, translate, type MessageKey } from '../../i18n';
import { dayMonth, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { currentPath, inBothLocales, query, refusal, renderApp } from '../../test/app-harness';

afterEach(() => {
  setLocale('ar');
});

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const P1 = '0193a6f0-0000-7000-8000-0000000000f1';
const P2 = '0193a6f0-0000-7000-8000-0000000000f2';
const P3 = '0193a6f0-0000-7000-8000-0000000000f3';
const P4 = '0193a6f0-0000-7000-8000-0000000000f4';
const ENROLLMENT = '0193a6f0-0000-7000-8000-0000000000e1';
const TAJWEED = {
  id: '0193a6f0-0000-7000-8000-0000000000a2',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};

/** A paid order whose gateway reported fee and net. */
const reported = {
  paymentId: P4,
  gatewayOrderId: 'paymob_order_4',
  createdAt: '2026-11-03T10:00:00.000Z',
  student: { displayName: 'آمال علي' },
  gross_piasters: 120_000,
  gatewayFee_piasters: 3_480,
  net_piasters: 116_520,
  // 003:T104: the rate and the teacher's share kept on the order.
  teacherShareRatePercent: 70,
  teacherShare_piasters: 84_000,
  status: 'paid',
  enrollmentCancelled: false,
} as const;
/** A paid order whose gateway reported neither (Paymob's callback carries neither). */
const unreported = {
  paymentId: P3,
  gatewayOrderId: 'paymob_order_3',
  createdAt: '2026-11-02T10:00:00.000Z',
  student: { displayName: 'Huda Samir' },
  gross_piasters: 95_000,
  status: 'paid',
  enrollmentCancelled: true,
} as const;
const created = {
  paymentId: P2,
  gatewayOrderId: 'paymob_order_2',
  createdAt: '2026-11-01T10:00:00.000Z',
  student: { displayName: 'آمال علي' },
  gross_piasters: 120_000,
  status: 'created',
  enrollmentCancelled: false,
} as const;
const older = { ...created, paymentId: P1, gatewayOrderId: 'paymob_order_1', status: 'failed' };

const detail = {
  paymentId: P3,
  gatewayOrderId: 'paymob_order_3',
  gatewayTransactionId: 'txn_9931',
  status: 'paid',
  createdAt: '2026-11-02T10:00:00.000Z',
  gross_piasters: 95_000,
  currency: 'EGP',
  student: { displayName: 'Huda Samir' },
  enrollment: {
    enrollmentId: ENROLLMENT,
    summary: { subject: TAJWEED, track: 'recitation', sessionCount: 8, sessionDurationMinutes: 60 },
    teacher: { displayName: 'المعلمة سارة' },
    status: 'cancelled',
    cancellationReason: 'slot_unavailable',
    completed: 0,
    total: 8,
    // B42, T047 (R-323 GAP-8): released before its reason was recorded, converted, still held.
    holds: [
      {
        holdId: '0193a6f0-0000-7000-8000-0000000000d1',
        placedAt: '2026-11-01T09:00:00.000Z',
        expiresAt: '2026-11-01T09:45:00.000Z',
        releasedAt: '2026-11-01T09:46:00.000Z',
      },
      {
        holdId: '0193a6f0-0000-7000-8000-0000000000d2',
        placedAt: '2026-11-02T09:58:00.000Z',
        expiresAt: '2026-11-02T10:43:00.000Z',
        releasedAt: '2026-11-02T10:05:00.000Z',
        releaseReason: 'slot_unavailable',
      },
      {
        holdId: '0193a6f0-0000-7000-8000-0000000000d3',
        placedAt: '2026-11-09T09:00:00.000Z',
        expiresAt: '2026-11-09T09:45:00.000Z',
      },
    ],
  },
  events: [{ eventType: 'paid', receivedAt: '2026-11-02T10:04:00.000Z' }],
  outcomes: [
    {
      kind: 'cancelled',
      cancellationReason: 'slot_unavailable',
      occurredAt: '2026-11-02T10:05:00.000Z',
    },
  ],
  paidOrders: [
    {
      paymentId: P3,
      gatewayOrderId: 'paymob_order_3',
      status: 'paid',
      createdAt: '2026-11-02T10:00:00.000Z',
    },
    {
      paymentId: P4,
      gatewayOrderId: 'paymob_order_4',
      status: 'paid',
      createdAt: '2026-11-03T10:00:00.000Z',
    },
  ],
} as const;

function fakeApi() {
  const api = {
    payments: { list: query(), get: query() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.payments.list.query.mockImplementation(async (input) => {
    const { cursor, status } = (input ?? {}) as { cursor?: string; status?: string };
    if (status === 'created') return { items: [created] };
    if (cursor === P3) return { items: [created, older] };
    return { items: [reported, unreported], nextCursor: P3 };
  });
  api.payments.get.query.mockResolvedValue(detail);
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: P1, displayName: 'سارة عادل', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

function open(api = fakeApi(), at = '/payments') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The table's row of the order `reference`. */
async function rowOf(reference: string) {
  const cell = await screen.findByText(reference);
  return cell.closest('tr') as HTMLElement;
}

describe('AdminPayments (FR-400)', () => {
  it('draws the list in both languages: the read-only banner, the columns, the amounts as reported, a dash where none was reported', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText(t('admin.payments.lede'))).toBeTruthy();
        expect(screen.getByText(t('admin.payments.banner'))).toBeTruthy();
        await rowOf(reported.gatewayOrderId);
        for (const column of [
          'order',
          'student',
          'gross',
          'fee',
          'net',
          'teacherShare',
          'status',
        ] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.payments.columns.${column}`) }),
          ).toBeTruthy();
        }
        const zone = panelTimeZone();
        const paid = within(await rowOf(reported.gatewayOrderId));
        expect(
          paid.getByText(
            t('admin.common.dateTime', {
              date: dayMonth(reported.createdAt, locale, zone),
              time: timeOfDay(reported.createdAt, locale, zone),
            }),
          ),
        ).toBeTruthy();
        expect(paid.getByText(t('admin.common.amount', { amount: '1,200.00' }))).toBeTruthy();
        expect(paid.getByText(t('admin.common.amount', { amount: '34.80' }))).toBeTruthy();
        expect(paid.getByText(t('admin.common.amount', { amount: '1,165.20' }))).toBeTruthy();
        expect(paid.getByText(t('admin.status.payment.paid'))).toBeTruthy();
      },
    );
  });

  it('draws a dash for the fee and the net of a paid order whose gateway reported neither, never 0, and marks its cancelled enrollment', async () => {
    open();
    const row = within(await rowOf(unreported.gatewayOrderId));
    // The fee, the net and (003:T104) the teacher's share of an order created before the commission.
    expect(row.getAllByText(ar('admin.payments.dash'))).toHaveLength(3);
    expect(row.queryByText(ar('admin.common.amount', { amount: '0.00' }))).toBeNull();
    expect(row.getByText(ar('admin.common.amount', { amount: '950.00' }))).toBeTruthy();
    expect(row.getByText(ar('admin.status.payment.paid'))).toBeTruthy();
    expect(row.getByText(ar('admin.payments.enrollmentCancelled'))).toBeTruthy();
    expect(row.getByText('Huda Samir')).toBeTruthy();
  });

  it('shows the teacher’s share kept on each order with its rate, and a dash before the commission (003:T104)', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const paid = within(await rowOf(reported.gatewayOrderId));
        expect(
          paid.getByText(
            t('admin.payments.teacherShare', {
              amount: t('admin.common.amount', { amount: '840.00' }),
              percent: 70,
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('reads the first page with no filter, and pages by the cursor the server wrote', async () => {
    const { api } = open();
    await rowOf(reported.gatewayOrderId);
    expect(api.payments.list.query).toHaveBeenLastCalledWith({});
    const pages = screen.getByRole('navigation', { name: ar('admin.common.a11y.pages') });
    fireEvent.click(within(pages).getByRole('button', { name: '2' }));
    await rowOf(older.gatewayOrderId);
    expect(api.payments.list.query).toHaveBeenLastCalledWith({ cursor: P3 });
    // The first page is read again from the cache, as every page kept a little while.
    fireEvent.click(within(pages).getByRole('button', { name: '1' }));
    await rowOf(reported.gatewayOrderId);
    expect(api.payments.list.query).toHaveBeenCalledTimes(2);
  });

  it('filters by status, shows the filter as a removable chip, and «مسح الكل» clears it', async () => {
    const { api } = open();
    await rowOf(reported.gatewayOrderId);
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.status.payment.created') }));
    await waitFor(() =>
      expect(api.payments.list.query).toHaveBeenLastCalledWith({ status: 'created' }),
    );
    const chips = within(
      screen.getByRole('group', { name: ar('admin.common.a11y.activeFilters') }),
    );
    expect(chips.getByText(ar('admin.status.payment.created'))).toBeTruthy();
    fireEvent.click(chips.getByText(ar('admin.common.action.clearAll')));
    await rowOf(reported.gatewayOrderId);
    expect(
      screen
        .getByRole('tab', { name: ar('admin.common.action.all') })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.queryByRole('group', { name: ar('admin.common.a11y.activeFilters') })).toBeNull();
  });

  it('sends the search once the typing stops, by order reference or student name', async () => {
    const { api } = open();
    await rowOf(reported.gatewayOrderId);
    fireEvent.change(screen.getByPlaceholderText(ar('admin.payments.search.placeholder')), {
      target: { value: ' هدى ' },
    });
    await waitFor(() =>
      expect(api.payments.list.query).toHaveBeenLastCalledWith({ search: 'هدى' }),
    );
  });

  it('says when there is no order yet, and when a filter finds none', async () => {
    const api = fakeApi();
    api.payments.list.query.mockResolvedValue({ items: [] });
    open(api);
    expect(await screen.findByText(ar('admin.payments.emptyAll.title'))).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.status.payment.refunded') }));
    expect(await screen.findByText(ar('admin.payments.empty.title'))).toBeTruthy();
  });

  it('says the list could not load, and reads it again on «إعادة المحاولة»', async () => {
    const api = fakeApi();
    api.payments.list.query.mockRejectedValueOnce(refusal('INTERNAL'));
    open(api);
    const retry = await screen.findByRole('button', { name: ar('admin.common.action.retry') });
    fireEvent.click(retry);
    await rowOf(reported.gatewayOrderId);
  });
});

describe('an order’s detail (FR-400, FR-401)', () => {
  async function opened(at = '/payments') {
    const { api } = open(fakeApi(), at);
    if (at === '/payments') fireEvent.click(await rowOf(unreported.gatewayOrderId));
    const aside = await screen.findByRole('complementary', {
      name: ar('admin.payments.detail.a11y'),
    });
    await within(aside).findByText(ar('admin.payments.detail.amountsTitle'));
    return { api, panel: within(aside) };
  }

  it('shows the amounts as reported with a dash for each not reported, the references, the enrollment and its progress', async () => {
    const { api, panel } = await opened();
    expect(api.payments.get.query).toHaveBeenCalledWith({ paymentId: P3 });
    expect(panel.getByText(ar('admin.common.amount', { amount: '950.00' }))).toBeTruthy();
    expect(panel.getAllByText(ar('admin.payments.dash'))).toHaveLength(2);
    expect(panel.getByText('txn_9931')).toBeTruthy();
    expect(panel.getAllByText('paymob_order_3').length).toBeGreaterThan(0);
    expect(
      panel.getByText(
        ar('admin.payments.detail.subtitle', {
          student: 'Huda Samir',
          subject: TAJWEED.nameAr,
          sessions: ar('admin.common.sessions', { count: 8 }),
          teacher: 'المعلمة سارة',
        }),
      ),
    ).toBeTruthy();
    expect(panel.getByText(ar('admin.common.progress', { done: 0, total: 8 }))).toBeTruthy();
    expect(panel.getByText(ar('admin.status.enrollment.cancelled'))).toBeTruthy();
  });

  it('lists every paid order of the enrollment (a compensation case covers each)', async () => {
    const { panel } = await opened();
    expect(panel.getByText(ar('admin.payments.detail.paidOrdersTitle'))).toBeTruthy();
    expect(panel.getByText('paymob_order_4')).toBeTruthy();
  });

  it('tells the order’s history in plain language, in order', async () => {
    const { panel } = await opened();
    const history = within(
      panel.getByRole('region', { name: ar('admin.payments.detail.a11yEvents') }),
    );
    expect(
      history.getAllByRole('listitem').map((item) => item.querySelector('strong')?.textContent),
    ).toEqual([
      ar('admin.payments.detail.events.created'),
      ar('admin.payments.detail.events.paid'),
      ar('admin.payments.detail.events.enrollmentCancelled', {
        reason: ar('admin.payments.cancellationReasons.slotUnavailable'),
      }),
    ]);
  });

  it('offers no control that writes: the detail has no button', async () => {
    const { panel } = await opened();
    expect(panel.queryAllByRole('button')).toEqual([]);
    expect(panel.getByText(ar('admin.payments.detail.footer'))).toBeTruthy();
  });

  it('opens an order at once from `?payment=`, the audit log’s link', async () => {
    const { api } = await opened(`/payments?payment=${P3}`);
    expect(api.payments.get.query).toHaveBeenCalledWith({ paymentId: P3 });
  });

  // B42, T047 (R-323 GAP-8): the enrollment summary lists its holds, oldest first as the server
  // answered them, each with its release and its reason; a release with no reason reads «not
  // recorded», and a hold not yet released says so.
  it('lists the enrollment’s holds with their release reasons, a missing one read «not recorded», in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/payments?payment=${P3}`),
      async (t, locale) => {
        const aside = within(
          await screen.findByRole('complementary', { name: t('admin.payments.detail.a11y') }),
        );
        const holds = within(
          await aside.findByRole('region', { name: t('admin.payments.detail.holdsTitle') }),
        );
        const zone = panelTimeZone();
        const at = (value: string) =>
          t('admin.common.dateTime', {
            date: dayMonth(value, locale, zone),
            time: timeOfDay(value, locale, zone),
          });
        const rows = holds.getAllByRole('listitem').map((item) => item.textContent);
        expect(rows).toEqual([
          t('admin.payments.detail.holdPlaced', {
            placed: at('2026-11-01T09:00:00.000Z'),
            expires: at('2026-11-01T09:45:00.000Z'),
          }) +
            t('admin.payments.detail.holdReleased', {
              released: at('2026-11-01T09:46:00.000Z'),
              reason: t('admin.payments.detail.holdReasonNotRecorded'),
            }),
          t('admin.payments.detail.holdPlaced', {
            placed: at('2026-11-02T09:58:00.000Z'),
            expires: at('2026-11-02T10:43:00.000Z'),
          }) +
            t('admin.payments.detail.holdReleased', {
              released: at('2026-11-02T10:05:00.000Z'),
              reason: t('admin.payments.holdReasons.slotUnavailable'),
            }),
          t('admin.payments.detail.holdPlaced', {
            placed: at('2026-11-09T09:00:00.000Z'),
            expires: at('2026-11-09T09:45:00.000Z'),
          }) + t('admin.payments.detail.holdNotReleased'),
        ]);
      },
    );
  });

  it('shows the order’s teacher share and its rate where it keeps them, and no such line otherwise (003:T104)', async () => {
    const api = fakeApi();
    api.payments.get.query.mockResolvedValue({
      ...detail,
      teacherShareRatePercent: 65,
      teacherShare_piasters: 61_750,
    });
    open(api, `/payments?payment=${P3}`);
    const aside = await screen.findByRole('complementary', {
      name: ar('admin.payments.detail.a11y'),
    });
    expect(await within(aside).findByText(ar('admin.payments.detail.teacherShare'))).toBeTruthy();
    expect(
      within(aside).getByText(
        ar('admin.payments.teacherShare', {
          amount: ar('admin.common.amount', { amount: '617.50' }),
          percent: 65,
        }),
      ),
    ).toBeTruthy();
  });

  it('draws no teacher share line for an order created before the commission (003:T104)', async () => {
    open(fakeApi(), `/payments?payment=${P3}`);
    const aside = await screen.findByRole('complementary', {
      name: ar('admin.payments.detail.a11y'),
    });
    await within(aside).findByText(ar('admin.payments.detail.amountsTitle'));
    expect(within(aside).queryByText(ar('admin.payments.detail.teacherShare'))).toBeNull();
  });

  it('says an enrollment with no hold has none', async () => {
    const api = fakeApi();
    api.payments.get.query.mockResolvedValue({
      ...detail,
      enrollment: { ...detail.enrollment, holds: [] },
    });
    open(api, `/payments?payment=${P3}`);
    expect(await screen.findByText(ar('admin.payments.detail.holdsEmpty'))).toBeTruthy();
  });

  // B42, T047 (the follow-up under T047): Phase 3's outcomes on the order's history, so an
  // enrollment cancelled and then restored never reads «cancelled» alone.
  it('tells Phase 3’s outcomes: a restore, an end for the teacher’s absence and a completion', async () => {
    const api = fakeApi();
    api.payments.get.query.mockResolvedValue({
      ...detail,
      outcomes: [
        { kind: 'cancelled', cancellationReason: 'admin', occurredAt: '2026-11-05T10:00:00.000Z' },
        { kind: 'restored', occurredAt: '2026-11-06T10:00:00.000Z' },
        { kind: 'terminated_no_show', occurredAt: '2026-11-07T10:00:00.000Z' },
        { kind: 'completed', occurredAt: '2026-11-08T10:00:00.000Z' },
      ],
    });
    open(api, `/payments?payment=${P3}`);
    const history = within(
      await screen.findByRole('region', { name: ar('admin.payments.detail.a11yEvents') }),
    );
    expect(
      history.getAllByRole('listitem').map((item) => item.querySelector('strong')?.textContent),
    ).toEqual([
      ar('admin.payments.detail.events.created'),
      ar('admin.payments.detail.events.paid'),
      ar('admin.payments.detail.events.enrollmentCancelled', {
        reason: ar('admin.payments.cancellationReasons.admin'),
      }),
      ar('admin.payments.detail.events.enrollmentRestored'),
      ar('admin.payments.detail.events.enrollmentTerminatedNoShow'),
      ar('admin.payments.detail.events.enrollmentCompleted'),
    ]);
  });
});

// B42, T047 (the note under T047, Q6 (a)): `/payments?enrollment=`, the link from `/sessions` and
// `/cases`, lists that enrollment's orders; the filter shows as a removable chip.
describe('one enrollment’s orders (`?enrollment=`)', () => {
  it('reads the list for the enrollment named, shows the filter as a chip, and removing it reads every order', async () => {
    const { api } = open(fakeApi(), `/payments?enrollment=${ENROLLMENT}`);
    await waitFor(() =>
      expect(api.payments.list.query).toHaveBeenLastCalledWith({ enrollmentId: ENROLLMENT }),
    );
    expect(api.payments.list.query).not.toHaveBeenCalledWith({});
    const chips = within(
      await screen.findByRole('group', { name: ar('admin.common.a11y.activeFilters') }),
    );
    expect(chips.getByText(ar('admin.payments.enrollmentFilter'))).toBeTruthy();
    fireEvent.click(chips.getByText(ar('admin.common.action.clearAll')));
    await waitFor(() => expect(api.payments.list.query).toHaveBeenLastCalledWith({}));
  });

  it('keeps the enrollment beside a status filter', async () => {
    const { api } = open(fakeApi(), `/payments?enrollment=${ENROLLMENT}`);
    await rowOf(reported.gatewayOrderId);
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.status.payment.paid') }));
    await waitFor(() =>
      expect(api.payments.list.query).toHaveBeenLastCalledWith({
        status: 'paid',
        enrollmentId: ENROLLMENT,
      }),
    );
  });
});

describe('the second factor and the navigation (FR-402)', () => {
  it('sends a session whose second factor is not verified to /mfa, reading nothing', async () => {
    const api = fakeApi();
    renderApp({ at: '/payments', session: { token: 't', step: 'mfa' }, api });
    await waitFor(() => expect(currentPath()).toBe('/mfa'));
    expect(api.payments.list.query).not.toHaveBeenCalled();
  });

  it('sends no session to the sign-in', async () => {
    const api = fakeApi();
    renderApp({ at: '/payments', api });
    await waitFor(() => expect(currentPath()).toBe('/sign-in'));
    expect(api.payments.list.query).not.toHaveBeenCalled();
  });

  it('is an entry of the sidebar’s records, current on its page', async () => {
    open();
    const nav = within(
      await screen.findByRole('complementary', { name: ar('admin.nav.a11y.panel') }),
    );
    const entry = nav.getByRole('link', { name: ar('admin.nav.items.payments') });
    expect(entry.getAttribute('href')).toBe('/payments');
    expect(entry.getAttribute('aria-current')).toBe('page');
  });
});

describe('T058: RATE_LIMITED on the payments monitor', () => {
  it('the list says when to try again', async () => {
    const api = fakeApi();
    api.payments.list.query.mockRejectedValue(
      refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('an order’s panel says to wait a little when no time is given', async () => {
    const api = fakeApi();
    api.payments.get.query.mockRejectedValue(refusal('RATE_LIMITED'));
    open(api, `/payments?payment=${P3}`);
    const panel = within(
      await screen.findByRole('complementary', { name: ar('admin.payments.detail.a11y') }),
    );
    expect(await panel.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(panel.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });
});

// B42a, Q-B2 (a) (the owner, 2026-11-13; the review session's wording): T071 made a teacher's
// suspension pause the enrollment, so a `cancelled` `teacher_suspended` now means only a ban or a
// revocation; T069 added two outcomes, a held slot's release and a hold's end.
describe('B42a Q-B2 (a): a teacher’s end and a held slot on the order’s history', () => {
  async function titles(t: (key: MessageKey) => string) {
    const history = within(
      await screen.findByRole('region', { name: t('admin.payments.detail.a11yEvents') }),
    );
    return history
      .getAllByRole('listitem')
      .map((item) => item.querySelector('strong')?.textContent);
  }

  it('names a cancellation `teacher_suspended` and a hold’s release as the teacher’s suspension, ban or revocation', async () => {
    const api = fakeApi();
    api.payments.get.query.mockResolvedValue({
      ...detail,
      outcomes: [
        {
          kind: 'cancelled',
          cancellationReason: 'teacher_suspended',
          occurredAt: '2026-11-05T10:00:00.000Z',
        },
      ],
    });
    await inBothLocales(
      () => open(api, `/payments?payment=${P3}`),
      async (t, locale) => {
        // PR #139 r1, Minor 1: `teacher_suspended` is a suspension's, a ban's or a revocation's
        // (booking's `teacherReason`), on an enrollment's cancellation and on a hold's release alike.
        const reason = {
          ar: 'إيقاف المعلم أو حظره أو سحب اعتماده',
          en: 'Teacher suspended, banned or approval revoked',
        };
        expect((await titles(t)).at(-1)).toBe(
          t('admin.payments.detail.events.enrollmentCancelled', { reason: reason[locale] }),
        );
        expect(t('admin.payments.holdReasons.teacherSuspended')).toBe(reason[locale]);
      },
    );
  });

  it('tells a held slot’s release and a hold’s end', async () => {
    const api = fakeApi();
    api.payments.get.query.mockResolvedValue({
      ...detail,
      outcomes: [
        { kind: 'slot_released', occurredAt: '2026-11-06T10:00:00.000Z' },
        { kind: 'slot_hold_ended', occurredAt: '2026-11-07T10:00:00.000Z' },
      ],
    });
    await inBothLocales(
      () => open(api, `/payments?payment=${P3}`),
      async (t, locale) => {
        expect((await titles(t)).slice(-2)).toEqual(
          {
            ar: ['حُرّر موعد الاشتراك', 'انتهى حجز موعد الاشتراك'],
            en: ["The enrollment's slot was released", "The hold on the enrollment's slot ended"],
          }[locale],
        );
      },
    );
  });
});
