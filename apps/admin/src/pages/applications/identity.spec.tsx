// T071, second part (FR-160, FR-166): the application's documents open in the viewer, and the identity
// request lives in the detail. A thumbnail opens `AdminDocumentViewer` over a signed link: view only
// in the application's context; in the person's context, for a document an identity request brought,
// with «قبول» and «طلب وثيقة أخرى», each confirmed. «طلب إثبات هوية» is offered on an active account
// with no request open, and asks a reason. The PDF reader is a stand-in: jsdom draws no canvas.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLocale, setLocale, translate, type MessageKey } from '../../i18n';
import { dayMonthYear } from '../../lib/format';
import { openPdf } from '../../lib/pdf';
import { panelTimeZone } from '../../lib/zone';
import { inBothLocales, mutation, query, refusal, renderApp } from '../../test/app-harness';

vi.mock('../../lib/pdf', () => ({
  openPdf: vi.fn(async () => ({ pageCount: 2, renderPage: vi.fn(async () => {}), close: vi.fn() })),
}));

afterEach(() => {
  setLocale('ar');
  vi.mocked(openPdf).mockClear();
});

const A = '0193a6f0-0000-7000-8000-00000000000a';
const ID_DOCUMENT = '0193a6f0-0000-7000-8000-0000000000d0';
const NEW_DOCUMENT = '0193a6f0-0000-7000-8000-0000000000d9';
const CREDENTIAL_DOCUMENT = '0193a6f0-0000-7000-8000-0000000000e0';
const REQUEST = '0193a6f0-0000-7000-8000-0000000000f1';
const LINK = 'http://localhost:3000/files/documents/a.pdf?expires=x&signature=y';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };

const row = {
  teacherUserId: A,
  displayName: 'الشيخ ياسر حمدي',
  email: 'yasser@example.com',
  gender: 'male',
  isMinor: false,
  subjects: [QURAN],
  submittedAt: '2026-10-14T09:00:00.000Z',
  status: 'in_review',
} as const;

const request = {
  requestId: REQUEST,
  reason: 'الصورة لا تطابق صاحب الحساب',
  requestedAt: '2026-10-16T09:00:00.000Z',
};

function detailOf(more: Record<string, unknown> = {}) {
  return {
    ...row,
    qualificationSummary: 'إجازة في حفظ القرآن بالسند المتصل.',
    timezoneCity: 'Africa/Cairo',
    accountStatus: 'active',
    identityDocument: { documentId: ID_DOCUMENT, type: 'national_id', uploadedAt: row.submittedAt },
    credentials: [
      {
        credentialId: '0193a6f0-0000-7000-8000-0000000000c0',
        subject: QURAN,
        status: 'pending',
        documentId: CREDENTIAL_DOCUMENT,
      },
    ],
    call: {},
    ...more,
  };
}

function fakeApi(detail = detailOf()) {
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
    documents: { link: mutation(), accept: mutation(), requestAnother: mutation() },
    users: { requireIdentity: mutation() },
  };
  api.applications.list.query.mockResolvedValue({ rows: [row], total: 1, pageSize: 25 });
  api.applications.get.query.mockResolvedValue(detail);
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 1, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.documents.link.mutate.mockResolvedValue({
    url: LINK,
    expiresAt: '2026-10-25T10:10:00.000Z',
  });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

function open(api = fakeApi()) {
  return { ...renderApp({ at: '/applications', session: verified, api }), api };
}

/** Selects the applicant's row and waits for the detail. */
async function detail(name: string = row.displayName) {
  const cells = await screen.findAllByText(name);
  fireEvent.click(cells.map((cell) => cell.closest('tr')).find(Boolean) as HTMLElement);
  const region = within(
    await screen.findByRole('complementary', {
      name: translate(getLocale(), 'admin.applications.detail.a11y'),
    }),
  );
  await region.findByText('إجازة في حفظ القرآن بالسند المتصل.');
  return region;
}

/** The open dialog whose title is `title`. */
async function dialog(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

describe('the document viewer (FR-160)', () => {
  it('opens the identity document of the application, view only, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const panel = await detail();
        fireEvent.click(
          panel.getByRole('button', { name: t('admin.common.documentType.nationalId') }),
        );
        const viewer = await dialog(t('admin.common.documentType.nationalId'));
        expect(
          viewer.getByText(
            t('admin.dialogs.documentViewer.subtitleApplication', { name: row.displayName }),
          ),
        ).toBeTruthy();
        expect(
          viewer.getByText(dayMonthYear(row.submittedAt, locale, panelTimeZone())),
        ).toBeTruthy();
        expect(
          await viewer.findByText(
            t('admin.dialogs.documentViewer.fileCaption', {
              file: t('admin.common.documentType.nationalId'),
              page: 1,
              total: 2,
            }),
          ),
        ).toBeTruthy();
        expect(
          viewer.getByRole('navigation', { name: t('admin.dialogs.documentViewer.a11y.pages') }),
        ).toBeTruthy();
        expect(
          viewer.getByText(t('admin.dialogs.documentViewer.pagesValue', { count: 2 })),
        ).toBeTruthy();
        expect(viewer.getByText(t('admin.dialogs.documentViewer.footerViewOnly'))).toBeTruthy();
        expect(
          viewer.queryByRole('button', { name: t('admin.dialogs.documentViewer.accept') }),
        ).toBeNull();
        expect(
          viewer.queryByRole('button', { name: t('admin.dialogs.documentViewer.requestAnother') }),
        ).toBeNull();
      },
    );
  });

  it('reads one link per opening, and the reader opens it', async () => {
    const { api } = open();
    fireEvent.click(
      (await detail()).getByRole('button', { name: ar('admin.common.documentType.nationalId') }),
    );
    await dialog(ar('admin.common.documentType.nationalId'));
    await waitFor(() => expect(openPdf).toHaveBeenCalledWith(LINK));
    expect(api.documents.link.mutate).toHaveBeenCalledTimes(1);
    expect(api.documents.link.mutate).toHaveBeenCalledWith({ documentId: ID_DOCUMENT });
  });

  it('opens a credential’s file, view only, and closes', async () => {
    const { api } = open();
    const file = ar('admin.applications.detail.credentialFile', { subject: QURAN.nameAr });
    fireEvent.click((await detail()).getByRole('button', { name: (name) => name.includes(file) }));
    const viewer = await dialog(file);
    await waitFor(() =>
      expect(api.documents.link.mutate).toHaveBeenCalledWith({ documentId: CREDENTIAL_DOCUMENT }),
    );
    fireEvent.click(viewer.getByRole('button', { name: ar('admin.dialogs.documentViewer.close') }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: file })).toBeNull());
  });

  it('stays on the credential it opened when a read reorders them, and closes when one is gone', async () => {
    const tajweed = {
      id: '0193a6f0-0000-7000-8000-0000000000a2',
      nameAr: 'التجويد',
      nameEn: 'Tajweed',
    };
    const other = {
      credentialId: '0193a6f0-0000-7000-8000-0000000000c1',
      subject: tajweed,
      status: 'pending',
      documentId: '0193a6f0-0000-7000-8000-0000000000e1',
    };
    const first = detailOf();
    const api = fakeApi(first);
    const { queries } = renderApp({ at: '/applications', session: verified, api });
    const file = ar('admin.applications.detail.credentialFile', { subject: QURAN.nameAr });
    fireEvent.click((await detail()).getByRole('button', { name: (name) => name.includes(file) }));
    await dialog(file);

    api.applications.get.query.mockResolvedValue({
      ...first,
      credentials: [other, ...first.credentials],
    });
    await queries.invalidateQueries({ queryKey: ['applications'] });
    await waitFor(() => expect(api.applications.get.query).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('heading', { level: 2, name: file })).toBeTruthy();
    expect(api.documents.link.mutate).toHaveBeenCalledTimes(1);

    api.applications.get.query.mockResolvedValue({ ...first, credentials: [other] });
    await queries.invalidateQueries({ queryKey: ['applications'] });
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: file })).toBeNull());
    expect(api.documents.link.mutate).toHaveBeenCalledTimes(1);
  });

  it('says a link that could not be read, and tries again', async () => {
    const api = fakeApi();
    api.documents.link.mutate.mockRejectedValueOnce(refusal('INTERNAL'));
    open(api);
    fireEvent.click(
      (await detail()).getByRole('button', { name: ar('admin.common.documentType.nationalId') }),
    );
    const viewer = await dialog(ar('admin.common.documentType.nationalId'));
    expect(await viewer.findByText(ar('admin.dialogs.documentViewer.loadError'))).toBeTruthy();
    fireEvent.click(viewer.getByRole('button', { name: ar('admin.common.action.retry') }));
    await waitFor(() => expect(openPdf).toHaveBeenCalledWith(LINK));
  });
});

describe('the identity request in the detail (FR-166)', () => {
  it('shows an open request and its reason, waiting for the document', async () => {
    open(fakeApi(detailOf({ accountStatus: 'verification_required', identityRequest: request })));
    const panel = await detail();
    expect(panel.getByText(ar('admin.applications.detail.identityRequest.title'))).toBeTruthy();
    expect(panel.getByText(request.reason)).toBeTruthy();
    expect(
      panel.getByText(
        ar('admin.applications.detail.identityRequest.requested', {
          date: dayMonthYear(request.requestedAt, 'ar', panelTimeZone()),
        }),
      ),
    ).toBeTruthy();
    expect(panel.getByText(ar('admin.applications.detail.identityRequest.waiting'))).toBeTruthy();
    expect(panel.queryByRole('button', { name: ar('admin.common.action.requireId') })).toBeNull();
  });

  it('opens the document the request brought with its two decisions, in both languages', async () => {
    const withDocument = detailOf({
      accountStatus: 'verification_required',
      identityRequest: {
        ...request,
        document: {
          documentId: NEW_DOCUMENT,
          type: 'passport',
          submittedAt: '2026-10-17T09:00:00.000Z',
        },
      },
    });
    await inBothLocales(
      () => open(fakeApi(withDocument)),
      async (t, locale) => {
        const panel = await detail();
        const block = within(
          panel
            .getByText(t('admin.applications.detail.identityRequest.title'))
            .closest('section') as HTMLElement,
        );
        fireEvent.click(
          block.getByRole('button', { name: t('admin.common.documentType.passport') }),
        );
        const viewer = await dialog(t('admin.common.documentType.passport'));
        expect(
          viewer.getByText(
            t('admin.dialogs.documentViewer.subtitle', {
              name: row.displayName,
              date: dayMonthYear('2026-10-17T09:00:00.000Z', locale, panelTimeZone()),
            }),
          ),
        ).toBeTruthy();
        expect(viewer.getByText(request.reason)).toBeTruthy();
        expect(viewer.getByText(t('admin.dialogs.documentViewer.acceptEffect'))).toBeTruthy();
        expect(viewer.getByText(t('admin.dialogs.documentViewer.footer'))).toBeTruthy();
        expect(
          viewer.getByRole('button', { name: t('admin.dialogs.documentViewer.accept') }),
        ).toBeTruthy();
        expect(
          (
            viewer.getByRole('button', {
              name: t('admin.dialogs.documentViewer.requestAnother'),
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
      },
    );
  });

  async function openRequestDocument() {
    const api = fakeApi(
      detailOf({
        accountStatus: 'verification_required',
        identityRequest: {
          ...request,
          document: {
            documentId: NEW_DOCUMENT,
            type: 'national_id',
            submittedAt: '2026-10-17T09:00:00.000Z',
          },
        },
      }),
    );
    open(api);
    const panel = await detail();
    const block = within(
      panel
        .getByText(ar('admin.applications.detail.identityRequest.title'))
        .closest('section') as HTMLElement,
    );
    fireEvent.click(
      block.getByRole('button', { name: ar('admin.common.documentType.nationalId') }),
    );
    const viewer = await dialog(ar('admin.common.documentType.nationalId'));
    await waitFor(() =>
      expect(api.documents.link.mutate).toHaveBeenCalledWith({ documentId: NEW_DOCUMENT }),
    );
    return { api, viewer };
  }

  it('accepts the document once confirmed, with the note when one is written', async () => {
    const { api, viewer } = await openRequestDocument();
    api.documents.accept.mutate.mockResolvedValue(undefined);
    // The read after the decision no longer has the request: the viewer must not fall to
    // another document and read its link (B14b-2 review, round 1).
    api.applications.get.query.mockResolvedValue(detailOf());
    fireEvent.change(viewer.getByLabelText(ar('admin.dialogs.documentViewer.noteLabel')), {
      target: { value: '  مطابقة  ' },
    });
    fireEvent.click(
      viewer.getByRole('button', { name: ar('admin.dialogs.documentViewer.accept') }),
    );
    const confirm = await dialog(
      ar('admin.dialogs.confirm.acceptDocument.title', { name: row.displayName }),
    );
    expect(
      confirm.getByText(ar('admin.dialogs.confirm.acceptDocument.effects.active')),
    ).toBeTruthy();
    expect(api.documents.accept.mutate).not.toHaveBeenCalled();
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.acceptDocument.confirm') }),
    );
    await waitFor(() =>
      expect(api.documents.accept.mutate).toHaveBeenCalledWith({
        requestId: REQUEST,
        note: 'مطابقة',
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', {
          level: 2,
          name: ar('admin.common.documentType.nationalId'),
        }),
      ).toBeNull(),
    );
    expect(api.applications.get.query).toHaveBeenCalledTimes(2);
    expect(api.documents.link.mutate).toHaveBeenCalledTimes(1);
  });

  it('asks for another document with the note the person reads, once confirmed', async () => {
    const { api, viewer } = await openRequestDocument();
    api.documents.requestAnother.mutate.mockResolvedValue(undefined);
    fireEvent.change(viewer.getByLabelText(ar('admin.dialogs.documentViewer.noteLabel')), {
      target: { value: 'الوجه الخلفي غير واضح' },
    });
    fireEvent.click(
      viewer.getByRole('button', { name: ar('admin.dialogs.documentViewer.requestAnother') }),
    );
    const confirm = await dialog(
      ar('admin.dialogs.confirm.requestAnotherDocument.title', { name: row.displayName }),
    );
    expect(
      confirm.getByText(ar('admin.dialogs.confirm.requestAnotherDocument.effects.pending')),
    ).toBeTruthy();
    fireEvent.click(
      confirm.getByRole('button', {
        name: ar('admin.dialogs.confirm.requestAnotherDocument.confirm'),
      }),
    );
    await waitFor(() =>
      expect(api.documents.requestAnother.mutate).toHaveBeenCalledWith({
        requestId: REQUEST,
        note: 'الوجه الخلفي غير واضح',
      }),
    );
  });

  it('says a decision that failed and keeps the confirmation open', async () => {
    const { api, viewer } = await openRequestDocument();
    api.documents.accept.mutate.mockRejectedValue(refusal('CONFLICT'));
    fireEvent.click(
      viewer.getByRole('button', { name: ar('admin.dialogs.documentViewer.accept') }),
    );
    const confirm = await dialog(
      ar('admin.dialogs.confirm.acceptDocument.title', { name: row.displayName }),
    );
    fireEvent.click(
      confirm.getByRole('button', { name: ar('admin.dialogs.confirm.acceptDocument.confirm') }),
    );
    expect(await confirm.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
  });
});

describe('require-ID (FR-166)', () => {
  it('asks for a reason and opens the request, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const panel = await detail();
        fireEvent.click(panel.getByRole('button', { name: t('admin.common.action.requireId') }));
        const asking = await dialog(t('admin.dialogs.requireId.title'));
        expect(
          asking.getByText(
            t('admin.dialogs.requireId.subtitle', {
              name: row.displayName,
              role: t('admin.common.role.teacher'),
              status: t('admin.status.account.activeLong'),
            }),
          ),
        ).toBeTruthy();
        expect(asking.getByText(t('admin.dialogs.requireId.effectBookings'))).toBeTruthy();
        expect(asking.getByText(t('admin.dialogs.requireId.reasonHint'))).toBeTruthy();
        expect(
          (
            asking.getByRole('button', {
              name: t('admin.dialogs.requireId.confirm'),
            }) as HTMLButtonElement
          ).disabled,
        ).toBe(true);
      },
    );
  });

  it('sends the reason, closes, and reads the detail again', async () => {
    const { api } = open();
    api.users.requireIdentity.mutate.mockResolvedValue(undefined);
    fireEvent.click(
      (await detail()).getByRole('button', { name: ar('admin.common.action.requireId') }),
    );
    const asking = await dialog(ar('admin.dialogs.requireId.title'));
    fireEvent.change(asking.getByLabelText(ar('admin.dialogs.requireId.reasonLabel')), {
      target: { value: '  بلاغ من طالب  ' },
    });
    fireEvent.click(asking.getByRole('button', { name: ar('admin.dialogs.requireId.confirm') }));
    await waitFor(() =>
      expect(api.users.requireIdentity.mutate).toHaveBeenCalledWith({
        targetUserId: A,
        reason: 'بلاغ من طالب',
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 2, name: ar('admin.dialogs.requireId.title') }),
      ).toBeNull(),
    );
    expect(api.applications.get.query).toHaveBeenCalledTimes(2);
  });

  it('says a refusal and stays open', async () => {
    const { api } = open();
    api.users.requireIdentity.mutate.mockRejectedValue(refusal('CONFLICT'));
    fireEvent.click(
      (await detail()).getByRole('button', { name: ar('admin.common.action.requireId') }),
    );
    const asking = await dialog(ar('admin.dialogs.requireId.title'));
    fireEvent.change(asking.getByLabelText(ar('admin.dialogs.requireId.reasonLabel')), {
      target: { value: 'سبب' },
    });
    fireEvent.click(asking.getByRole('button', { name: ar('admin.dialogs.requireId.confirm') }));
    expect(await asking.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
  });

  it.each(['suspended', 'banned', 'verification_required'])(
    'is not offered on an account %s',
    async (accountStatus) => {
      open(fakeApi(detailOf({ accountStatus })));
      const panel = await detail();
      expect(panel.queryByRole('button', { name: ar('admin.common.action.requireId') })).toBeNull();
    },
  );
});
