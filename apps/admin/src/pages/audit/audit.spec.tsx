// T073 (FR-175): the audit log against its board (`AdminAudit`), through the router, in both
// languages. The last thirty days by default, in the panel's zone, as a chip that removes itself;
// the search in the stored label and the reason, sent once the typing stops; the table with the
// time, the administrator, the action as the panel names it (the raw action when it names none),
// the target by its current name and the reason; the pager the page size answers; the selected
// entry's detail with what changed, its reason and its number; the empty log and a log that could
// not be read.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getLocale, setLocale, translate, type MessageKey } from '../../i18n';
import { cityName, dayMonth, dayMonthYear, timeOfDay } from '../../lib/format';
import { daysBefore, panelTimeZone, todayIn } from '../../lib/zone';
import { currentPath, inBothLocales, query, refusal, renderApp } from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const USER = '0193a6f0-0000-7000-8000-00000000000a';
const CREDENTIAL = '0193a6f0-0000-7000-8000-0000000000c1';
const SUSPEND = '0193a6f0-0000-7000-8000-0000000000e1';
const APPROVE = '0193a6f0-0000-7000-8000-0000000000e2';
const ODD = '0193a6f0-0000-7000-8000-0000000000e3';

const suspended = {
  entryId: SUSPEND,
  occurredAt: '2026-10-15T08:20:00.000Z',
  adminName: 'سارة عادل',
  action: 'teacher.suspend',
  targetLabel: `مستخدم · ${USER}`,
  targetName: 'الشيخ ياسر حمدي',
  targetType: 'user',
  targetId: USER,
  reason: 'بلاغات متكررة',
} as const;
const approved = {
  entryId: APPROVE,
  occurredAt: '2026-10-14T14:40:00.000Z',
  adminName: 'سارة عادل',
  action: 'credential.approve',
  targetLabel: `إجازة · ${CREDENTIAL}`,
  targetType: 'credential',
  targetId: CREDENTIAL,
} as const;
const odd = {
  entryId: ODD,
  occurredAt: '2026-10-13T10:00:00.000Z',
  adminName: 'منى',
  action: 'probe.future_action',
  targetLabel: 'إعداد · x',
  targetType: 'setting',
  targetId: 'x',
} as const;

function fakeApi() {
  const api = {
    audit: { list: query(), get: query() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.audit.list.query.mockResolvedValue({
    rows: [suspended, approved, odd],
    total: 3,
    pageSize: 25,
  });
  api.audit.get.query.mockResolvedValue({
    ...suspended,
    before: { accountStatus: 'active' },
    after: { accountStatus: 'suspended' },
  });
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: 'a', displayName: 'سارة عادل', email: 's@x.io' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

function open(api = fakeApi(), { strict = false } = {}) {
  return { ...renderApp({ at: '/audit', session: verified, api, strict }), api };
}

describe('AdminAudit (FR-175)', () => {
  it('draws the last thirty days in both languages: the chip, the table, its footer', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const zone = panelTimeZone();
        expect(await screen.findByText(t('admin.audit.lede'))).toBeTruthy();
        expect(
          screen.getByRole('button', { name: t('admin.audit.a11y.removeDateFilter') }).textContent,
        ).toBe(t('admin.audit.dateFilterChip', { days: 30 }));
        expect(await screen.findByText(t('admin.audit.actions.teacherSuspend'))).toBeTruthy();
        for (const column of ['time', 'admin', 'action', 'target', 'reason'] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.audit.columns.${column}`) }),
          ).toBeTruthy();
        }
        expect(screen.getByText(dayMonth(suspended.occurredAt, locale, zone))).toBeTruthy();
        expect(screen.getByText(timeOfDay(suspended.occurredAt, locale, zone))).toBeTruthy();
        expect(
          screen.getByText(
            t('admin.audit.targetNamed', {
              type: t('admin.audit.targets.user'),
              name: suspended.targetName,
            }),
          ),
        ).toBeTruthy();
        expect(screen.getByText(suspended.reason)).toBeTruthy();
        expect(screen.getByText(t('admin.audit.actions.approveTeacherCredential'))).toBeTruthy();
        expect(screen.getByText('probe.future_action')).toBeTruthy();
        expect(
          screen.getByText(
            t('admin.audit.pagerSummary', {
              shown: 3,
              total: 3,
              days: 30,
              city: cityName(zone, locale),
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('reads the first page of the last thirty days in the panel’s zone, once in strict mode', async () => {
    const { api } = open(fakeApi(), { strict: true });
    await screen.findByText(ar('admin.audit.actions.teacherSuspend'));
    const zone = panelTimeZone();
    const today = todayIn(zone);
    expect(api.audit.list.query).toHaveBeenCalledTimes(1);
    expect(api.audit.list.query).toHaveBeenCalledWith({
      from: daysBefore(today, 29),
      to: today,
      timeZone: zone,
      page: 1,
    });
  });

  it('reads the whole log once the chip is removed, and searches once the typing stops', async () => {
    const { api } = open();
    await screen.findByText(ar('admin.audit.actions.teacherSuspend'));
    fireEvent.click(screen.getByRole('button', { name: ar('admin.audit.a11y.removeDateFilter') }));
    await waitFor(() => expect(api.audit.list.query).toHaveBeenLastCalledWith({ page: 1 }));
    expect(
      await screen.findByText(
        ar('admin.audit.pagerSummaryAll', {
          shown: 3,
          total: 3,
          city: cityName(panelTimeZone(), 'ar'),
        }),
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(ar('admin.audit.search.placeholder')), {
      target: { value: '  بلاغات ' },
    });
    await waitFor(() =>
      expect(api.audit.list.query).toHaveBeenLastCalledWith({ search: 'بلاغات', page: 1 }),
    );
  });

  it('opens an entry: what changed, its reason, its number', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const zone = panelTimeZone();
        const cells = await screen.findAllByText(t('admin.audit.actions.teacherSuspend'));
        fireEvent.click(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
        const detail = within(
          await screen.findByRole('complementary', { name: t('admin.audit.a11y.detail') }),
        );
        const target = t('admin.audit.targetNamed', {
          type: t('admin.audit.targets.user'),
          name: suspended.targetName,
        });
        expect(
          await detail.findByText(
            t('admin.audit.detail.title', {
              action: t('admin.audit.actions.teacherSuspend'),
              target,
            }),
          ),
        ).toBeTruthy();
        expect(
          detail.getByText(
            t('admin.audit.detail.meta', {
              date: dayMonthYear(suspended.occurredAt, locale, zone),
              time: timeOfDay(suspended.occurredAt, locale, zone),
              admin: suspended.adminName,
            }),
          ),
        ).toBeTruthy();
        expect(detail.getByText(t('admin.audit.fields.accountStatus'))).toBeTruthy();
        expect(detail.getByText(t('admin.status.account.active'))).toBeTruthy();
        expect(detail.getByText(t('admin.status.account.suspended'))).toBeTruthy();
        expect(detail.getByText(suspended.reason)).toBeTruthy();
        expect(detail.getByText(SUSPEND)).toBeTruthy();
        expect(detail.getByText(t('admin.audit.detail.footer'))).toBeTruthy();
      },
    );
  });

  it('links a credential’s entry to its credential', async () => {
    open();
    const link = await screen.findByRole('link', { name: ar('admin.audit.targets.credential') });
    fireEvent.click(link);
    await waitFor(() => expect(currentPath()).toBe(`/credentials?credential=${CREDENTIAL}`));
  });

  it('says an empty period, an empty log, and a log that could not be read', async () => {
    const api = fakeApi();
    api.audit.list.query.mockResolvedValue({ rows: [], total: 0, pageSize: 25 });
    open(api);
    expect(await screen.findByText(ar('admin.audit.empty.title'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: ar('admin.audit.a11y.removeDateFilter') }));
    expect(await screen.findByText(ar('admin.audit.emptyAll.title'))).toBeTruthy();
    api.audit.list.query.mockRejectedValue(refusal('INTERNAL'));
    fireEvent.change(screen.getByPlaceholderText(ar('admin.audit.search.placeholder')), {
      target: { value: 'x' },
    });
    expect(
      await screen.findByText(
        ar('admin.common.loadError.title', { page: ar('admin.audit.title') }),
      ),
    ).toBeTruthy();
    expect(getLocale()).toBe('ar');
  });
});
