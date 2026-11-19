// 005:T022 (B49; FR-609, FR-610, FR-629; the note under T022, Q-P2 (b), Q-I1 (a)): the ijazahs
// through the router, in both languages. The page opens on «waiting for sign-off» (`status:
// 'rendered'`), its own tab; each row with its number in groups of four, its parties, its subject
// and date, and its status. An ijazah's detail at `?ijazah=`: the rendered PDF drawn from
// `ijazahs.get.pdfLink` as `pages/credentials/` draws a file, or, before its rendering, the words
// that say so and no file opened. The sign-off with a key; the re-render and the revocation with a
// reason; each refusal in its own words. The bar and its lift on the ijazah's student. The barred
// list (`ijazahs.barred`), each row with its student leading to `/users?user=`, when, by whom and
// why, and the lift; its empty state. The audit log's words for `ijazah_bars.listed`.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { dayMonthYear } from '../../lib/format';
import { openPdf } from '../../lib/pdf';
import { panelTimeZone } from '../../lib/zone';
import {
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
  type Translate,
} from '../../test/app-harness';
import { actionText } from '../audit/actions';

vi.mock('../../lib/pdf', () => ({
  openPdf: vi.fn(async () => ({ pageCount: 1, renderPage: vi.fn(async () => {}), close: vi.fn() })),
}));

beforeEach(() => {
  vi.mocked(openPdf).mockClear();
});
afterEach(() => {
  setLocale('ar');
});

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const I1 = '0193a6f0-0000-7000-8000-0000000000a1';
const I2 = '0193a6f0-0000-7000-8000-0000000000a2';
const R1 = '0193a6f0-0000-7000-8000-0000000000f1';
const E1 = '0193a6f0-0000-7000-8000-0000000000e1';
const T1 = '0193a6f0-0000-7000-8000-0000000000c1';
const S1 = '0193a6f0-0000-7000-8000-0000000000b1';
const S2 = '0193a6f0-0000-7000-8000-0000000000b2';
const BAR1 = '0193a6f0-0000-7000-8000-0000000000d1';
const BAR2 = '0193a6f0-0000-7000-8000-0000000000d2';
const ADMIN = '0193a6f0-0000-7000-8000-000000000099';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000d9',
  nameAr: 'القرآن الكريم',
  nameEn: 'Quran',
};
const GRANTED_AT = '2026-11-17T09:00:00.000Z';
const BARRED_AT = '2026-11-18T10:00:00.000Z';
const PDF = 'http://localhost:3000/files/certificates/a/1.pdf?expires=x&signature=y';

const rendered = {
  ijazahId: I1,
  certificateNumber: '7K3MQ9TD2XWB8HRN',
  enrollmentId: E1,
  requestId: R1,
  teacher: { userId: T1, displayName: 'الشيخ عمر' },
  student: { userId: S1, displayName: 'مريم أحمد' },
  subject: QURAN,
  language: 'ar',
  grantedAt: GRANTED_AT,
  status: 'rendered',
  rendered: true,
  revoked: false,
  renderGeneration: 1,
  signedOffAt: null,
  revokedAt: null,
} as const;
const preparing = {
  ...rendered,
  ijazahId: I2,
  certificateNumber: 'ABCDEFGHJKMNPQRS',
  student: { userId: S2, displayName: 'Huda Samir' },
  status: 'preparing',
  rendered: false,
} as const;

const detailOf = (row: typeof rendered | typeof preparing, pdfLink: string | null) => ({
  ...row,
  completionDate: '2026-11-10',
  chain: [['رسول الله ﷺ'], ['عمر بن فاروق']],
  studentNamePrinted: 'مريم بنت أحمد',
  teacherNamePrinted: 'عمر بن فاروق المصري',
  riwaya: 'حفص عن عاصم',
  tariq: 'الشاطبية',
  revokedReason: null,
  pdfLink,
});

const bar1 = {
  barId: BAR1,
  student: { userId: S1, displayName: 'مريم أحمد' },
  reason: 'تزوير في الهوية',
  barredAt: BARRED_AT,
  barredBy: { adminId: ADMIN, displayName: 'سارة عادل' },
};
const bar2 = { ...bar1, barId: BAR2, student: { userId: S2, displayName: null } };

function fakeApi() {
  const api = {
    ijazahs: {
      list: query(),
      get: query(),
      barred: query(),
      signOff: mutation(),
      rerender: mutation(),
      revoke: mutation(),
      bar: mutation(),
      liftBar: mutation(),
    },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.ijazahs.list.query.mockImplementation(async (input) =>
    (input as { status?: string }).status === 'rendered'
      ? { items: [rendered] }
      : { items: [rendered, preparing] },
  );
  api.ijazahs.get.query.mockImplementation(async (input) =>
    (input as { ijazahId: string }).ijazahId === I1
      ? detailOf(rendered, PDF)
      : detailOf(preparing, null),
  );
  api.ijazahs.barred.query.mockResolvedValue({ items: [bar1, bar2] });
  for (const each of ['signOff', 'rerender', 'revoke', 'bar', 'liftBar'] as const) {
    api.ijazahs[each].mutate.mockResolvedValue(undefined);
  }
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

function open(api = fakeApi(), at = '/ijazahs') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The ijazah's detail beside the list, once read. */
async function detailPanel(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', { name: t('admin.ijazahs.detail.a11y') });
  await within(aside).findByText(t('admin.ijazahs.pdf.title'));
  return within(aside);
}

async function dialog() {
  return within(await screen.findByRole('dialog'));
}

/** Presses `button` in the panel, writes `reason` when the dialog asks one, and confirms. */
async function act(
  panel: ReturnType<typeof within>,
  button: MessageKey,
  confirm: MessageKey,
  reasonLabel?: MessageKey,
) {
  fireEvent.click(panel.getByRole('button', { name: ar(button) }));
  const opened = await dialog();
  if (reasonLabel !== undefined) {
    fireEvent.change(opened.getByLabelText(ar(reasonLabel)), {
      target: { value: '  خطأ في الاسم  ' },
    });
  }
  fireEvent.click(opened.getByRole('button', { name: ar(confirm) }));
  return opened;
}

describe('the ijazahs (FR-609, FR-629)', () => {
  it('opens on «waiting for sign-off», its own tab: the number in groups of four, the parties, the subject and date, the status, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText('7K3M-Q9TD-2XWB-8HRN')).toBeTruthy();
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.ijazahs.title') }),
        ).toBeTruthy();
        expect(
          screen
            .getByRole('tab', { name: t('admin.ijazahs.tabs.waitingSignOff') })
            .getAttribute('aria-selected'),
        ).toBe('true');
        expect(
          screen.getByText(
            t('admin.ijazahs.partiesCell', {
              student: rendered.student.displayName,
              teacher: rendered.teacher.displayName,
            }),
          ),
        ).toBeTruthy();
        expect(
          screen.getByText(
            t('admin.ijazahs.issuedCell', {
              subject: locale === 'ar' ? QURAN.nameAr : QURAN.nameEn,
              date: dayMonthYear(GRANTED_AT, locale, panelTimeZone()),
            }),
          ),
        ).toBeTruthy();
        expect(
          within(screen.getByRole('table')).getByText(t('admin.ijazahs.status.rendered')),
        ).toBeTruthy();
      },
    );
  });

  it('reads `status: rendered` first, and every ijazah under «All»', async () => {
    const { api } = open();
    await screen.findByText('7K3M-Q9TD-2XWB-8HRN');
    expect(api.ijazahs.list.query).toHaveBeenLastCalledWith({ status: 'rendered' });
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.ijazahs.tabs.all') }));
    await waitFor(() => expect(api.ijazahs.list.query).toHaveBeenLastCalledWith({}));
    expect(await screen.findByText('ABCD-EFGH-JKMN-PQRS')).toBeTruthy();
  });
});

describe("an ijazah's detail (R-412, FR-629)", () => {
  it('draws the rendered PDF from its link, and the frozen record, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/ijazahs?ijazah=${I1}`),
      async (t) => {
        const panel = await detailPanel(t);
        await waitFor(() => expect(openPdf).toHaveBeenCalledWith(PDF));
        expect(panel.getByText('مريم بنت أحمد')).toBeTruthy();
        expect(panel.getByText('عمر بن فاروق المصري')).toBeTruthy();
        expect(panel.getByText('رسول الله ﷺ')).toBeTruthy();
        expect(panel.getByRole('button', { name: t('admin.ijazahs.detail.signOff') })).toBeTruthy();
        expect(
          panel
            .getByRole('link', { name: t('admin.ijazahs.detail.openRequest') })
            .getAttribute('href'),
        ).toBe(`/ijazah-requests?request=${R1}`);
      },
    );
  });

  it('says a certificate not rendered yet is being prepared, opens no file and offers no sign-off', async () => {
    open(fakeApi(), `/ijazahs?ijazah=${I2}`);
    const panel = await detailPanel();
    expect(panel.getByText(ar('admin.ijazahs.pdf.notRendered'))).toBeTruthy();
    expect(openPdf).not.toHaveBeenCalled();
    expect(panel.queryByRole('button', { name: ar('admin.ijazahs.detail.signOff') })).toBeNull();
  });

  it('signs off once with a key', async () => {
    const { api } = open(fakeApi(), `/ijazahs?ijazah=${I1}`);
    const panel = await detailPanel();
    const opened = await act(
      panel,
      'admin.ijazahs.detail.signOff',
      'admin.dialogs.confirm.signOffIjazah.confirm',
    );
    expect(opened.getByText(ar('admin.dialogs.confirm.signOffIjazah.effects.final'))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.ijazahs.signOff.mutate).toHaveBeenCalledTimes(1);
    expect(api.ijazahs.signOff.mutate).toHaveBeenCalledWith({
      ijazahId: I1,
      idempotencyKey: expect.any(String),
    });
  });

  it.each([
    [
      'rerender',
      'admin.ijazahs.detail.rerender',
      'admin.dialogs.confirm.rerenderIjazah.confirm',
      'admin.dialogs.confirm.rerenderIjazah.reasonLabel',
    ],
    [
      'revoke',
      'admin.ijazahs.detail.revoke',
      'admin.dialogs.revoke.confirm',
      'admin.dialogs.revoke.reasonLabel',
    ],
  ] as const)(
    '%s takes a reason, trimmed, sent with a key',
    async (procedure, button, confirm, reason) => {
      const { api } = open(fakeApi(), `/ijazahs?ijazah=${I1}`);
      const panel = await detailPanel();
      await act(panel, button, confirm, reason);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.ijazahs[procedure].mutate).toHaveBeenCalledWith({
        ijazahId: I1,
        reason: 'خطأ في الاسم',
        idempotencyKey: expect.any(String),
      });
    },
  );

  it.each([
    ['signOff', 'not_rendered', 'admin.ijazahs.refused.notRendered'],
    ['signOff', 'student_barred', 'admin.ijazahs.refused.studentBarred'],
    ['signOff', 'already_signed_off', 'admin.ijazahs.refused.alreadySignedOff'],
    ['signOff', 'revoked', 'admin.ijazahs.refused.revoked'],
    ['revoke', 'already_revoked', 'admin.ijazahs.refused.alreadyRevoked'],
  ] as const)('says a refused %s `%s` in its own words', async (procedure, code, words) => {
    const api = fakeApi();
    api.ijazahs[procedure].mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'ijazahId', code }]),
    );
    open(api, `/ijazahs?ijazah=${I1}`);
    const panel = await detailPanel();
    const opened =
      procedure === 'signOff'
        ? await act(
            panel,
            'admin.ijazahs.detail.signOff',
            'admin.dialogs.confirm.signOffIjazah.confirm',
          )
        : await act(
            panel,
            'admin.ijazahs.detail.revoke',
            'admin.dialogs.revoke.confirm',
            'admin.dialogs.revoke.reasonLabel',
          );
    expect(await opened.findByText(ar(words))).toBeTruthy();
  });

  it.each([
    [
      'bar',
      'admin.common.action.barFromIjazahs',
      'barFromIjazahs',
      'already_barred',
      'admin.ijazahs.refused.alreadyBarred',
    ],
    [
      'liftBar',
      'admin.ijazahs.barred.lift',
      'liftIjazahBar',
      'not_barred',
      'admin.ijazahs.refused.notBarred',
    ],
  ] as const)(
    "%s on the ijazah's student: sent with the student, and refused in its own words",
    async (procedure, button, dialogKey, code, words) => {
      const api = fakeApi();
      api.ijazahs[procedure].mutate.mockRejectedValueOnce(
        refusal('CONFLICT', [{ path: 'userId', code }]),
      );
      open(api, `/ijazahs?ijazah=${I1}`);
      const panel = await detailPanel();
      const opened = await act(
        panel,
        button,
        `admin.dialogs.confirm.${dialogKey}.confirm`,
        `admin.dialogs.confirm.${dialogKey}.reasonLabel`,
      );
      expect(await opened.findByText(ar(words))).toBeTruthy();
      expect(api.ijazahs[procedure].mutate).toHaveBeenCalledWith({
        targetUserId: S1,
        reason: 'خطأ في الاسم',
        idempotencyKey: expect.any(String),
      });
    },
  );
});

describe('the barred list (FR-610, Q-P2 (b))', () => {
  it('draws each open bar: the student leading to the users page, when, by whom and why, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        fireEvent.click(await screen.findByRole('tab', { name: t('admin.ijazahs.tabs.barred') }));
        const list = within(
          await screen.findByRole('region', { name: t('admin.ijazahs.barred.a11y') }),
        );
        const student = await list.findByRole('link', { name: bar1.student.displayName });
        expect(student.getAttribute('href')).toBe(`/users?user=${S1}`);
        expect(
          list
            .getByRole('link', { name: t('admin.users.directory.deletedAccount') })
            .getAttribute('href'),
        ).toBe(`/users?user=${S2}`);
        expect(
          list.getAllByText(
            t('admin.ijazahs.barred.meta', {
              date: dayMonthYear(BARRED_AT, locale, panelTimeZone()),
              admin: bar1.barredBy.displayName,
              reason: bar1.reason,
            }),
          ),
        ).toHaveLength(2);
        expect(list.getAllByRole('button', { name: t('admin.ijazahs.barred.lift') })).toHaveLength(
          2,
        );
      },
    );
  });

  it('lifts a bar from its row with a reason and a key, then reads the list again', async () => {
    const { api } = open();
    fireEvent.click(await screen.findByRole('tab', { name: ar('admin.ijazahs.tabs.barred') }));
    const list = within(
      await screen.findByRole('region', { name: ar('admin.ijazahs.barred.a11y') }),
    );
    const [first] = await list.findAllByRole('button', { name: ar('admin.ijazahs.barred.lift') });
    expect(api.ijazahs.barred.query).toHaveBeenLastCalledWith({});
    const reads = api.ijazahs.barred.query.mock.calls.length;
    fireEvent.click(first as HTMLElement);
    const opened = await dialog();
    fireEvent.change(opened.getByLabelText(ar('admin.dialogs.confirm.liftIjazahBar.reasonLabel')), {
      target: { value: 'خطأ' },
    });
    fireEvent.click(
      opened.getByRole('button', { name: ar('admin.dialogs.confirm.liftIjazahBar.confirm') }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.ijazahs.liftBar.mutate).toHaveBeenCalledWith({
      targetUserId: S1,
      reason: 'خطأ',
      idempotencyKey: expect.any(String),
    });
    await waitFor(() => expect(api.ijazahs.barred.query.mock.calls.length).toBeGreaterThan(reads));
  });

  it('says when no one is barred', async () => {
    const api = fakeApi();
    api.ijazahs.barred.query.mockResolvedValue({ items: [] });
    open(api);
    fireEvent.click(await screen.findByRole('tab', { name: ar('admin.ijazahs.tabs.barred') }));
    expect(await screen.findByText(ar('admin.ijazahs.barredEmpty.title'))).toBeTruthy();
    expect(screen.getByText(ar('admin.ijazahs.barredEmpty.text'))).toBeTruthy();
  });

  it('the audit log names `ijazah_bars.listed` in both languages', () => {
    for (const locale of ['ar', 'en'] as const) {
      const t: Translate = (key, values) => translate(locale, key, values);
      expect(actionText('ijazah_bars.listed', t as never)).toBe(
        t('admin.ijazahs.audit.barsListed'),
      );
    }
  });
});
