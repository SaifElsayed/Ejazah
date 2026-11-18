// 003:T105 (SRS DEC-89; the note under T105): «تحويلات المعلمين» through the router, in both
// languages. The list: the page explains itself in one line, the totals for all teachers (held, due
// now, paid all time and this month, taken off), one row per teacher with the same figures in the
// server's order, the «due now only» filter sending `dueOnly`, pages by `nextCursor`. A teacher's
// detail at `?teacher=`: «ليه» with each release's part, amount and state (held with when, due, paid
// with its date) and the order and student behind it; «عليه» with each refund's reason, its case's
// link, the refund as recorded and the teacher's share; the payout account masked. «تم الصرف» on a
// written due row only: its confirmation says the transfer is made by hand in Paymob's dashboard,
// and it sends `payouts.mark` once with a key; a refusal is said in words. The sidebar's entry right
// after the payments monitor, and the link on a teacher's record in `/users`.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { dayMonth, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import {
  currentPath,
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
  type Translate,
} from '../../test/app-harness';
import { NAV_GROUPS } from '../_layout/AdminNav';

afterEach(() => {
  setLocale('ar');
});

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const T1 = '0193a6f0-0000-7000-8000-0000000000c1';
const T2 = '0193a6f0-0000-7000-8000-0000000000c2';
const T3 = '0193a6f0-0000-7000-8000-0000000000c3';
const S1 = '0193a6f0-0000-7000-8000-0000000000b1';
const S2 = '0193a6f0-0000-7000-8000-0000000000b2';
const E1 = '0193a6f0-0000-7000-8000-0000000000e1';
const E2 = '0193a6f0-0000-7000-8000-0000000000e2';
const P1 = '0193a6f0-0000-7000-8000-0000000000f1';
const P2 = '0193a6f0-0000-7000-8000-0000000000f2';
const R1 = '0193a6f0-0000-7000-8000-0000000000a1';
const R2 = '0193a6f0-0000-7000-8000-0000000000a2';
const C1 = '0193a6f0-0000-7000-8000-0000000000d1';
const ADMIN = '0193a6f0-0000-7000-8000-000000000099';

const totals = {
  held_piasters: 412_300,
  dueNow_piasters: 700_000,
  paid_piasters: 980_000,
  paidThisMonth_piasters: 210_000,
  takenOff_piasters: 315_000,
};
/** A teacher with a release due: first, as the server orders it. */
const rowDue = {
  teacher: { userId: T1, displayName: 'المعلمة سارة' },
  held_piasters: 175_000,
  dueNow_piasters: 700_000,
  paid_piasters: 210_000,
  paidThisMonth_piasters: 0,
  takenOff_piasters: 210_000,
  oldestDueAt: '2026-11-10T18:00:00.000Z',
};
const rowNone = {
  teacher: { userId: T2, displayName: 'Huda Samir' },
  held_piasters: 237_300,
  dueNow_piasters: 0,
  paid_piasters: 770_000,
  paidThisMonth_piasters: 210_000,
  takenOff_piasters: 105_000,
};
const rowNext = {
  teacher: { userId: T3, displayName: 'أمينة فؤاد' },
  held_piasters: 0,
  dueNow_piasters: 0,
  paid_piasters: 0,
  paidThisMonth_piasters: 0,
  takenOff_piasters: 0,
};

const student1 = { userId: S1, displayName: 'آمال علي' };
const student2 = { userId: S2, displayName: 'Mariam Adel' };
const DUE_AT = '2026-11-10T18:00:00.000Z';
const HELD_AT = '2026-11-20T18:00:00.000Z';
const PAID_AT = '2026-11-05T09:30:00.000Z';

const detail = {
  teacher: rowDue.teacher,
  payoutAccountMasked: '••••4821',
  figures: {
    held_piasters: 175_000,
    dueNow_piasters: 700_000,
    paid_piasters: 210_000,
    paidThisMonth_piasters: 0,
    takenOff_piasters: 210_000,
  },
  releases: [
    {
      releaseId: R1,
      part: 'recitation_end',
      amount_piasters: 700_000,
      state: 'due',
      fallsDueAt: DUE_AT,
      waitsForCase: false,
      enrollmentId: E1,
      paymentId: P1,
      student: student1,
    },
    {
      part: 'ijazah_half',
      amount_piasters: 175_000,
      state: 'held',
      fallsDueAt: HELD_AT,
      waitsForCase: false,
      enrollmentId: E2,
      paymentId: P2,
      student: student2,
    },
    {
      part: 'ijazah_end',
      amount_piasters: 525_000,
      state: 'held',
      waitsForCase: true,
      enrollmentId: E2,
      paymentId: P2,
      student: student2,
    },
    {
      releaseId: R2,
      part: 'teacher_dropout',
      amount_piasters: 210_000,
      state: 'paid',
      fallsDueAt: '2026-11-02T18:00:00.000Z',
      waitsForCase: false,
      paidAt: PAID_AT,
      enrollmentId: E1,
      paymentId: P1,
      student: student1,
    },
  ],
  deductions: [
    {
      paymentId: P1,
      enrollmentId: E1,
      student: student1,
      refunded_piasters: 300_000,
      share_piasters: 210_000,
      case: { caseId: C1, reason: 'teacher_ended' },
    },
    {
      paymentId: P2,
      enrollmentId: E2,
      student: student2,
      refunded_piasters: 150_000,
      share_piasters: 105_000,
    },
  ],
} as const;

const teacherRecord = {
  userId: T1,
  profile: {
    displayName: 'المعلمة سارة',
    email: 'sara@example.test',
    joinedAt: '2026-09-15T09:00:00.000Z',
    deleted: false,
    teacher: { bio: 'تحفّظ القرآن منذ عشرين عامًا', qualification: 'إجازة برواية حفص' },
  },
  role: 'teacher',
  gender: 'female',
  isMinor: false,
  verificationStatus: 'approved',
  accountStatus: 'active',
  cancellationRequests: { total: 0, recent: 0 },
  enrollmentsSlotHeldUntil: null,
  banRestoreWindowDays: 14,
  repeatedAbsences: [],
} as const;
const studentRecord = {
  ...teacherRecord,
  userId: S1,
  profile: {
    displayName: 'آمال علي',
    email: 'amal@example.test',
    joinedAt: '2026-10-01T09:00:00.000Z',
    deleted: false,
  },
  role: 'student',
  verificationStatus: null,
} as const;

function fakeApi() {
  const api = {
    payouts: { list: query(), get: query(), mark: mutation() },
    users: { list: query(), get: query() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.payouts.list.query.mockImplementation(async (input) => {
    const { cursor, dueOnly } = (input ?? {}) as { cursor?: string; dueOnly?: boolean };
    if (dueOnly === true) return { totals, items: [rowDue] };
    if (cursor === T2) return { totals, items: [rowNext] };
    return { totals, items: [rowDue, rowNone], nextCursor: T2 };
  });
  api.payouts.get.query.mockResolvedValue(detail);
  api.payouts.mark.mutate.mockResolvedValue(undefined);
  api.users.list.query.mockResolvedValue({ items: [] });
  api.users.get.query.mockImplementation(async (input) =>
    (input as { targetUserId: string }).targetUserId === T1 ? teacherRecord : studentRecord,
  );
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: ADMIN, displayName: 'سارة عادل', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

function open(api = fakeApi(), at = '/payouts') {
  return { ...renderApp({ at, session: verified, api }), api };
}

const amount = (t: Translate, pounds: string) => t('admin.common.amount', { amount: pounds });

/** The table's row of the teacher `name`. */
async function rowOf(name: string) {
  const cell = await screen.findByText(name);
  return cell.closest('tr') as HTMLElement;
}

/** The teacher's detail beside the list. */
async function detailPanel(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', {
    name: t('admin.money.payouts.detail.a11y'),
  });
  await within(aside).findByText(t('admin.money.payouts.detail.releasesTitle'));
  return within(aside);
}

/** The release row in the detail that reads `text`. */
function releaseRow(panel: ReturnType<typeof within>, text: string): HTMLElement {
  return panel.getByText(text).closest('li') as HTMLElement;
}

describe('«تحويلات المعلمين»: the list (DEC-89)', () => {
  it('explains itself, and draws the totals for all teachers and one row per teacher in the server’s order, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText(t('admin.money.payouts.lede'))).toBeTruthy();
        await rowOf(rowDue.teacher.displayName);
        const sums = within(
          screen.getByRole('region', { name: t('admin.money.payouts.totals.title') }),
        );
        for (const [label, pounds] of [
          ['held', '4,123.00'],
          ['dueNow', '7,000.00'],
          ['paid', '9,800.00'],
          ['paidThisMonth', '2,100.00'],
          ['takenOff', '3,150.00'],
        ] as const) {
          const item = sums
            .getByText(t(`admin.money.payouts.totals.${label}`))
            .closest('.kv__item');
          expect(item?.querySelector('dd')?.textContent).toBe(amount(t, pounds));
        }
        for (const column of [
          'teacher',
          'held',
          'dueNow',
          'paid',
          'paidThisMonth',
          'takenOff',
          'oldestDue',
        ] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.money.payouts.columns.${column}`) }),
          ).toBeTruthy();
        }
        const names = screen
          .getAllByRole('row')
          .slice(1)
          .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
        expect(names).toEqual([rowDue.teacher.displayName, rowNone.teacher.displayName]);
        const due = within(await rowOf(rowDue.teacher.displayName));
        expect(due.getByText(amount(t, '1,750.00'))).toBeTruthy();
        expect(due.getByText(amount(t, '7,000.00'))).toBeTruthy();
        expect(due.getAllByText(amount(t, '2,100.00'))).toHaveLength(2);
        expect(
          due.getByText(
            t('admin.common.dateTime', {
              date: dayMonth(DUE_AT, locale, panelTimeZone()),
              time: timeOfDay(DUE_AT, locale, panelTimeZone()),
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('the «due now only» filter sends dueOnly, and «الكل» reads the whole list again', async () => {
    const { api } = open();
    await rowOf(rowNone.teacher.displayName);
    expect(api.payouts.list.query).toHaveBeenLastCalledWith({});
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.money.payouts.filter.dueOnly') }));
    await waitFor(() => expect(api.payouts.list.query).toHaveBeenLastCalledWith({ dueOnly: true }));
    await waitFor(() => expect(screen.queryByText(rowNone.teacher.displayName)).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.common.action.all') }));
    await rowOf(rowNone.teacher.displayName);
  });

  it('pages by the cursor the server wrote', async () => {
    const { api } = open();
    await rowOf(rowDue.teacher.displayName);
    const pages = screen.getByRole('navigation', { name: ar('admin.common.a11y.pages') });
    fireEvent.click(within(pages).getByRole('button', { name: '2' }));
    await rowOf(rowNext.teacher.displayName);
    expect(api.payouts.list.query).toHaveBeenLastCalledWith({ cursor: T2 });
  });

  it('a row opens the teacher’s detail at ?teacher=', async () => {
    const { api } = open();
    fireEvent.click(await rowOf(rowDue.teacher.displayName));
    await detailPanel();
    expect(api.payouts.get.query).toHaveBeenCalledWith({ teacherUserId: T1 });
  });
});

describe('«تحويلات المعلمين»: a teacher’s detail (DEC-89)', () => {
  it('draws «ليه» with each part, amount and state, and the order and student behind it, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/payouts?teacher=${T1}`),
      async (t, locale) => {
        const panel = await detailPanel(t);
        const zone = panelTimeZone();
        const when = (instant: string) =>
          t('admin.common.dateTime', {
            date: dayMonth(instant, locale, zone),
            time: timeOfDay(instant, locale, zone),
          });
        const due = within(releaseRow(panel, t('admin.money.payouts.part.recitationEnd')));
        expect(due.getByText(amount(t, '7,000.00'))).toBeTruthy();
        expect(due.getByText(t('admin.money.payouts.state.due'))).toBeTruthy();
        expect(
          due.getByText(t('admin.money.payouts.detail.dueSince', { when: when(DUE_AT) })),
        ).toBeTruthy();
        expect(
          due.getByText(t('admin.money.payouts.detail.student', { name: student1.displayName })),
        ).toBeTruthy();
        expect(
          due
            .getByRole('link', { name: t('admin.common.action.openInPayments') })
            .getAttribute('href'),
        ).toBe(`/payments?payment=${P1}`);

        const half = within(releaseRow(panel, t('admin.money.payouts.part.ijazahHalf')));
        expect(half.getByText(t('admin.money.payouts.state.held'))).toBeTruthy();
        expect(
          half.getByText(t('admin.money.payouts.detail.heldUntil', { when: when(HELD_AT) })),
        ).toBeTruthy();

        const rest = within(releaseRow(panel, t('admin.money.payouts.part.ijazahEnd')));
        expect(rest.getByText(t('admin.money.payouts.detail.heldWaitsForCase'))).toBeTruthy();

        const paid = within(releaseRow(panel, t('admin.money.payouts.part.teacherDropout')));
        expect(paid.getByText(t('admin.money.payouts.state.paid'))).toBeTruthy();
        expect(
          paid.getByText(t('admin.money.payouts.detail.paidOn', { when: when(PAID_AT) })),
        ).toBeTruthy();
      },
    );
  });

  it('draws «عليه»: each refund with its reason and its case’s link, the refund as recorded and the teacher’s share, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/payouts?teacher=${T1}`),
      async (t) => {
        const panel = await detailPanel(t);
        const owes = within(
          panel.getByRole('region', { name: t('admin.money.payouts.detail.deductionsTitle') }),
        );
        expect(
          owes.getByText(
            t('admin.money.payouts.detail.refunded', { amount: amount(t, '3,000.00') }),
          ),
        ).toBeTruthy();
        expect(
          owes.getByText(t('admin.money.payouts.detail.share', { amount: amount(t, '2,100.00') })),
        ).toBeTruthy();
        expect(
          owes.getByText(
            t('admin.money.payouts.detail.reason', {
              reason: t('admin.cases.reason.teacherEnded'),
            }),
          ),
        ).toBeTruthy();
        expect(
          owes
            .getByRole('link', { name: t('admin.money.payouts.detail.openCase') })
            .getAttribute('href'),
        ).toBe(`/cases?case=${C1}`);
        expect(
          owes.getByText(t('admin.money.payouts.detail.share', { amount: amount(t, '1,050.00') })),
        ).toBeTruthy();
        expect(owes.getByText(t('admin.money.payouts.detail.noCase'))).toBeTruthy();
      },
    );
  });

  it('draws the payout account masked, and says when there is none', async () => {
    const shown = open(fakeApi(), `/payouts?teacher=${T1}`);
    const panel = await detailPanel();
    expect(panel.getByText('••••4821')).toBeTruthy();
    shown.view.unmount();
    const api = fakeApi();
    const { payoutAccountMasked: _masked, ...unverified } = detail;
    api.payouts.get.query.mockResolvedValue(unverified);
    open(api, `/payouts?teacher=${T1}`);
    const second = await detailPanel();
    expect(second.getByText(ar('admin.money.payouts.detail.payoutAccountNone'))).toBeTruthy();
  });
});

describe('«تم الصرف» (DEC-89)', () => {
  it('is offered on the written due row only', async () => {
    open(fakeApi(), `/payouts?teacher=${T1}`);
    const panel = await detailPanel();
    const buttons = panel.getAllByRole('button', { name: ar('admin.money.payouts.mark.action') });
    expect(buttons).toHaveLength(1);
    expect(
      within(releaseRow(panel, ar('admin.money.payouts.part.recitationEnd'))).getByRole('button', {
        name: ar('admin.money.payouts.mark.action'),
      }),
    ).toBe(buttons[0]);
  });

  it('opens a confirmation that says the transfer is made by hand in Paymob’s dashboard, and sends the mark once with a key', async () => {
    const { api } = open(fakeApi(), `/payouts?teacher=${T1}`);
    const panel = await detailPanel();
    fireEvent.click(panel.getByRole('button', { name: ar('admin.money.payouts.mark.action') }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(ar('admin.money.payouts.mark.effect'))).toBeTruthy();
    expect(api.payouts.mark.mutate).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.money.payouts.mark.confirm') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.payouts.mark.mutate).toHaveBeenCalledTimes(1);
    expect(api.payouts.mark.mutate).toHaveBeenCalledWith({
      releaseId: R1,
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    // The list and the detail are read again.
    await waitFor(() => expect(api.payouts.get.query).toHaveBeenCalledTimes(2));
  });

  it('closes with nothing sent on «إلغاء»', async () => {
    const { api } = open(fakeApi(), `/payouts?teacher=${T1}`);
    const panel = await detailPanel();
    fireEvent.click(panel.getByRole('button', { name: ar('admin.money.payouts.mark.action') }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.money.payouts.mark.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.payouts.mark.mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_FOUND', [], 'admin.money.payouts.mark.refused.notFound', undefined],
    [
      'CONFLICT',
      [{ path: 'releaseId', code: 'already_marked' }],
      'admin.money.payouts.mark.refused.alreadyMarked',
      undefined,
    ],
    ['CONFLICT', [], 'admin.shared.keyReused', undefined],
    [
      'RATE_LIMITED',
      [{ path: 'retryAfterSeconds', code: '61' }],
      'admin.common.rateLimitedIn',
      { count: 2 },
    ],
  ] as const)('a refusal %s %j is said in words', async (code, details, key, values) => {
    const api = fakeApi();
    api.payouts.mark.mutate.mockRejectedValue(refusal(code, details));
    open(api, `/payouts?teacher=${T1}`);
    const panel = await detailPanel();
    fireEvent.click(panel.getByRole('button', { name: ar('admin.money.payouts.mark.action') }));
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.money.payouts.mark.confirm') }));
    expect(await dialog.findByText(ar(key, values))).toBeTruthy();
    expect(api.payouts.mark.mutate).toHaveBeenCalledTimes(1);
  });
});

describe('«تحويلات المعلمين»: the way in (DEC-89)', () => {
  it('is the sidebar’s entry right after the payments monitor, current on its page', async () => {
    const records = NAV_GROUPS.flatMap((group) => group.entries.map((entry) => entry.path));
    expect(records.indexOf('/payouts')).toBe(records.indexOf('/payments') + 1);
    open();
    const nav = within(
      await screen.findByRole('complementary', { name: ar('admin.nav.a11y.panel') }),
    );
    const entry = nav.getByRole('link', { name: ar('admin.money.payouts.nav') });
    expect(entry.getAttribute('href')).toBe('/payouts');
    expect(entry.getAttribute('aria-current')).toBe('page');
  });

  it('a teacher’s record in /users links to his payouts; a student’s does not', async () => {
    const shown = open(fakeApi(), `/users?user=${T1}`);
    const record = within(
      await screen.findByRole('complementary', { name: ar('admin.users.detail.a11y') }),
    );
    await record.findByText(teacherRecord.profile.teacher.bio);
    const link = record.getByRole('link', { name: ar('admin.money.payouts.userLink') });
    expect(link.getAttribute('href')).toBe(`/payouts?teacher=${T1}`);
    fireEvent.click(link);
    await waitFor(() => expect(currentPath()).toBe(`/payouts?teacher=${T1}`));
    shown.view.unmount();
    open(fakeApi(), `/users?user=${S1}`);
    const other = within(
      await screen.findByRole('complementary', { name: ar('admin.users.detail.a11y') }),
    );
    await other.findByText('amal@example.test');
    expect(other.queryByRole('link', { name: ar('admin.money.payouts.userLink') })).toBeNull();
  });
});
