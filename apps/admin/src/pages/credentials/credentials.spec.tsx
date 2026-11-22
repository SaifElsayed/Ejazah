// T072 (FR-163, FR-164): the credentials queue against its boards (`AdminCredentials`,
// `AdminCredentialCorrect`), through the router, in both languages. The four tabs, the waiting one
// counted by `home.summary`; the table and its pages, the decided tabs dated by their review; the
// transcription (holder, riwaya, tariq, the chain by generation) and the three decisions, each
// confirmed with what it truly does; the correction of a verified chain with its reason, each changed
// generation saying what it was; the document beside the panel, one link per credential, opened full
// in the viewer; a credential that moved meanwhile; the empty tabs; `?credential=` selecting one;
// «اعتماد» held until the file has loaded (T116).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLocale, setLocale, translate, type MessageKey } from '../../i18n';
import { dayMonth, dayMonthYear, timeOfDay } from '../../lib/format';
import { openPdf, type PdfFile } from '../../lib/pdf';
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

vi.mock('../../lib/pdf', () => ({
  openPdf: vi.fn(async () => ({ pageCount: 2, renderPage: vi.fn(async () => {}), close: vi.fn() })),
}));

afterEach(() => {
  setLocale('ar');
  vi.mocked(openPdf).mockClear();
});

const A = '0193a6f0-0000-7000-8000-0000000000c1';
const B = '0193a6f0-0000-7000-8000-0000000000c2';
const V = '0193a6f0-0000-7000-8000-0000000000c3';
const YASSER = '0193a6f0-0000-7000-8000-00000000000a';
const AHMED = '0193a6f0-0000-7000-8000-00000000000b';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };
const TAJWEED = {
  id: '0193a6f0-0000-7000-8000-0000000000a2',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};
const LINK = 'http://localhost:3000/files/credentials/a.pdf?expires=x&signature=y';

const rowA = {
  credentialId: A,
  teacher: { userId: YASSER, displayName: 'الشيخ ياسر حمدي' },
  subject: QURAN,
  origin: 'application',
  submittedAt: '2026-10-14T09:00:00.000Z',
  status: 'pending',
} as const;
const rowB = {
  credentialId: B,
  teacher: { userId: AHMED, displayName: 'الشيخ أحمد المصري' },
  subject: TAJWEED,
  origin: 'added',
  submittedAt: '2026-10-13T09:00:00.000Z',
  status: 'pending',
} as const;
const rowV = {
  credentialId: V,
  teacher: { userId: AHMED, displayName: 'الشيخ أحمد المصري' },
  subject: QURAN,
  origin: 'application',
  submittedAt: '2026-03-10T09:00:00.000Z',
  status: 'approved',
  reviewedAt: '2026-03-18T09:00:00.000Z',
} as const;

const detailOf = (row: Readonly<Record<string, unknown>>, more: Record<string, unknown> = {}) => ({
  ...row,
  documentId: '0193a6f0-0000-7000-8000-0000000000d1',
  // T174: the credential's history, empty unless a case gives one.
  history: [],
  ...more,
});

const verifiedDetail = detailOf(rowV, {
  holderName: 'أحمد بن عبد الله المصري',
  riwaya: 'حفص عن عاصم',
  tariq: 'الشاطبية',
  chain: [
    { position: 1, names: ['رسول الله ﷺ'] },
    { position: 2, names: ['عثمان بن عفان', 'أُبيّ بن كعب'] },
  ],
  reviewedByName: 'سارة عادل',
});

function fakeApi() {
  const api = {
    credentials: {
      list: query(),
      get: query(),
      approve: mutation(),
      reject: mutation(),
      requestDocument: mutation(),
      correct: mutation(),
    },
    home: { summary: query() },
    documents: { link: mutation() },
  };
  api.credentials.list.query.mockImplementation(async (input) => {
    const { tab } = input as { tab: string };
    if (tab === 'approved') return { rows: [rowV], total: 1, pageSize: 25 };
    if (tab === 'pending') return { rows: [rowB, rowA], total: 2, pageSize: 25 };
    return { rows: [], total: 0, pageSize: 25 };
  });
  api.credentials.get.query.mockImplementation(async (input) => {
    const { credentialId } = input as { credentialId: string };
    if (credentialId === V) return verifiedDetail;
    return detailOf(credentialId === A ? rowA : rowB);
  });
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 2, addedSubjects: 1 },
    },
    latestActions: [],
  });
  api.documents.link.mutate.mockResolvedValue({ url: LINK, expiresAt: '2026-10-25T10:10:00.000Z' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

function open(api = fakeApi(), { at = '/credentials', strict = false } = {}) {
  return { ...renderApp({ at, session: verified, api, strict }), api };
}

/** «اعتماد» offered: the transcription written and the file beside it loaded (T116). */
const approvable = (form: ReturnType<typeof within>) =>
  waitFor(() =>
    expect(
      (
        form.getByRole('button', {
          name: ar('admin.credentials.panel.approve'),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );

const t_ = (key: MessageKey, values?: Record<string, string | number>) =>
  translate(getLocale(), key, values);

/** Selects the row whose teacher is `name` and subject `subject`, and waits for its panel. */
async function select(name: string, subject: string) {
  const cells = await screen.findAllByText(subject);
  const row = cells
    .map((cell) => cell.closest('tr'))
    .find((found) => found !== null && within(found).queryByText(name) !== null);
  fireEvent.click(row as HTMLElement);
  return panel();
}

/** The transcription panel, once its credential has loaded. */
async function panel() {
  const heading = await screen.findByText(
    (_, element) => element?.tagName === 'STRONG' && element.classList.contains('text-title-3'),
  );
  return within(heading.closest('section.panel') as HTMLElement);
}

/** The open dialog whose title is `title`. */
async function dialog(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

/** Types a name into generation `n`'s field and presses Enter. */
function addName(scope: ReturnType<typeof within>, n: number, name: string) {
  const field = scope.queryByRole('textbox', {
    name: t_('admin.credentials.panel.generationNameLabel', { n }),
  });
  if (field === null) {
    const rows = scope
      .getAllByRole('listitem')
      .filter((item: HTMLElement) => item.classList.contains('chain-input'));
    fireEvent.click(
      within(rows[n - 1] as HTMLElement).getByRole('button', {
        name: t_('admin.credentials.panel.addName'),
      }),
    );
  }
  const typed = scope.getByRole('textbox', {
    name: t_('admin.credentials.panel.generationNameLabel', { n }),
  });
  type(typed, name);
  fireEvent.keyDown(typed, { key: 'Enter' });
}

describe('AdminCredentials (FR-163)', () => {
  it('draws the queue in both languages: the lede, the tabs, the table, nothing selected', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        expect(await screen.findByText(t('admin.credentials.lede', { count: 2 }))).toBeTruthy();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
          `${t('admin.credentials.tabs.inReview')}2`,
          t('admin.credentials.tabs.anotherFileNeeded'),
          t('admin.credentials.tabs.verified'),
          t('admin.credentials.tabs.rejected'),
        ]);
        for (const column of ['teacherSubject', 'source', 'submitted'] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.credentials.columns.${column}`) }),
          ).toBeTruthy();
        }
        expect(await screen.findByText(rowA.teacher.displayName)).toBeTruthy();
        expect(screen.getByText(t('admin.credentials.source.addedSubject'))).toBeTruthy();
        expect(screen.getByText(t('admin.credentials.source.atApplication'))).toBeTruthy();
        expect(screen.getByText(dayMonth(rowB.submittedAt, locale, panelTimeZone()))).toBeTruthy();
        expect(screen.getByText(t('admin.common.panel.nothingSelected'))).toBeTruthy();
      },
    );
  });

  it('reads the first page and the count once, even in strict mode', async () => {
    const { api } = open(fakeApi(), { strict: true });
    await screen.findByText(rowA.teacher.displayName);
    expect(api.credentials.list.query).toHaveBeenCalledTimes(1);
    expect(api.credentials.list.query).toHaveBeenCalledWith({ tab: 'pending', page: 1 });
    expect(api.home.summary.query).toHaveBeenCalledTimes(1);
  });

  it('opens a credential’s panel and its document beside it, one link for both views', async () => {
    const { api } = open();
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    expect(
      form.getByText(
        ar('admin.credentials.panel.title', {
          subject: QURAN.nameAr,
          teacher: rowA.teacher.displayName,
        }),
      ),
    ).toBeTruthy();
    expect(form.getByLabelText(ar('admin.credentials.panel.holderName'))).toBeTruthy();
    expect(form.getByText(ar('admin.credentials.panel.holderNameHint'))).toBeTruthy();
    expect(
      await screen.findByText(ar('admin.common.pager.pageOf', { page: 1, total: 2 })),
    ).toBeTruthy();
    expect(
      screen.getByRole('navigation', { name: ar('admin.credentials.a11y.documentPages') }),
    ).toBeTruthy();
    await waitFor(() => expect(openPdf).toHaveBeenCalledWith(LINK));
    fireEvent.click(screen.getByRole('button', { name: ar('admin.credentials.a11y.openFull') }));
    const viewer = await dialog(
      ar('admin.credentials.panel.title', {
        subject: QURAN.nameAr,
        teacher: rowA.teacher.displayName,
      }),
    );
    expect(
      viewer.getByText(
        ar('admin.dialogs.documentViewer.subtitleCredential', {
          teacher: rowA.teacher.displayName,
        }),
      ),
    ).toBeTruthy();
    expect(
      viewer.queryByRole('button', { name: ar('admin.dialogs.documentViewer.accept') }),
    ).toBeNull();
    expect(api.documents.link.mutate).toHaveBeenCalledTimes(1);
  });

  it('opens the credential `?credential=` names, and links to its application', async () => {
    open(fakeApi(), { at: `/credentials?credential=${A}` });
    const form = await panel();
    fireEvent.click(
      form.getByRole('link', { name: ar('admin.credentials.panel.applicationLink') }),
    );
    await waitFor(() => expect(currentPath()).toBe(`/applications?teacher=${YASSER}`));
  });

  it('says the empty tabs and a search that found nothing', async () => {
    const api = fakeApi();
    open(api);
    await screen.findByText(rowA.teacher.displayName);
    fireEvent.click(
      screen.getByRole('tab', { name: ar('admin.credentials.tabs.anotherFileNeeded') }),
    );
    expect(await screen.findByText(ar('admin.credentials.empty.waiting.title'))).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.credentials.tabs.rejected') }));
    expect(await screen.findByText(ar('admin.credentials.empty.rejected.title'))).toBeTruthy();
    api.credentials.list.query.mockResolvedValue({ rows: [], total: 0, pageSize: 25 });
    fireEvent.change(screen.getByPlaceholderText(ar('admin.credentials.search.placeholder')), {
      target: { value: 'زيد' },
    });
    expect(await screen.findByText(ar('admin.credentials.empty.search.title'))).toBeTruthy();
  });
});

describe('the transcription and the decisions (FR-163)', () => {
  /** Fills the form of the selected pending credential. */
  async function transcribe() {
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    type(form.getByLabelText(ar('admin.credentials.panel.holderName')), '  ياسر بن محمود حمدي ');
    type(form.getByLabelText(ar('admin.credentials.panel.riwaya')), 'حفص عن عاصم');
    fireEvent.click(
      form.getByRole('button', { name: ar('admin.credentials.panel.addGeneration') }),
    );
    addName(form, 1, 'رسول الله ﷺ');
    fireEvent.click(
      form.getByRole('button', { name: ar('admin.credentials.panel.addGeneration') }),
    );
    addName(form, 2, 'عثمان بن عفان');
    addName(form, 2, 'أُبيّ بن كعب');
    await approvable(form);
    return form;
  }

  it('holds «اعتماد» until the holder, the riwaya and a chain are written', async () => {
    open();
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    const approve = form.getByRole('button', { name: ar('admin.credentials.panel.approve') });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(
      form.getByText(
        ar('admin.credentials.panel.holderRow', { teacher: rowA.teacher.displayName }),
      ),
    ).toBeTruthy();
  });

  it('approves the transcription once confirmed, saying what follows for an application', async () => {
    const { api } = open();
    api.credentials.approve.mutate.mockResolvedValue(undefined);
    const form = await transcribe();
    expect(form.getByText(ar('admin.common.generations', { count: 2 }))).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: ar('admin.credentials.panel.approve') }));
    const confirm = await dialog(
      ar('admin.dialogs.confirm.approveCredential.title', {
        teacher: rowA.teacher.displayName,
        subject: QURAN.nameAr,
      }),
    );
    expect(
      confirm.getByText(ar('admin.dialogs.confirm.approveCredential.effects.withApplication')),
    ).toBeTruthy();
    expect(
      confirm.queryByText(
        ar('admin.dialogs.confirm.approveCredential.effects.subjectAdded', {
          teacher: rowA.teacher.displayName,
        }),
      ),
    ).toBeNull();
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.approveCredential.confirm') }),
    );
    await waitFor(() =>
      expect(api.credentials.approve.mutate).toHaveBeenCalledWith({
        credentialId: A,
        holderName: 'ياسر بن محمود حمدي',
        riwaya: 'حفص عن عاصم',
        chain: [{ names: ['رسول الله ﷺ'] }, { names: ['عثمان بن عفان', 'أُبيّ بن كعب'] }],
      }),
    );
  });

  it('says an added subject joins the teacher’s subjects at once', async () => {
    open();
    const form = await select(rowB.teacher.displayName, TAJWEED.nameAr);
    type(form.getByLabelText(ar('admin.credentials.panel.holderName')), 'أحمد');
    type(form.getByLabelText(ar('admin.credentials.panel.riwaya')), 'حفص');
    fireEvent.click(
      form.getByRole('button', { name: ar('admin.credentials.panel.addGeneration') }),
    );
    addName(form, 1, 'رسول الله ﷺ');
    await approvable(form);
    fireEvent.click(form.getByRole('button', { name: ar('admin.credentials.panel.approve') }));
    const confirm = await dialog(
      ar('admin.dialogs.confirm.approveCredential.title', {
        teacher: rowB.teacher.displayName,
        subject: TAJWEED.nameAr,
      }),
    );
    expect(
      confirm.getByText(
        ar('admin.dialogs.confirm.approveCredential.effects.subjectAdded', {
          teacher: rowB.teacher.displayName,
        }),
      ),
    ).toBeTruthy();
  });

  it('asks for another document with what is needed, once confirmed', async () => {
    const { api } = open();
    api.credentials.requestDocument.mutate.mockResolvedValue(undefined);
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    const request = form.getByRole('button', {
      name: ar('admin.credentials.panel.requestAnother'),
    });
    expect((request as HTMLButtonElement).disabled).toBe(true);
    type(
      form.getByLabelText(ar('admin.credentials.panel.requestLabel')),
      'الصفحة الثانية غير مقروءة',
    );
    fireEvent.click(request);
    const confirm = await dialog(
      ar('admin.dialogs.confirm.requestCredentialDocument.title', {
        teacher: rowA.teacher.displayName,
      }),
    );
    expect(
      confirm.getByText(ar('admin.dialogs.confirm.requestCredentialDocument.effects.inApp')),
    ).toBeTruthy();
    fireEvent.click(
      confirm.getByRole('button', {
        name: ar('admin.dialogs.confirm.requestCredentialDocument.confirm'),
      }),
    );
    await waitFor(() =>
      expect(api.credentials.requestDocument.mutate).toHaveBeenCalledWith({
        credentialId: A,
        reason: 'الصفحة الثانية غير مقروءة',
      }),
    );
  });

  it('rejects with the reason the teacher reads, in the confirmation', async () => {
    const { api } = open();
    api.credentials.reject.mutate.mockResolvedValue(undefined);
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    fireEvent.click(form.getByRole('button', { name: ar('admin.credentials.panel.reject') }));
    const confirm = await dialog(
      ar('admin.dialogs.confirm.rejectCredential.title', {
        teacher: rowA.teacher.displayName,
        subject: QURAN.nameAr,
      }),
    );
    const go = confirm.getByRole('button', {
      name: ar('admin.dialogs.confirm.rejectCredential.confirm'),
    });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    type(
      confirm.getByLabelText(ar('admin.dialogs.confirm.rejectCredential.reasonLabel')),
      'ليست إجازة',
    );
    fireEvent.click(go);
    await waitFor(() =>
      expect(api.credentials.reject.mutate).toHaveBeenCalledWith({
        credentialId: A,
        reason: 'ليست إجازة',
      }),
    );
  });

  it('says a credential that moved meanwhile, and reads it again', async () => {
    const { api } = open();
    api.credentials.reject.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'credentialId', code: 'approved' }]),
    );
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    fireEvent.click(form.getByRole('button', { name: ar('admin.credentials.panel.reject') }));
    const confirm = await dialog(
      ar('admin.dialogs.confirm.rejectCredential.title', {
        teacher: rowA.teacher.displayName,
        subject: QURAN.nameAr,
      }),
    );
    type(confirm.getByLabelText(ar('admin.dialogs.confirm.rejectCredential.reasonLabel')), 'سبب');
    // Another administrator approved it meanwhile: the read again answers its new status, which
    // draws the panel anew; the sentence stays (B14c review, round 1, finding 1).
    api.credentials.get.query.mockResolvedValue(verifiedDetail);
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.rejectCredential.confirm') }),
    );
    await waitFor(() => expect(api.credentials.get.query).toHaveBeenCalledTimes(2));
    await screen.findByText(ar('admin.credentials.panel.saveCorrection'));
    expect(screen.getByText(ar('admin.credentials.panel.conflict'))).toBeTruthy();
    // The confirmation closed with the redrawn panel (B14c review, round 2).
    expect(
      screen.queryByRole('heading', {
        level: 2,
        name: ar('admin.dialogs.confirm.rejectCredential.title', {
          teacher: rowA.teacher.displayName,
          subject: QURAN.nameAr,
        }),
      }),
    ).toBeNull();
    // The next decision begins without the last one's sentence (B14c review, round 2).
    const redrawn = await panel();
    type(redrawn.getByLabelText(ar('admin.credentials.panel.correctReason')), 'سبب');
    fireEvent.click(
      redrawn.getByRole('button', {
        name: ar('admin.credentials.a11y.removeName', { name: 'أُبيّ بن كعب' }),
      }),
    );
    fireEvent.click(
      redrawn.getByRole('button', { name: ar('admin.credentials.panel.saveCorrection') }),
    );
    await dialog(
      ar('admin.dialogs.confirm.saveCredentialCorrection.title', {
        teacher: rowV.teacher.displayName,
      }),
    );
    expect(screen.queryByText(ar('admin.credentials.panel.conflict'))).toBeNull();
  });

  it('says the teacher already holds the subject', async () => {
    const { api } = open();
    api.credentials.approve.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'credentialId', code: 'subject_approved' }]),
    );
    await transcribe();
    fireEvent.click(screen.getByRole('button', { name: ar('admin.credentials.panel.approve') }));
    const confirm = await dialog(
      ar('admin.dialogs.confirm.approveCredential.title', {
        teacher: rowA.teacher.displayName,
        subject: QURAN.nameAr,
      }),
    );
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.approveCredential.confirm') }),
    );
    expect(await confirm.findByText(ar('admin.credentials.panel.subjectApproved'))).toBeTruthy();
  });
});

describe('«اعتماد» once the file has loaded (T116)', () => {
  const PDF: PdfFile = { pageCount: 2, renderPage: vi.fn(async () => {}), close: vi.fn() };

  /** Writes a complete transcription in the language drawn. */
  function fill(form: ReturnType<typeof within>, t: Translate) {
    type(form.getByLabelText(t('admin.credentials.panel.holderName')), 'ياسر بن محمود حمدي');
    type(form.getByLabelText(t('admin.credentials.panel.riwaya')), 'حفص عن عاصم');
    fireEvent.click(form.getByRole('button', { name: t('admin.credentials.panel.addGeneration') }));
    addName(form, 1, 'رسول الله ﷺ');
  }

  const approveButton = (form: ReturnType<typeof within>, t: Translate) =>
    form.getByRole('button', { name: t('admin.credentials.panel.approve') }) as HTMLButtonElement;

  it('holds «اعتماد» on a written transcription until its PDF has loaded, in both languages', async () => {
    let load: (() => void) | undefined;
    await inBothLocales(
      () => {
        load = undefined;
        vi.mocked(openPdf).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              load = () => resolve(PDF);
            }),
        );
        return open();
      },
      async (t, locale) => {
        const form = await select(
          rowA.teacher.displayName,
          locale === 'ar' ? QURAN.nameAr : QURAN.nameEn,
        );
        fill(form, t);
        await waitFor(() => expect(load).toBeDefined());
        expect(approveButton(form, t).disabled).toBe(true);
        load?.();
        await waitFor(() => expect(approveButton(form, t).disabled).toBe(false));
      },
    );
  });

  it('keeps «اعتماد» held when the file cannot be read', async () => {
    vi.mocked(openPdf).mockRejectedValueOnce(new Error('unreadable'));
    open();
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    fill(form, ar);
    expect(await screen.findByText(ar('admin.dialogs.documentViewer.loadError'))).toBeTruthy();
    expect(approveButton(form, ar).disabled).toBe(true);
  });
});

describe('the correction of a verified chain (FR-164)', () => {
  async function openVerified() {
    const api = fakeApi();
    open(api);
    await screen.findByText(rowA.teacher.displayName);
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.credentials.tabs.verified') }));
    const form = await select(rowV.teacher.displayName, QURAN.nameAr);
    return { api, form };
  }

  it('lists the verified by their day, and opens the transcription as it stands, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        await screen.findByText(rowA.teacher.displayName);
        fireEvent.click(screen.getByRole('tab', { name: t('admin.credentials.tabs.verified') }));
        expect(
          await screen.findByRole('columnheader', {
            name: t('admin.credentials.columns.verifiedOn'),
          }),
        ).toBeTruthy();
        expect(screen.getByText(t('admin.credentials.correctLede'))).toBeTruthy();
        expect(
          await screen.findByText(dayMonth(rowV.reviewedAt, locale, panelTimeZone())),
        ).toBeTruthy();
        const form = await select(
          rowV.teacher.displayName,
          locale === 'ar' ? QURAN.nameAr : QURAN.nameEn,
        );
        expect(
          (form.getByLabelText(t('admin.credentials.panel.holderName')) as HTMLInputElement).value,
        ).toBe('أحمد بن عبد الله المصري');
        expect(form.getByText('أُبيّ بن كعب')).toBeTruthy();
        expect(
          form.getByText(
            t('admin.credentials.panel.metaVerified', {
              date: dayMonthYear(rowV.reviewedAt, locale, panelTimeZone()),
              admin: 'سارة عادل',
            }).replace(/\s·\s$/, ''),
          ),
        ).toBeTruthy();
        expect(form.getByText(t('admin.credentials.panel.correctEffect1'))).toBeTruthy();
      },
    );
  });

  it('saves a correction with its reason, sending only what changed, each changed generation saying what it was', async () => {
    const { api, form } = await openVerified();
    api.credentials.correct.mutate.mockResolvedValue(undefined);
    const save = form.getByRole('button', { name: ar('admin.credentials.panel.saveCorrection') });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      form.getByRole('button', {
        name: ar('admin.credentials.a11y.removeName', { name: 'أُبيّ بن كعب' }),
      }),
    );
    addName(form, 2, 'زيد بن ثابت');
    expect(
      form.getByText(
        ar('admin.credentials.panel.generationWas', { n: 2, name: 'عثمان بن عفان، أُبيّ بن كعب' }),
      ),
    ).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(true);
    type(form.getByLabelText(ar('admin.credentials.panel.correctReason')), 'سقط اسم عند النسخ');
    fireEvent.click(save);
    const confirm = await dialog(
      ar('admin.dialogs.confirm.saveCredentialCorrection.title', {
        teacher: rowV.teacher.displayName,
      }),
    );
    expect(
      confirm.getByText(ar('admin.dialogs.confirm.saveCredentialCorrection.effects.logged')),
    ).toBeTruthy();
    fireEvent.click(
      confirm.getByRole('button', {
        name: ar('admin.dialogs.confirm.saveCredentialCorrection.confirm'),
      }),
    );
    await waitFor(() =>
      expect(api.credentials.correct.mutate).toHaveBeenCalledWith({
        credentialId: V,
        chain: [{ names: ['رسول الله ﷺ'] }, { names: ['عثمان بن عفان', 'زيد بن ثابت'] }],
        reason: 'سقط اسم عند النسخ',
      }),
    );
    // The next correction needs its own reason (B14c review, round 1, Minor).
    await waitFor(() =>
      expect(
        (form.getByLabelText(ar('admin.credentials.panel.correctReason')) as HTMLTextAreaElement)
          .value,
      ).toBe(''),
    );
  });
});

// T174 (SRS DEC-97; admin-surface.md:70): the credential's history under its panel, oldest first:
// the action in words, the note or a correction's reason, the name and the chain before and after a
// correction, who decided and when.
describe('the decision history (T174)', () => {
  const FIRST = { holderName: 'أحمد المصري', riwaya: 'حفص عن عاصم', tariq: 'الشاطبية' };
  const HISTORY = [
    {
      action: 'request_document',
      note: 'الصفحة الثانية غير مقروءة',
      adminName: 'سارة عادل',
      at: '2026-03-12T09:00:00.000Z',
    },
    {
      action: 'approve',
      note: 'السند مقروء كاملًا',
      after: { ...FIRST, chain: [{ position: 1, names: ['رسول الله ﷺ'] }] },
      adminName: 'سارة عادل',
      at: '2026-03-18T09:00:00.000Z',
    },
    {
      action: 'correct',
      reason: 'الاسم كما في الملف',
      before: { ...FIRST, chain: [{ position: 1, names: ['رسول الله ﷺ'] }] },
      after: {
        ...FIRST,
        holderName: 'أحمد بن عبد الله المصري',
        chain: [
          { position: 1, names: ['رسول الله ﷺ'] },
          { position: 2, names: ['عثمان بن عفان', 'أُبيّ بن كعب'] },
        ],
      },
      adminName: 'هالة سعيد',
      at: '2026-04-02T09:00:00.000Z',
    },
  ] as const;

  function withHistory(history: readonly unknown[]) {
    const api = fakeApi();
    api.credentials.get.query.mockImplementation(async () => ({ ...verifiedDetail, history }));
    return api;
  }

  async function historySection(t: Translate, locale: 'ar' | 'en') {
    await screen.findByText(rowA.teacher.displayName);
    fireEvent.click(screen.getByRole('tab', { name: t('admin.credentials.tabs.verified') }));
    await select(rowV.teacher.displayName, locale === 'ar' ? QURAN.nameAr : QURAN.nameEn);
    const heading = await screen.findByRole('heading', {
      level: 2,
      name: t('admin.credentials.history.title'),
    });
    return within(heading.closest('section') as HTMLElement);
  }

  it('lists each decision oldest first, in words, with its note, who and when, in both languages', async () => {
    await inBothLocales(
      () => open(withHistory(HISTORY)),
      async (t, locale) => {
        const section = await historySection(t, locale);
        const items = section.getAllByRole('listitem');
        expect(items.map((item) => item.querySelector('strong')?.textContent)).toEqual([
          t('admin.credentials.history.action.requestDocument'),
          t('admin.credentials.history.action.approve'),
          t('admin.credentials.history.action.correct'),
        ]);
        const [requested, approved, corrected] = items.map((item) => within(item));
        expect(requested?.getByText('الصفحة الثانية غير مقروءة')).toBeTruthy();
        expect(approved?.getByText('السند مقروء كاملًا')).toBeTruthy();
        expect(corrected?.getByText('الاسم كما في الملف')).toBeTruthy();
        const zone = panelTimeZone();
        expect(
          approved?.getByText(
            t('admin.credentials.history.meta', {
              admin: 'سارة عادل',
              date: dayMonthYear('2026-03-18T09:00:00.000Z', locale, zone),
              time: timeOfDay('2026-03-18T09:00:00.000Z', locale, zone),
            }),
          ),
        ).toBeTruthy();
        expect(
          corrected?.getByText(
            t('admin.credentials.history.meta', {
              admin: 'هالة سعيد',
              date: dayMonthYear('2026-04-02T09:00:00.000Z', locale, zone),
              time: timeOfDay('2026-04-02T09:00:00.000Z', locale, zone),
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('shows a correction’s name and chain before and after, and only on a correction', async () => {
    await inBothLocales(
      () => open(withHistory(HISTORY)),
      async (t, locale) => {
        const section = await historySection(t, locale);
        const [, approved, corrected] = section
          .getAllByRole('listitem')
          .map((item) => within(item));
        const names = locale === 'ar' ? '، ' : ', ';
        expect(
          corrected?.getByText(t('admin.credentials.history.nameBefore', { name: 'أحمد المصري' })),
        ).toBeTruthy();
        expect(
          corrected?.getByText(
            t('admin.credentials.history.nameAfter', { name: 'أحمد بن عبد الله المصري' }),
          ),
        ).toBeTruthy();
        expect(
          corrected?.getByText(
            t('admin.credentials.history.chainBefore', { chain: 'رسول الله ﷺ' }),
          ),
        ).toBeTruthy();
        expect(
          corrected?.getByText(
            t('admin.credentials.history.chainAfter', {
              chain: `رسول الله ﷺ · عثمان بن عفان${names}أُبيّ بن كعب`,
            }),
          ),
        ).toBeTruthy();
        expect(
          approved?.queryByText(t('admin.credentials.history.nameBefore', { name: 'أحمد المصري' })),
        ).toBeNull();
      },
    );
  });

  it('says no decision is recorded yet for a credential decided before the history', async () => {
    await inBothLocales(
      () => open(withHistory([])),
      async (t, locale) => {
        const section = await historySection(t, locale);
        expect(section.getByText(t('admin.credentials.history.empty'))).toBeTruthy();
        expect(section.queryAllByRole('listitem')).toEqual([]);
      },
    );
  });
});

describe('a long chain (the owner’s decision, B14c)', () => {
  it('shows its first five and last two generations, folds the middle, and opens it', async () => {
    const api = fakeApi();
    const named = (n: number) => `الجيل ${n}`;
    const long = Array.from({ length: 12 }, (_, index) => ({
      position: index + 1,
      names: [named(index + 1)],
    }));
    api.credentials.get.query.mockResolvedValue({ ...verifiedDetail, chain: long });
    open(api);
    await screen.findByText(rowA.teacher.displayName);
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.credentials.tabs.verified') }));
    const form = await select(rowV.teacher.displayName, QURAN.nameAr);
    for (const shown of [1, 2, 3, 4, 5, 11, 12]) expect(form.getByText(named(shown))).toBeTruthy();
    for (const folded of [6, 7, 8, 9, 10]) expect(form.queryByText(named(folded))).toBeNull();
    fireEvent.click(
      form.getByRole('button', {
        name: ar('admin.credentials.panel.chainEllipsis', { from: 6, to: 10 }),
      }),
    );
    for (let n = 1; n <= 12; n += 1) expect(form.getByText(named(n))).toBeTruthy();
  });
});

describe('a verified credential with no reviewer’s name (B14c review, round 2)', () => {
  it('says the day alone, with no separator left over', async () => {
    const api = fakeApi();
    api.credentials.get.query.mockResolvedValue({ ...verifiedDetail, reviewedByName: undefined });
    open(api);
    await screen.findByText(rowA.teacher.displayName);
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.credentials.tabs.verified') }));
    const form = await select(rowV.teacher.displayName, QURAN.nameAr);
    const day = dayMonthYear(rowV.reviewedAt, 'ar', panelTimeZone());
    const meta = form.getByText(
      (_, element) =>
        element?.classList.contains('text-caption') === true &&
        (element.textContent ?? '').includes(day),
    );
    expect(meta.textContent?.trim().endsWith('·')).toBe(false);
  });
});

describe('the decided and waiting credentials', () => {
  it('shows what the teacher was told on a credential waiting for a file, and only «رفض»', async () => {
    const api = fakeApi();
    api.credentials.list.query.mockResolvedValue({
      rows: [{ ...rowA, status: 'needs_document' }],
      total: 1,
      pageSize: 25,
    });
    api.credentials.get.query.mockResolvedValue(
      detailOf({ ...rowA, status: 'needs_document' }, { reviewReason: 'الصفحة الثانية ناقصة' }),
    );
    open(api);
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    expect(form.getByText(ar('admin.credentials.panel.reviewReason'))).toBeTruthy();
    expect(form.getByText('الصفحة الثانية ناقصة')).toBeTruthy();
    expect(form.getByRole('button', { name: ar('admin.credentials.panel.reject') })).toBeTruthy();
    expect(form.queryByRole('button', { name: ar('admin.credentials.panel.approve') })).toBeNull();
    expect(form.queryByLabelText(ar('admin.credentials.panel.holderName'))).toBeNull();
  });
});

describe('T058: RATE_LIMITED on the credentials', () => {
  const limited = (seconds?: string) =>
    refusal(
      'RATE_LIMITED',
      seconds === undefined ? [] : [{ path: 'retryAfterSeconds', code: seconds }],
    );

  it('the queue says when to try again', async () => {
    const api = fakeApi();
    api.credentials.list.query.mockRejectedValue(limited('61'));
    open(api);
    expect(await screen.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('a credential’s panel says to wait a little when no time is given', async () => {
    const api = fakeApi();
    api.credentials.get.query.mockRejectedValue(limited());
    open(api);
    const cells = await screen.findAllByText(QURAN.nameAr);
    fireEvent.click(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
    expect(await screen.findByText(ar('admin.common.rateLimited'))).toBeTruthy();
    expect(screen.queryByText(ar('admin.common.loadError.text'))).toBeNull();
  });

  it('a decision’s confirmation says when to try again', async () => {
    const { api } = open();
    api.credentials.approve.mutate.mockRejectedValue(limited('120'));
    const form = await select(rowA.teacher.displayName, QURAN.nameAr);
    type(form.getByLabelText(ar('admin.credentials.panel.holderName')), 'ياسر بن محمود حمدي');
    type(form.getByLabelText(ar('admin.credentials.panel.riwaya')), 'حفص عن عاصم');
    fireEvent.click(
      form.getByRole('button', { name: ar('admin.credentials.panel.addGeneration') }),
    );
    addName(form, 1, 'رسول الله ﷺ');
    await approvable(form);
    fireEvent.click(screen.getByRole('button', { name: ar('admin.credentials.panel.approve') }));
    const confirm = await dialog(
      ar('admin.dialogs.confirm.approveCredential.title', {
        teacher: rowA.teacher.displayName,
        subject: QURAN.nameAr,
      }),
    );
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.approveCredential.confirm') }),
    );
    expect(await confirm.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(confirm.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });
});
