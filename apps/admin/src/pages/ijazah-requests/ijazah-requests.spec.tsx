// 005:T022 (B49; FR-604, FR-610; the note under T022, Q-P1 (a), Q-I1 (a), Q-X2 (a)): the ijazah
// requests through the router, in both languages. The queue opens on the requests in review
// (`status: 'pending'`), each row with its pair, subject, sending date, status and the teacher's
// standing; «All» reads every request. A request's detail at `?request=`: the certificate drawn
// from `ijazahRequests.get`'s frozen fields (the chain, the printed names, the riwaya and tariq, the
// completion date, the language) and the signature through `signatureLink`, with nothing rendered
// before approval; the teacher's standing with its reason. Approve once with a key; reject with a
// trimmed reason; each refusal in its own words. The bar and its lift on the request's student, with
// `already_barred` and `not_barred` in their own words. The sidebar's two entries.
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
import { NAV_GROUPS } from '../_layout/AdminNav';

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

const R1 = '0193a6f0-0000-7000-8000-0000000000f1';
const R2 = '0193a6f0-0000-7000-8000-0000000000f2';
const E1 = '0193a6f0-0000-7000-8000-0000000000e1';
const T1 = '0193a6f0-0000-7000-8000-0000000000c1';
const S1 = '0193a6f0-0000-7000-8000-0000000000b1';
const S2 = '0193a6f0-0000-7000-8000-0000000000b2';
const I1 = '0193a6f0-0000-7000-8000-0000000000a1';
const ADMIN = '0193a6f0-0000-7000-8000-000000000099';
const QURAN = {
  id: '0193a6f0-0000-7000-8000-0000000000d1',
  nameAr: 'القرآن الكريم',
  nameEn: 'Quran',
};
const SENT_AT = '2026-11-17T09:00:00.000Z';
const SIGNATURE = 'http://localhost:3000/files/signatures/a.png?expires=x&signature=y';

const pending = {
  requestId: R1,
  enrollmentId: E1,
  teacher: { userId: T1, displayName: 'الشيخ عمر' },
  student: { userId: S1, displayName: 'مريم أحمد' },
  subject: QURAN,
  status: 'pending',
  sentAt: SENT_AT,
  teacherStanding: { status: 'suspended' },
} as const;
const approved = {
  ...pending,
  requestId: R2,
  student: { userId: S2, displayName: 'Huda Samir' },
  status: 'approved',
  teacherStanding: { status: 'active' },
} as const;

const detail = {
  ...pending,
  completionDate: '2026-11-10',
  language: 'ar',
  chain: [['رسول الله ﷺ'], ['جبريل عليه السلام', 'ابن كثير'], ['عمر بن فاروق']],
  teacherNamePrinted: 'عمر بن فاروق المصري',
  studentName: 'مريم بنت أحمد',
  riwaya: 'حفص عن عاصم',
  tariq: 'الشاطبية',
  signatureLink: SIGNATURE,
  teacherStanding: { status: 'suspended', reason: 'تأخر متكرر' },
} as const;
const approvedDetail = {
  ...detail,
  ...approved,
  teacherStanding: { status: 'active' },
  decidedAt: '2026-11-18T09:00:00.000Z',
  ijazahId: I1,
} as const;

function fakeApi() {
  const api = {
    ijazahRequests: { list: query(), get: query(), approve: mutation(), reject: mutation() },
    ijazahs: { bar: mutation(), liftBar: mutation() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.ijazahRequests.list.query.mockImplementation(async (input) =>
    (input as { status?: string }).status === 'pending'
      ? { items: [pending] }
      : { items: [pending, approved] },
  );
  api.ijazahRequests.get.query.mockImplementation(async (input) =>
    (input as { requestId: string }).requestId === R1 ? detail : approvedDetail,
  );
  api.ijazahRequests.approve.mutate.mockResolvedValue({
    ijazahId: I1,
    certificateNumber: '7K3MQ9TD2XWB8HRN',
  });
  api.ijazahRequests.reject.mutate.mockResolvedValue(undefined);
  api.ijazahs.bar.mutate.mockResolvedValue(undefined);
  api.ijazahs.liftBar.mutate.mockResolvedValue(undefined);
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

function open(api = fakeApi(), at = '/ijazah-requests') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The request's detail beside the queue, once read. */
async function detailPanel(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', {
    name: t('admin.ijazahRequests.detail.a11y'),
  });
  await within(aside).findByText(t('admin.ijazahRequests.detail.signature'));
  return within(aside);
}

/** The queue's table, once drawn. */
async function table() {
  return within(await screen.findByRole('table'));
}

/** The open dialog. */
async function dialog() {
  return within(await screen.findByRole('dialog'));
}

describe('the ijazah requests queue (FR-604)', () => {
  it('opens on the requests in review: the pair, the subject, the date, the status and the standing, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(
          await screen.findByText(
            t('admin.ijazahRequests.pair', {
              teacher: pending.teacher.displayName,
              student: pending.student.displayName,
            }),
          ),
        ).toBeTruthy();
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.ijazahRequests.title') }),
        ).toBeTruthy();
        expect(screen.getByText(t('admin.ijazahRequests.explain'))).toBeTruthy();
        expect(
          screen
            .getByRole('tab', { name: t('admin.ijazahRequests.tabs.inReview') })
            .getAttribute('aria-selected'),
        ).toBe('true');
        expect(screen.getByText(locale === 'ar' ? QURAN.nameAr : QURAN.nameEn)).toBeTruthy();
        expect(screen.getByText(dayMonthYear(SENT_AT, locale, panelTimeZone()))).toBeTruthy();
        const rows = await table();
        expect(rows.getByText(t('admin.status.ijazahRequest.inReview'))).toBeTruthy();
        expect(rows.getByText(t('admin.ijazahRequests.standing.suspended'))).toBeTruthy();
      },
    );
  });

  it('reads the requests in review first, and every request under «All»', async () => {
    const { api } = open();
    await (await table()).findByText(ar('admin.status.ijazahRequest.inReview'));
    expect(api.ijazahRequests.list.query).toHaveBeenLastCalledWith({ status: 'pending' });
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.ijazahRequests.tabs.all') }));
    await waitFor(() => expect(api.ijazahRequests.list.query).toHaveBeenLastCalledWith({}));
    expect(await (await table()).findByText(ar('admin.status.ijazahRequest.issued'))).toBeTruthy();
  });

  it('opens a request from its row', async () => {
    const { api } = open();
    const cell = await (await table()).findByText(ar('admin.status.ijazahRequest.inReview'));
    fireEvent.click(cell.closest('tr') as HTMLElement);
    await detailPanel();
    expect(api.ijazahRequests.get.query).toHaveBeenCalledWith({ requestId: R1 });
  });
});

describe("a request's detail (FR-604, Q-P1 (a))", () => {
  it('draws the frozen certificate and the signature through its link, renders nothing, and shows the standing with its reason, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/ijazah-requests?request=${R1}`),
      async (t, locale) => {
        const panel = await detailPanel(t);
        for (const name of ['رسول الله ﷺ', 'جبريل عليه السلام', 'ابن كثير', 'عمر بن فاروق']) {
          expect(panel.getByText(name)).toBeTruthy();
        }
        expect(panel.getByText(detail.teacherNamePrinted)).toBeTruthy();
        expect(panel.getByText(detail.studentName)).toBeTruthy();
        expect(
          panel.getByText(
            t('admin.ijazahRequests.detail.subjectValue', {
              subject: locale === 'ar' ? QURAN.nameAr : QURAN.nameEn,
              riwaya: detail.riwaya,
              tariq: detail.tariq,
            }),
          ),
        ).toBeTruthy();
        expect(
          panel.getByText(dayMonthYear(detail.completionDate, locale, panelTimeZone())),
        ).toBeTruthy();
        expect(panel.getByText(t('admin.common.language.ar'))).toBeTruthy();
        const signature = panel.getByRole('img', {
          name: t('admin.ijazahRequests.detail.signature'),
        });
        expect(signature.getAttribute('src')).toBe(SIGNATURE);
        expect(panel.getByText(t('admin.ijazahRequests.standing.suspended'))).toBeTruthy();
        expect(
          panel.getByText(
            t('admin.ijazahRequests.detail.standingReason', { reason: 'تأخر متكرر' }),
          ),
        ).toBeTruthy();
        expect(openPdf).not.toHaveBeenCalled();
      },
    );
  });

  it('says the student has not given a name yet, and that an erased signature is gone', async () => {
    const api = fakeApi();
    api.ijazahRequests.get.query.mockResolvedValue({
      ...detail,
      status: 'awaiting_student_name',
      studentName: null,
      signatureLink: null,
    });
    open(api, `/ijazah-requests?request=${R1}`);
    const aside = await screen.findByRole('complementary', {
      name: ar('admin.ijazahRequests.detail.a11y'),
    });
    const panel = within(aside);
    expect(
      await panel.findByText(ar('admin.ijazahRequests.detail.noCertificateName')),
    ).toBeTruthy();
    expect(panel.getByText(ar('admin.ijazahRequests.detail.signatureErased'))).toBeTruthy();
    expect(panel.getByText(ar('admin.ijazahRequests.status.awaitingStudentName'))).toBeTruthy();
    expect(
      panel.queryByRole('button', { name: ar('admin.ijazahRequests.detail.approve') }),
    ).toBeNull();
  });

  it('an issued request offers no decision, and leads to its ijazah', async () => {
    open(fakeApi(), `/ijazah-requests?request=${R2}`);
    const panel = await detailPanel();
    expect(
      panel.queryByRole('button', { name: ar('admin.ijazahRequests.detail.approve') }),
    ).toBeNull();
    expect(
      panel.queryByRole('button', { name: ar('admin.ijazahRequests.detail.reject') }),
    ).toBeNull();
    const link = panel.getByRole('link', { name: ar('admin.ijazahRequests.detail.openIjazah') });
    expect(link.getAttribute('href')).toBe(`/ijazahs?ijazah=${I1}`);
  });
});

describe('approve and reject (FR-604)', () => {
  it('approves once with a key, then reads the queue again', async () => {
    const { api } = open(fakeApi(), `/ijazah-requests?request=${R1}`);
    const panel = await detailPanel();
    fireEvent.click(panel.getByRole('button', { name: ar('admin.ijazahRequests.detail.approve') }));
    const confirm = await dialog();
    expect(confirm.getByText(ar('admin.dialogs.confirm.issueIjazah.effects.signOff'))).toBeTruthy();
    const reads = api.ijazahRequests.list.query.mock.calls.length;
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.issueIjazah.confirm') }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.ijazahRequests.approve.mutate).toHaveBeenCalledTimes(1);
    expect(api.ijazahRequests.approve.mutate).toHaveBeenCalledWith({
      requestId: R1,
      idempotencyKey: expect.any(String),
    });
    await waitFor(() =>
      expect(api.ijazahRequests.list.query.mock.calls.length).toBeGreaterThan(reads),
    );
  });

  it('rejects with the reason trimmed; the confirm waits for a reason', async () => {
    const { api } = open(fakeApi(), `/ijazah-requests?request=${R1}`);
    const panel = await detailPanel();
    fireEvent.click(panel.getByRole('button', { name: ar('admin.ijazahRequests.detail.reject') }));
    const confirm = await dialog();
    const send = confirm.getByRole('button', {
      name: ar('admin.dialogs.confirm.rejectIjazahRequest.confirm'),
    });
    expect(send.hasAttribute('disabled')).toBe(true);
    fireEvent.change(
      confirm.getByLabelText(ar('admin.dialogs.confirm.rejectIjazahRequest.reasonLabel')),
      { target: { value: '  السند ناقص  ' } },
    );
    expect(send.hasAttribute('disabled')).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.ijazahRequests.reject.mutate).toHaveBeenCalledWith({
      requestId: R1,
      reason: 'السند ناقص',
      idempotencyKey: expect.any(String),
    });
  });

  it.each([
    ['not_pending', 'admin.ijazahRequests.refused.notPending'],
    ['student_barred', 'admin.ijazahRequests.refused.studentBarred'],
  ] as const)('says a refused approval `%s` in its own words', async (code, key) => {
    const api = fakeApi();
    api.ijazahRequests.approve.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'requestId', code }]),
    );
    open(api, `/ijazah-requests?request=${R1}`);
    const panel = await detailPanel();
    fireEvent.click(panel.getByRole('button', { name: ar('admin.ijazahRequests.detail.approve') }));
    const confirm = await dialog();
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.issueIjazah.confirm') }),
    );
    expect(await confirm.findByText(ar(key))).toBeTruthy();
  });
});

describe("the bar on the request's student (FR-610)", () => {
  it("bars the request's student with a reason, sent once with a key", async () => {
    const { api } = open(fakeApi(), `/ijazah-requests?request=${R1}`);
    const panel = await detailPanel();
    fireEvent.click(panel.getByRole('button', { name: ar('admin.common.action.barFromIjazahs') }));
    const confirm = await dialog();
    fireEvent.change(
      confirm.getByLabelText(ar('admin.dialogs.confirm.barFromIjazahs.reasonLabel')),
      { target: { value: 'تزوير' } },
    );
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.barFromIjazahs.confirm') }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.ijazahs.bar.mutate).toHaveBeenCalledWith({
      targetUserId: S1,
      reason: 'تزوير',
      idempotencyKey: expect.any(String),
    });
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
    'says a refused %s in its own words',
    async (procedure, button, dialogKey, code, words) => {
      const api = fakeApi();
      api.ijazahs[procedure].mutate.mockRejectedValue(
        refusal('CONFLICT', [{ path: 'userId', code }]),
      );
      open(api, `/ijazah-requests?request=${R1}`);
      const panel = await detailPanel();
      fireEvent.click(panel.getByRole('button', { name: ar(button) }));
      const confirm = await dialog();
      fireEvent.change(
        confirm.getByLabelText(ar(`admin.dialogs.confirm.${dialogKey}.reasonLabel`)),
        { target: { value: 'سبب' } },
      );
      fireEvent.click(
        confirm.getByRole('button', { name: ar(`admin.dialogs.confirm.${dialogKey}.confirm`) }),
      );
      expect(await confirm.findByText(ar(words))).toBeTruthy();
    },
  );
});

describe('the sidebar (Q-X2 (a))', () => {
  it('leads to the ijazah requests and to the ijazahs', () => {
    const entries = NAV_GROUPS.flatMap(({ entries: each }) => each);
    expect(entries).toContainEqual(
      expect.objectContaining({
        path: '/ijazah-requests',
        label: 'admin.nav.items.ijazahRequests',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({ path: '/ijazahs', label: 'admin.nav.items.ijazahs' }),
    );
  });
});
