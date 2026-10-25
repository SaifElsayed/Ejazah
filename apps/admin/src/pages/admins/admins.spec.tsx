// T073 (FR-173, FR-174): the administrators' page against its boards (`AdminAdmins`,
// `AdminAddAdminDialog`, `AdminMfaResetDialog`, the `disableAdmin` confirmation), through the router,
// in both languages. The two tabs; the search by name or email; the table (the administrator, «أنت»
// on one's own row, the second factor, the last sign-in, when added) and its pager by name; the
// selected administrator's detail from its row; adding one by name and address, an address taken
// said in place; resetting another's second factor and disabling another's account, each with its
// reason; on one's own account, the note that another administrator does those, and new recovery
// codes for a current code of one's own second factor (T096), shown once.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getLocale, setLocale, translate, type MessageKey } from '../../i18n';
import { dayMonth, dayMonthYear, timeOfDay } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import { inBothLocales, mutation, query, refusal, renderApp } from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const SELF = '0193a6f0-0000-7000-8000-0000000000a1';
const OTHER = '0193a6f0-0000-7000-8000-0000000000a2';
const INVITED = '0193a6f0-0000-7000-8000-0000000000a3';
const GONE = '0193a6f0-0000-7000-8000-0000000000a4';

const self = {
  adminId: SELF,
  displayName: 'سارة عادل',
  email: 'sara.adel@example.com',
  self: true,
  mfaEnrolled: true,
  lastSignInAt: '2026-10-15T07:02:00.000Z',
  invitedAt: '2026-03-01T09:00:00.000Z',
  recoveryCodesLeft: 10,
} as const;
const other = {
  adminId: OTHER,
  displayName: 'عمرو خالد',
  email: 'amr.khaled@example.com',
  self: false,
  mfaEnrolled: true,
  lastSignInAt: '2026-10-14T15:30:00.000Z',
  invitedAt: '2026-05-20T09:00:00.000Z',
  invitedByName: 'سارة عادل',
  recoveryCodesLeft: 7,
} as const;
const invited = {
  adminId: INVITED,
  displayName: 'نهى سمير',
  email: 'noha.samir@example.com',
  self: false,
  mfaEnrolled: false,
  invitedAt: '2026-10-20T09:00:00.000Z',
  invitedByName: 'سارة عادل',
  recoveryCodesLeft: 0,
} as const;
const gone = {
  adminId: GONE,
  displayName: 'خالد يوسف',
  email: 'khaled@example.com',
  self: false,
  mfaEnrolled: true,
  recoveryCodesLeft: 3,
  disabledAt: '2026-09-01T09:00:00.000Z',
} as const;

const CODES = ['AAAA-BBBB-CC', 'DDDD-EEEE-FF'];

function fakeApi() {
  const api = {
    admins: {
      list: query(),
      add: mutation(),
      disable: mutation(),
      resetMfa: mutation(),
      regenerateRecoveryCodes: mutation(),
    },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.admins.list.query.mockImplementation(async (input) =>
    (input as { tab: string }).tab === 'disabled'
      ? { rows: [gone], total: 1, pageSize: 25 }
      : { rows: [self, other, invited], total: 3, pageSize: 25 },
  );
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({
    adminId: SELF,
    displayName: self.displayName,
    email: self.email,
  });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const tr = (key: MessageKey, values?: Record<string, string | number>) =>
  translate(getLocale(), key, values);

function open(api = fakeApi()) {
  return { ...renderApp({ at: '/settings/admins', session: verified, api }), api };
}

/** Selects the row of `name` and waits for its detail. */
async function select(name: string) {
  // The sidebar names the reader too; the table is read first.
  await screen.findAllByRole('row');
  const cells = await screen.findAllByText(name);
  fireEvent.click(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
  return within(await screen.findByRole('complementary', { name: tr('admin.admins.a11y.detail') }));
}

/** The open dialog whose title is `title`. */
async function dialog(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

describe('AdminAdmins (FR-174)', () => {
  it('draws the active administrators in both languages: the table and its footer', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const zone = panelTimeZone();
        expect(await screen.findByText(other.email)).toBeTruthy();
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.admins.title') }),
        ).toBeTruthy();
        expect(screen.getByText(t('admin.admins.lede'))).toBeTruthy();
        expect(screen.getByRole('button', { name: t('admin.admins.add') })).toBeTruthy();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
          t('admin.admins.tabs.active'),
          t('admin.admins.tabs.disabled'),
        ]);
        for (const column of ['admin', 'mfa', 'lastSignIn', 'added'] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.admins.columns.${column}`) }),
          ).toBeTruthy();
        }
        expect(screen.getByText(`· ${t('admin.admins.you')}`)).toBeTruthy();
        expect(screen.getAllByText(t('admin.admins.mfa.enabled'))).toHaveLength(2);
        expect(screen.getByText(t('admin.admins.mfa.notSetUp'))).toBeTruthy();
        expect(
          screen.getByText(
            `${dayMonth(other.lastSignInAt, locale, zone)} · ${timeOfDay(other.lastSignInAt, locale, zone)}`,
          ),
        ).toBeTruthy();
        expect(screen.getByText(dayMonthYear(other.invitedAt, locale, zone))).toBeTruthy();
        expect(
          screen.getByText(t('admin.admins.pagerSummary', { shown: 3, total: 3 })),
        ).toBeTruthy();
      },
    );
  });

  it('reads the active tab, the disabled tab, and a search once the typing stops', async () => {
    const { api } = open();
    await screen.findByText(other.email);
    expect(api.admins.list.query).toHaveBeenCalledWith({ tab: 'active', page: 1 });
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.admins.tabs.disabled') }));
    expect(await screen.findByText(gone.email)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(ar('admin.admins.search.placeholder')), {
      target: { value: '  خالد ' },
    });
    await waitFor(() =>
      expect(api.admins.list.query).toHaveBeenLastCalledWith({
        tab: 'disabled',
        search: 'خالد',
        page: 1,
      }),
    );
  });

  it('opens another administrator’s detail with the two actions, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const zone = panelTimeZone();
        const detail = await select(other.displayName);
        expect(detail.getByText(other.email)).toBeTruthy();
        expect(detail.getByText(t('admin.status.account.active'))).toBeTruthy();
        expect(
          detail.getByText(
            t('admin.admins.detail.added', {
              date: dayMonthYear(other.invitedAt, locale, zone),
              admin: other.invitedByName,
            }),
          ),
        ).toBeTruthy();
        expect(detail.getByText(t('admin.admins.detail.mfaEnabled', { count: 7 }))).toBeTruthy();
        expect(
          detail.getByRole('button', { name: t('admin.admins.detail.resetMfa') }),
        ).toBeTruthy();
        expect(detail.getByRole('button', { name: t('admin.admins.detail.disable') })).toBeTruthy();
        expect(detail.queryByText(t('admin.admins.detail.selfNote'))).toBeNull();
        expect(detail.getByText(t('admin.admins.detail.footer'))).toBeTruthy();
      },
    );
  });

  it('on one’s own account says another administrator acts, and offers new recovery codes alone', async () => {
    open();
    const detail = await select(self.displayName);
    expect(detail.getByText(ar('admin.admins.detail.selfNote'))).toBeTruthy();
    expect(detail.queryByRole('button', { name: ar('admin.admins.detail.resetMfa') })).toBeNull();
    expect(detail.queryByRole('button', { name: ar('admin.admins.detail.disable') })).toBeNull();
    expect(detail.getByRole('button', { name: ar('admin.admins.recovery.action') })).toBeTruthy();
  });

  it('offers nothing on a disabled account', async () => {
    open();
    await screen.findByText(other.email);
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.admins.tabs.disabled') }));
    const detail = await select(gone.displayName);
    expect(detail.getByText(ar('admin.status.account.disabled'))).toBeTruthy();
    expect(detail.queryByRole('button')).toBeNull();
  });
});

describe('the dialogs (FR-173, FR-174)', () => {
  it('adds an administrator by name and address, and says an address taken', async () => {
    const { api } = open();
    api.admins.add.mutate.mockRejectedValueOnce(
      refusal('CONFLICT', [{ path: 'email', code: 'taken' }]),
    );
    api.admins.add.mutate.mockResolvedValueOnce({ adminId: 'x' });
    await screen.findByText(other.email);
    fireEvent.click(screen.getByRole('button', { name: ar('admin.admins.add') }));
    const adding = await dialog(ar('admin.dialogs.addAdmin.title'));
    const send = adding.getByRole('button', { name: ar('admin.dialogs.addAdmin.send') });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    type(adding.getByLabelText(ar('admin.dialogs.addAdmin.name')), '  هالة فؤاد ');
    type(adding.getByLabelText(ar('admin.dialogs.addAdmin.workEmail')), ' hala@example.com ');
    fireEvent.click(send);
    expect(await adding.findByText(ar('admin.dialogs.addAdmin.emailTaken'))).toBeTruthy();
    fireEvent.click(send);
    await waitFor(() =>
      expect(api.admins.add.mutate).toHaveBeenLastCalledWith({
        displayName: 'هالة فؤاد',
        email: 'hala@example.com',
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 2, name: ar('admin.dialogs.addAdmin.title') }),
      ).toBeNull(),
    );
    expect(api.admins.list.query).toHaveBeenCalledTimes(2);
  });

  it('resets another’s second factor with the reason', async () => {
    const { api } = open();
    api.admins.resetMfa.mutate.mockResolvedValue(undefined);
    const detail = await select(other.displayName);
    fireEvent.click(detail.getByRole('button', { name: ar('admin.admins.detail.resetMfa') }));
    const resetting = await dialog(ar('admin.dialogs.mfaReset.title', { name: other.displayName }));
    expect(resetting.getByText(ar('admin.dialogs.mfaReset.effects.sessionsEnded'))).toBeTruthy();
    expect(resetting.getByText(ar('admin.dialogs.mfaReset.verifyHint'))).toBeTruthy();
    const confirm = resetting.getByRole('button', { name: ar('admin.dialogs.mfaReset.confirm') });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    type(resetting.getByLabelText(ar('admin.dialogs.mfaReset.reasonLabel')), 'فقد هاتفه');
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.admins.resetMfa.mutate).toHaveBeenCalledWith({
        adminId: OTHER,
        reason: 'فقد هاتفه',
      }),
    );
  });

  it('disables another’s account with the reason', async () => {
    const { api } = open();
    api.admins.disable.mutate.mockResolvedValue(undefined);
    const detail = await select(other.displayName);
    fireEvent.click(detail.getByRole('button', { name: ar('admin.admins.detail.disable') }));
    const disabling = await dialog(
      ar('admin.dialogs.confirm.disableAdmin.title', { name: other.displayName }),
    );
    expect(
      disabling.getByText(ar('admin.dialogs.confirm.disableAdmin.effects.noSignIn')),
    ).toBeTruthy();
    type(
      disabling.getByLabelText(ar('admin.dialogs.confirm.disableAdmin.reasonLabel')),
      'ترك الفريق',
    );
    fireEvent.click(
      disabling.getByRole('button', { name: ar('admin.dialogs.confirm.disableAdmin.confirm') }),
    );
    await waitFor(() =>
      expect(api.admins.disable.mutate).toHaveBeenCalledWith({
        adminId: OTHER,
        reason: 'ترك الفريق',
      }),
    );
  });

  it('makes new recovery codes for a current code, and shows them once (T096)', async () => {
    const { api } = open();
    api.admins.regenerateRecoveryCodes.mutate.mockRejectedValueOnce(refusal('CODE_INVALID'));
    api.admins.regenerateRecoveryCodes.mutate.mockResolvedValueOnce({ recoveryCodes: CODES });
    const detail = await select(self.displayName);
    fireEvent.click(detail.getByRole('button', { name: ar('admin.admins.recovery.action') }));
    const making = await dialog(ar('admin.admins.recovery.title'));
    expect(making.getByText(ar('admin.admins.recovery.text'))).toBeTruthy();
    const create = making.getByRole('button', { name: ar('admin.admins.recovery.confirm') });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(making.getByLabelText(ar('admin.common.a11y.digit1')), {
      target: { value: '123456' },
    });
    fireEvent.click(create);
    expect(await making.findByText(ar('admin.admins.recovery.codeInvalid'))).toBeTruthy();
    fireEvent.click(create);
    await waitFor(() =>
      expect(api.admins.regenerateRecoveryCodes.mutate).toHaveBeenLastCalledWith({
        code: '123456',
      }),
    );
    expect(await making.findByText(CODES[0] ?? '')).toBeTruthy();
    const done = making.getByRole('button', { name: ar('admin.admins.recovery.done') });
    expect((done as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(making.getByLabelText(ar('admin.mfaSetup.step3.savedConfirm')));
    fireEvent.click(done);
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 2, name: ar('admin.admins.recovery.title') }),
      ).toBeNull(),
    );
  });
});
