// T071 (FR-160 to FR-162): the applications queue against its board, through the router, in both
// languages. The three tabs with the counts `home.summary` gives (in review is its `open`, waiting
// on the applicant its `waitingOnApplicant`, the lede both; decided uncounted); the search by name
// or email, sent once the typing stops and never twice for the same text; the table, its pages and
// the selected row's detail; the call record by its day in the panel's zone; approval held until
// FR-161's three conditions hold, each one said, and confirmed with an optional note; the decision
// dialog's three kinds; and the actions each state allows. The documents and the identity request
// are `identity.spec.tsx`'s (B14b-2).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Icon } from '../../design/components';
import { getLocale, setLocale, translate, type MessageKey } from '../../i18n';
import { dayMonth, dayMonthYear, timeOfDay } from '../../lib/format';
import { daysBefore, panelTimeZone, todayIn } from '../../lib/zone';
import {
  currentPath,
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
} from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const A = '0193a6f0-0000-7000-8000-00000000000a';
const B = '0193a6f0-0000-7000-8000-00000000000b';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const TAJWEED = {
  id: '0193a6f0-0000-7000-8000-0000000000a2',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};

const rowA = {
  teacherUserId: A,
  displayName: 'الشيخ ياسر حمدي',
  email: 'yasser@example.com',
  gender: 'male',
  isMinor: false,
  subjects: [QURAN, TAJWEED],
  submittedAt: '2026-10-14T09:00:00.000Z',
  status: 'in_review',
} as const;

const rowB = {
  teacherUserId: B,
  displayName: 'منى عبد الرحمن',
  email: 'mona@example.com',
  gender: 'female',
  isMinor: true,
  subjects: [TAJWEED],
  callRecordedOn: '2026-10-13',
  submittedAt: '2026-10-12T09:00:00.000Z',
  status: 'in_review',
} as const;

function detailOf(row: typeof rowA | typeof rowB, more: Record<string, unknown> = {}) {
  return {
    ...row,
    qualificationSummary: 'إجازة في حفظ القرآن بالسند المتصل.',
    timezoneCity: 'Africa/Cairo',
    accountStatus: 'active',
    identityDocument: {
      documentId: '0193a6f0-0000-7000-8000-0000000000d0',
      type: 'national_id',
      uploadedAt: row.submittedAt,
    },
    credentials: row.subjects.map((subject, index) => ({
      credentialId: `0193a6f0-0000-7000-8000-0000000000c${index}`,
      subject,
      status: 'pending',
      documentId: `0193a6f0-0000-7000-8000-0000000000e${index}`,
    })),
    call: {},
    // R1a (002:T174): `applications.get`'s history, none unless a case gives one.
    history: [],
    ...more,
  };
}

const summary = {
  queues: {
    applications: { open: 2, waitingOnApplicant: 1 },
    credentials: { open: 0, addedSubjects: 0 },
  },
  latestActions: [],
};

function fakeApi() {
  const api = {
    applications: {
      list: query(),
      get: query(),
      recordCall: mutation(),
      approve: mutation(),
      reject: mutation(),
      requestInfo: mutation(),
      ban: mutation(),
    },
    home: { summary: query() },
  };
  api.applications.list.query.mockResolvedValue({ rows: [rowA, rowB], total: 2, pageSize: 25 });
  api.applications.get.query.mockImplementation(async (input) =>
    (input as { teacherUserId: string }).teacherUserId === A ? detailOf(rowA) : detailOf(rowB),
  );
  api.home.summary.query.mockResolvedValue(summary);
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

function open(api = fakeApi(), { strict = false }: { readonly strict?: boolean } = {}) {
  return { ...renderApp({ at: '/applications', session: verified, api, strict }), api };
}

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** Selects a row of the table and waits for its detail. */
async function select(name: string) {
  const cells = await screen.findAllByText(name);
  const row = cells.map((cell) => cell.closest('tr')).find((found) => found !== null);
  fireEvent.click(row as HTMLElement);
  return screen.findByRole('complementary', {
    name: translate(getLocale(), 'admin.applications.detail.a11y'),
  });
}

describe('AdminApplications (FR-160)', () => {
  it('draws the queue in both languages: the counts, the tabs, the table and its footer', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText(rowA.email)).toBeTruthy();
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.applications.title') }),
        ).toBeTruthy();
        expect(await screen.findByText(t('admin.applications.lede', { count: 3 }))).toBeTruthy();
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual([
          `${t('admin.applications.tabs.inReview')}2`,
          `${t('admin.applications.tabs.waitingOnApplicant')}1`,
          t('admin.applications.tabs.decided'),
        ]);
        for (const column of ['applicant', 'subjects', 'call', 'submitted'] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.applications.columns.${column}`) }),
          ).toBeTruthy();
        }
        const subjects = locale === 'ar' ? 'حفظ القرآن، التجويد' : 'Quran, Tajweed';
        expect(screen.getByText(subjects)).toBeTruthy();
        expect(screen.getByText(t('admin.status.call.notRecorded'))).toBeTruthy();
        expect(
          screen.getByText(
            t('admin.status.call.recorded', {
              date: dayMonth('2026-10-13', locale, panelTimeZone()),
            }),
          ),
        ).toBeTruthy();
        // T111: «أُرسل» wraps rather than being cut at the table's edge.
        expect(
          screen.getByText(dayMonth(rowA.submittedAt, locale, panelTimeZone())).className,
        ).toBe('table__wrap');
        expect(
          screen.getByText(t('admin.applications.pagerSummary', { shown: 2, total: 2 })),
        ).toBeTruthy();
        expect(screen.getByText(t('admin.common.panel.nothingSelected'))).toBeTruthy();
      },
    );
  });

  it('reads the first page of the tab in review, and the counts once, even in strict mode', async () => {
    const { api } = open(fakeApi(), { strict: true });
    await screen.findByText(rowA.email);
    expect(api.applications.list.query).toHaveBeenCalledWith({ tab: 'in_review', page: 1 });
    expect(api.home.summary.query).toHaveBeenCalledTimes(1);
    expect(api.applications.list.query).toHaveBeenCalledTimes(1);
  });

  it('forgets what it read when the session ends', async () => {
    const { queries, sessions } = open();
    await screen.findByText(rowA.email);
    expect(queries.getQueryCache().getAll().length).toBeGreaterThan(0);
    act(() => sessions.clear());
    await waitFor(() => expect(queries.getQueryCache().getAll()).toHaveLength(0));
  });

  it('opens the selected row’s detail in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const aside = await select(rowA.displayName);
        const detail = within(aside);
        expect(await detail.findByText(rowA.displayName)).toBeTruthy();
        expect(
          detail.getByText(
            t('admin.applications.detail.meta', {
              gender: t('admin.common.gender.male'),
              city: locale === 'ar' ? 'القاهرة' : 'Cairo',
              date: dayMonthYear(rowA.submittedAt, locale, panelTimeZone()),
            }),
          ),
        ).toBeTruthy();
        const header = aside.querySelector('.panel__header');
        expect(
          within(header as HTMLElement).getByText(t('admin.status.application.inReview')),
        ).toBeTruthy();
        expect(detail.getByText(t('admin.common.documentType.nationalId'))).toBeTruthy();
        const subject = locale === 'ar' ? QURAN.nameAr : QURAN.nameEn;
        expect(
          detail.getByText(t('admin.applications.detail.credentialFile', { subject })),
        ).toBeTruthy();
        expect(detail.getByText('إجازة في حفظ القرآن بالسند المتصل.')).toBeTruthy();
        expect(detail.queryByText(t('admin.common.minor'))).toBeNull();
      },
    );
  });

  it('opens the credential still waiting in its queue, and is opened by `?teacher=` (T072)', async () => {
    const { view } = open();
    const detail = within(await select(rowA.displayName));
    fireEvent.click(
      await detail.findByRole('button', { name: ar('admin.applications.detail.reviewCredential') }),
    );
    await waitFor(() =>
      expect(currentPath()).toBe('/credentials?credential=0193a6f0-0000-7000-8000-0000000000c0'),
    );
    view.unmount();

    renderApp({ at: `/applications?teacher=${B}`, session: verified, api: fakeApi() });
    const opened = within(
      await screen.findByRole('complementary', { name: ar('admin.applications.detail.a11y') }),
    );
    expect(await opened.findByText(rowB.displayName)).toBeTruthy();
  });

  // T112 (a): one chevron in both languages, which `icon--flip` turns to the reading way in Arabic.
  it('points «مراجعة الإجازة» the reading way in both languages (T112)', async () => {
    const { container, unmount } = render(<Icon name="chevron-right" size="sm" />);
    const right = container.innerHTML;
    unmount();
    await inBothLocales(
      () => open(),
      async (t) => {
        const detail = within(await select(rowA.displayName));
        const link = await detail.findByRole('button', {
          name: t('admin.applications.detail.reviewCredential'),
        });
        expect(link.querySelector('svg')?.outerHTML).toBe(right);
      },
    );
  });

  it('marks a minor in the detail’s header (FR-132)', async () => {
    open();
    const detail = within(await select(rowB.displayName));
    expect(await detail.findByText(ar('admin.common.minor'))).toBeTruthy();
  });

  it('switches tabs, and searches by name or email once the typing stops', async () => {
    const { api } = open();
    await screen.findByText(rowA.email);
    fireEvent.click(
      screen.getByRole('tab', { name: ar('admin.applications.tabs.waitingOnApplicant') + '1' }),
    );
    await waitFor(() =>
      expect(api.applications.list.query).toHaveBeenCalledWith({ tab: 'waiting', page: 1 }),
    );
    const search = screen.getByPlaceholderText(ar('admin.applications.search.placeholder'));
    fireEvent.change(search, { target: { value: '   ' } });
    fireEvent.change(search, { target: { value: ' مني' } });
    fireEvent.change(search, { target: { value: ' منى ' } });
    await waitFor(() =>
      expect(api.applications.list.query).toHaveBeenCalledWith({
        tab: 'waiting',
        search: 'منى',
        page: 1,
      }),
    );
    const searches = () =>
      api.applications.list.query.mock.calls.filter(
        ([input]) => (input as { search?: string }).search !== undefined,
      );
    expect(searches()).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'منى' } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(searches()).toHaveLength(1);
  });

  it('turns the pages of a long tab', async () => {
    const api = fakeApi();
    api.applications.list.query.mockResolvedValue({ rows: [rowA], total: 30, pageSize: 25 });
    open(api);
    await screen.findByText(rowA.email);
    expect(
      screen.getByText(ar('admin.applications.pagerSummary', { shown: 1, total: 30 })),
    ).toBeTruthy();
    press('2');
    await waitFor(() =>
      expect(api.applications.list.query).toHaveBeenCalledWith({ tab: 'in_review', page: 2 }),
    );
    // A search goes back to the first page once it settles, with no read of page 1 before it.
    const before = api.applications.list.query.mock.calls.length;
    fireEvent.change(screen.getByPlaceholderText(ar('admin.applications.search.placeholder')), {
      target: { value: 'منى' },
    });
    await waitFor(() =>
      expect(api.applications.list.query).toHaveBeenCalledWith({
        tab: 'in_review',
        search: 'منى',
        page: 1,
      }),
    );
    expect(api.applications.list.query.mock.calls.slice(before)).toEqual([
      [{ tab: 'in_review', search: 'منى', page: 1 }],
    ]);
  });

  it('says an empty tab, an empty search, and a list that could not load, with a retry', async () => {
    const api = fakeApi();
    api.applications.list.query.mockResolvedValue({ rows: [], total: 0, pageSize: 25 });
    open(api);
    expect(await screen.findByText(ar('admin.applications.empty.title'))).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(ar('admin.applications.search.placeholder')), {
      target: { value: 'لا أحد' },
    });
    expect(await screen.findByText(ar('admin.applications.empty.search.title'))).toBeTruthy();
    api.applications.list.query.mockRejectedValue(refusal('INTERNAL'));
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.applications.tabs.decided') }));
    expect(
      await screen.findByText(
        ar('admin.common.loadError.title', { page: ar('admin.applications.title') }),
      ),
    ).toBeTruthy();
    api.applications.list.query.mockResolvedValue({ rows: [rowA], total: 1, pageSize: 25 });
    press(ar('admin.common.action.retry'));
    expect(await screen.findByText(rowA.email)).toBeTruthy();
  });

  // T112 (b): the page's name opens the English sentence, where its capital belongs.
  it('says in English which list could not load, with no capital inside the sentence (T112)', async () => {
    setLocale('en');
    const api = fakeApi();
    api.applications.list.query.mockRejectedValue(refusal('INTERNAL'));
    open(api);
    // The page's name is a value of the sentence, isolated (002:T153).
    expect(
      await screen.findByText('\u2068Teacher applications\u2069 could not be loaded'),
    ).toBeTruthy();
  });
});

describe('the call record (FR-161)', () => {
  it('records the call by its day in the panel’s zone, its outcome and its notes', async () => {
    const { api } = open();
    api.applications.recordCall.mutate.mockResolvedValue(undefined);
    const detail = within(await select(rowA.displayName));
    const date = await detail.findByLabelText(ar('admin.applications.detail.callDate'));
    // T111: a day / month / year field, as drawn, not the browser's month / day / year.
    expect(date.getAttribute('type')).toBe('text');
    expect(date.getAttribute('inputmode')).toBe('numeric');
    expect(date.getAttribute('placeholder')).toBe(
      ar('admin.applications.detail.callDatePlaceholder'),
    );
    const save = detail.getByRole('button', { name: ar('admin.applications.detail.saveCall') });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(date, { target: { value: '20102026' } });
    expect(date).toHaveProperty('value', '20/10/2026');
    fireEvent.click(detail.getByRole('button', { name: ar('admin.applications.detail.suitable') }));
    fireEvent.change(detail.getByLabelText(ar('admin.applications.detail.callNotes')), {
      target: { value: 'تحقّقت من الاسم والسند.' },
    });
    fireEvent.click(save);
    expect(await detail.findByText(ar('admin.applications.detail.callSaved'))).toBeTruthy();
    expect(api.applications.recordCall.mutate).toHaveBeenCalledWith({
      teacherUserId: A,
      completedOn: '2026-10-20',
      timeZone: panelTimeZone(),
      outcome: 'suitable',
      notes: 'تحقّقت من الاسم والسند.',
    });
  });

  // T111: the field reads the day first; a month / day / year text names no month.
  it('says a day the calendar does not have, and holds the save', async () => {
    const { api } = open();
    const detail = within(await select(rowA.displayName));
    const date = await detail.findByLabelText(ar('admin.applications.detail.callDate'));
    fireEvent.click(detail.getByRole('button', { name: ar('admin.applications.detail.suitable') }));
    fireEvent.change(detail.getByLabelText(ar('admin.applications.detail.callNotes')), {
      target: { value: 'ملاحظة' },
    });
    const save = detail.getByRole('button', { name: ar('admin.applications.detail.saveCall') });
    fireEvent.change(date, { target: { value: '10/20/2026' } });
    expect(detail.getByText(ar('admin.applications.detail.callDateInvalid'))).toBeTruthy();
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(date, { target: { value: '20/10/2026' } });
    expect(detail.queryByText(ar('admin.applications.detail.callDateInvalid'))).toBeNull();
    expect(save).toHaveProperty('disabled', false);
    expect(api.applications.recordCall.mutate).not.toHaveBeenCalled();
  });

  // T111: the browser's picker refused a day after today (`max`); the typed field says it itself.
  it('says a day after today in the panel’s zone before sending it', async () => {
    const { api } = open();
    const detail = within(await select(rowA.displayName));
    const [year, month, day] = daysBefore(todayIn(panelTimeZone()), -1).split('-');
    fireEvent.change(await detail.findByLabelText(ar('admin.applications.detail.callDate')), {
      target: { value: `${day ?? ''}${month ?? ''}${year ?? ''}` },
    });
    fireEvent.click(detail.getByRole('button', { name: ar('admin.applications.detail.suitable') }));
    fireEvent.change(detail.getByLabelText(ar('admin.applications.detail.callNotes')), {
      target: { value: 'ملاحظة' },
    });
    expect(detail.getByText(ar('admin.applications.detail.callFuture'))).toBeTruthy();
    expect(
      detail.getByRole('button', { name: ar('admin.applications.detail.saveCall') }),
    ).toHaveProperty('disabled', true);
    expect(api.applications.recordCall.mutate).not.toHaveBeenCalled();
  });

  it('says a day after today in place', async () => {
    const { api } = open();
    api.applications.recordCall.mutate.mockRejectedValue(
      refusal('VALIDATION_FAILED', [{ path: 'completedOn', code: 'future' }]),
    );
    const detail = within(await select(rowA.displayName));
    fireEvent.change(await detail.findByLabelText(ar('admin.applications.detail.callDate')), {
      target: { value: '20/10/2026' },
    });
    fireEvent.click(
      detail.getByRole('button', { name: ar('admin.applications.detail.unsuitable') }),
    );
    fireEvent.change(detail.getByLabelText(ar('admin.applications.detail.callNotes')), {
      target: { value: 'ملاحظة' },
    });
    fireEvent.click(detail.getByRole('button', { name: ar('admin.applications.detail.saveCall') }));
    expect(await detail.findByText(ar('admin.applications.detail.callFuture'))).toBeTruthy();
  });
});

describe('approval (FR-161)', () => {
  it('holds «اعتماد» and says each reason while the conditions do not hold', async () => {
    open();
    const detail = within(await select(rowA.displayName));
    const approve = await detail.findByRole('button', {
      name: ar('admin.applications.detail.approve'),
    });
    expect(approve).toHaveProperty('disabled', true);
    for (const reason of ['callNotRecorded', 'credentialUndecided', 'noneApproved'] as const) {
      expect(detail.getByText(ar(`admin.applications.blocked.${reason}`))).toBeTruthy();
    }
  });

  it('approves once the call is recorded and the credentials decided, with an optional note', async () => {
    const api = fakeApi();
    const ready = detailOf(rowB, {
      call: { completedOn: '2026-10-13', outcome: 'suitable', notes: 'تم' },
    });
    ready.credentials = [{ ...(ready.credentials[0] as object), status: 'approved' }] as never;
    api.applications.get.query.mockResolvedValue(ready);
    api.applications.approve.mutate.mockResolvedValue(undefined);
    open(api);
    const detail = within(await select(rowB.displayName));
    const approve = await detail.findByRole('button', {
      name: ar('admin.applications.detail.approve'),
    });
    await waitFor(() => expect(approve).toHaveProperty('disabled', false));
    fireEvent.click(approve);
    const dialog = within(
      await screen.findByRole('dialog', {
        name: ar('admin.dialogs.confirm.approveApplication.title', { name: rowB.displayName }),
      }),
    );
    expect(
      dialog.getByText(ar('admin.dialogs.confirm.approveApplication.effects.approved')),
    ).toBeTruthy();
    expect(dialog.getByText(ar('admin.dialogs.confirm.common.footerNote'))).toBeTruthy();
    fireEvent.change(dialog.getByLabelText(ar('admin.dialogs.confirm.common.noteLabel')), {
      target: { value: 'مطابق' },
    });
    fireEvent.click(
      dialog.getByRole('button', { name: ar('admin.dialogs.confirm.approveApplication.confirm') }),
    );
    await waitFor(() =>
      expect(api.applications.approve.mutate).toHaveBeenCalledWith({
        teacherUserId: B,
        note: 'مطابق',
      }),
    );
  });

  it('says the server’s reasons in the dialog when it refuses the approval', async () => {
    const api = fakeApi();
    const ready = detailOf(rowB, { call: { completedOn: '2026-10-13', outcome: 'suitable' } });
    ready.credentials = [{ ...(ready.credentials[0] as object), status: 'approved' }] as never;
    api.applications.get.query.mockResolvedValue(ready);
    api.applications.approve.mutate.mockRejectedValue(
      refusal('APPROVAL_BLOCKED', [{ path: 'approval', code: 'credential_undecided' }]),
    );
    open(api);
    const detail = within(await select(rowB.displayName));
    const approve = await detail.findByRole('button', {
      name: ar('admin.applications.detail.approve'),
    });
    await waitFor(() => expect(approve).toHaveProperty('disabled', false));
    fireEvent.click(approve);
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(
      dialog.getByRole('button', { name: ar('admin.dialogs.confirm.approveApplication.confirm') }),
    );
    expect(
      await dialog.findByText(ar('admin.applications.blocked.credentialUndecided')),
    ).toBeTruthy();
    expect(api.applications.approve.mutate).toHaveBeenCalledWith({ teacherUserId: B });
  });
});

describe('the decision dialog (FR-162)', () => {
  async function decide(action: MessageKey) {
    const opened = open();
    const detail = within(await select(rowA.displayName));
    fireEvent.click(await detail.findByRole('button', { name: ar(action) }));
    const dialog = within(
      await screen.findByRole('dialog', {
        name: ar('admin.dialogs.decision.title', { name: rowA.displayName }),
      }),
    );
    return { ...opened, dialog };
  }

  it('rejects with a reason and the note the applicant reads', async () => {
    const { api, dialog } = await decide('admin.applications.detail.reject');
    api.applications.reject.mutate.mockResolvedValue(undefined);
    expect(dialog.getByRole('group', { name: ar('admin.dialogs.decision.a11yKind') })).toBeTruthy();
    expect(dialog.getByText(ar('admin.dialogs.decision.reapplyHint'))).toBeTruthy();
    expect(dialog.getByText(ar('admin.dialogs.decision.footer'))).toBeTruthy();
    const confirm = dialog.getByRole('button', {
      name: ar('admin.dialogs.decision.confirmReject'),
    });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(dialog.getByLabelText(ar('admin.dialogs.decision.reasons.nameMismatch')));
    fireEvent.change(dialog.getByLabelText(ar('admin.dialogs.decision.noteLabel')), {
      target: { value: 'الاسم لا يطابق البطاقة.' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.applications.reject.mutate).toHaveBeenCalledWith({
        teacherUserId: A,
        reasonChoice: 'name_mismatch',
        note: 'الاسم لا يطابق البطاقة.',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('asks for information with the one thing needed', async () => {
    const { api, dialog } = await decide('admin.applications.detail.requestInfo');
    api.applications.requestInfo.mutate.mockResolvedValue(undefined);
    fireEvent.click(
      dialog.getByLabelText(ar('admin.dialogs.decision.requestInfo.reasons.idUnclear')),
    );
    fireEvent.change(dialog.getByLabelText(ar('admin.dialogs.decision.requestInfo.noteLabel')), {
      target: { value: 'الوجه الخلفي غير واضح.' },
    });
    fireEvent.click(
      dialog.getByRole('button', { name: ar('admin.dialogs.decision.requestInfo.confirm') }),
    );
    await waitFor(() =>
      expect(api.applications.requestInfo.mutate).toHaveBeenCalledWith({
        teacherUserId: A,
        needed: ['id_unclear'],
        note: 'الوجه الخلفي غير واضح.',
      }),
    );
  });

  it('offers no ijazah choice: another ijazah is asked for on its credential (T155)', async () => {
    const { dialog } = await decide('admin.applications.detail.requestInfo');
    const group = within(
      dialog.getByRole('group', { name: ar('admin.dialogs.decision.requestInfo.legend') }),
    );
    expect(group.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(
      [
        ar('admin.dialogs.decision.requestInfo.reasons.idUnclear'),
        ar('admin.dialogs.decision.requestInfo.reasons.nameMismatch'),
        ar('admin.dialogs.decision.requestInfo.reasons.other'),
      ],
    );
    expect(dialog.queryByText('ملف الإجازة غير مقروء أو ناقص')).toBeNull();
  });

  it('bans with a reason, switched to in place, and says a failure without closing', async () => {
    const { api, dialog } = await decide('admin.applications.detail.reject');
    api.applications.ban.mutate.mockRejectedValue(refusal('INTERNAL'));
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.dialogs.decision.kinds.ban') }));
    expect(dialog.getByText(ar('admin.dialogs.decision.ban.banner'))).toBeTruthy();
    fireEvent.click(dialog.getByLabelText(ar('admin.dialogs.decision.ban.reasons.impersonation')));
    fireEvent.change(dialog.getByLabelText(ar('admin.dialogs.decision.ban.noteLabel')), {
      target: { value: 'انتحال.' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.dialogs.decision.ban.confirm') }));
    expect(await dialog.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    expect(api.applications.ban.mutate).toHaveBeenCalledWith({
      teacherUserId: A,
      reasonChoice: 'impersonation',
      note: 'انتحال.',
    });
  });
});

describe('the actions each state allows (FR-162)', () => {
  it.each([
    ['needs_document', ['reject', 'ban']],
    ['rejected', ['ban']],
    ['approved', []],
    ['banned', []],
  ] as const)('offers %s only %j', async (status, offered) => {
    const api = fakeApi();
    api.applications.get.query.mockResolvedValue(detailOf(rowA, { status }));
    open(api);
    const detail = within(await select(rowA.displayName));
    await detail.findByText('إجازة في حفظ القرآن بالسند المتصل.');
    for (const action of ['approve', 'requestInfo', 'reject', 'ban'] as const) {
      const button = detail.queryByRole('button', {
        name: ar(`admin.applications.detail.${action}`),
      });
      expect(button === null ? 'absent' : 'present').toBe(
        (offered as readonly string[]).includes(action) ? 'present' : 'absent',
      );
    }
  });
});

describe('T058: RATE_LIMITED on the applications', () => {
  const limited = (seconds?: string) =>
    refusal(
      'RATE_LIMITED',
      seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }],
    );

  it('the queue says when to try again', async () => {
    const api = fakeApi();
    api.applications.list.query.mockRejectedValue(limited('61'));
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('the detail says to wait a little when no time is given', async () => {
    const api = fakeApi();
    api.applications.get.query.mockRejectedValue(limited());
    open(api);
    const detail = within(await select(rowA.displayName));
    expect(await detail.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(detail.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('the approval says when to try again', async () => {
    const api = fakeApi();
    const ready = detailOf(rowB, { call: { completedOn: '2026-10-13', outcome: 'suitable' } });
    ready.credentials = [{ ...(ready.credentials[0] as object), status: 'approved' }] as never;
    api.applications.get.query.mockResolvedValue(ready);
    api.applications.approve.mutate.mockRejectedValue(limited('120'));
    open(api);
    const detail = within(await select(rowB.displayName));
    const approve = await detail.findByRole('button', {
      name: ar('admin.applications.detail.approve'),
    });
    await waitFor(() => expect(approve).toHaveProperty('disabled', false));
    fireEvent.click(approve);
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(
      dialog.getByRole('button', { name: ar('admin.dialogs.confirm.approveApplication.confirm') }),
    );
    expect(await dialog.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(dialog.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });

  it('a decision says when to try again', async () => {
    const api = fakeApi();
    api.applications.ban.mutate.mockRejectedValue(limited('31'));
    open(api);
    const detail = within(await select(rowA.displayName));
    fireEvent.click(
      await detail.findByRole('button', { name: ar('admin.applications.detail.reject') }),
    );
    const dialog = within(
      await screen.findByRole('dialog', {
        name: ar('admin.dialogs.decision.title', { name: rowA.displayName }),
      }),
    );
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.dialogs.decision.kinds.ban') }));
    fireEvent.click(dialog.getByLabelText(ar('admin.dialogs.decision.ban.reasons.impersonation')));
    fireEvent.change(dialog.getByLabelText(ar('admin.dialogs.decision.ban.noteLabel')), {
      target: { value: 'انتحال.' },
    });
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.dialogs.decision.ban.confirm') }));
    expect(await dialog.findByText(ar('admin.common.rateLimitedIn', { count: 1 }))).toBeTruthy();
    expect(dialog.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });
});

// R1a (002:T174; SRS DEC-97; contracts/admin-surface.md, the decision history): the panel's history
// section, read from `applications.get`'s `history`, oldest first as the server answers it: each
// decision's action in words, its note when there is one, who made it and when, in both languages.
describe('the decision history (R1a, T174)', () => {
  const ASKED = '2026-10-15T08:30:00.000Z';
  const APPROVED = '2026-10-16T11:05:00.000Z';
  const history = [
    { action: 'request_info', note: 'صورة الهوية غير واضحة', adminName: 'أ. سعاد', at: ASKED },
    { action: 'approve', adminName: 'أ. خالد', at: APPROVED },
  ];

  it('draws each decision oldest first: the action in words, the note, who and when', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.applications.get.query.mockResolvedValue(
          detailOf(rowA, { status: 'approved', history }),
        );
        return open(api);
      },
      async (t, locale) => {
        const detail = within(await select(rowA.displayName));
        const section = (
          await detail.findByRole('heading', { name: t('admin.applications.detail.history.title') })
        ).closest('section') as HTMLElement;
        const items = within(section).getAllByRole('listitem');
        expect(items.map((item) => within(item).getByRole('term').textContent)).toEqual([
          t('admin.applications.detail.history.actions.requestInfo'),
          t('admin.applications.detail.history.actions.approve'),
        ]);
        const zone = panelTimeZone();
        const metaOf = (adminName: string, at: string) =>
          t('admin.applications.detail.history.meta', {
            date: dayMonthYear(at, locale, zone),
            time: timeOfDay(at, locale, zone),
            admin: adminName,
          });
        expect(within(items[0] as HTMLElement).getByText('صورة الهوية غير واضحة')).toBeTruthy();
        expect(within(items[0] as HTMLElement).getByText(metaOf('أ. سعاد', ASKED))).toBeTruthy();
        expect(within(items[1] as HTMLElement).getByText(metaOf('أ. خالد', APPROVED))).toBeTruthy();
        // An approval with no note shows none.
        expect(within(items[1] as HTMLElement).queryByText('صورة الهوية غير واضحة')).toBeNull();
      },
    );
  });

  it('says there is no decision yet', async () => {
    open();
    const detail = within(await select(rowA.displayName));
    expect(await detail.findByText(ar('admin.applications.detail.history.empty'))).toBeTruthy();
  });
});
