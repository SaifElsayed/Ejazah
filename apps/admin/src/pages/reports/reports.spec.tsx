// 005:T023 (B49; FR-612, FR-614; the note under T023, Q-R1 (a), Q-I1 (a)): the reports queue
// through the router, in both languages. The queue opens on the open reports; each row with its two
// people as links to their records (`/users?user=`; the reads carry ids only), its context, its date
// and its status. A report's detail at `?report=`: the reporter's words and the evidence (a session
// or chat report's enrollment, `/sessions?enrollment=`). While open, it is resolved «action taken» or
// «dismissed», each with its note and a key, or a gender flag is raised from it (`genderFlags.raise`
// with the report's id and its reported person). A resolved one shows its decision and offers none.
// Each refusal of the two contracts in its own words.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import {
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
  type Translate,
} from '../../test/app-harness';

afterEach(() => {
  setLocale('ar');
});

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const R1 = '0193a6f0-0000-7000-8000-0000000003a1';
const R2 = '0193a6f0-0000-7000-8000-0000000003a2';
const REPORTER = '0193a6f0-0000-7000-8000-0000000003b1';
const REPORTED = '0193a6f0-0000-7000-8000-0000000003b2';
const SESSION = '0193a6f0-0000-7000-8000-0000000003c1';
const ENROLLMENT = '0193a6f0-0000-7000-8000-0000000003e1';
const ADMIN = '0193a6f0-0000-7000-8000-000000000399';
const FLAG = '0193a6f0-0000-7000-8000-0000000003f1';
const REASON = 'تأخر عن الجلسة وتكلم بأسلوب غير لائق';

const open1 = {
  reportId: R1,
  context: 'session',
  status: 'open',
  reporterUserId: REPORTER,
  reportedUserId: REPORTED,
  sessionId: SESSION,
  enrollmentId: ENROLLMENT,
  createdAt: '2026-11-18T09:00:00.000Z',
} as const;
const actioned = {
  ...open1,
  reportId: R2,
  context: 'profile',
  status: 'actioned',
  sessionId: null,
  enrollmentId: null,
} as const;

function fakeApi() {
  const api = {
    reports: { list: query(), get: query(), resolve: mutation() },
    genderFlags: { raise: mutation() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.reports.list.query.mockResolvedValue({ items: [open1, actioned] });
  api.reports.get.query.mockImplementation(async (input) =>
    (input as { reportId: string }).reportId === R1
      ? { ...open1, reason: REASON, resolution: null }
      : {
          ...actioned,
          reason: REASON,
          resolution: {
            outcome: 'actioned',
            note: 'أُوقف الحساب أسبوعًا',
            resolvedAt: '2026-11-18T12:00:00.000Z',
            resolvedByAdminId: ADMIN,
          },
        },
  );
  api.reports.resolve.mutate.mockResolvedValue(undefined);
  api.genderFlags.raise.mutate.mockResolvedValue({ flagId: FLAG });
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

function open(api = fakeApi(), at = '/reports') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The report's detail beside the list, once read. */
async function detailPanel(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', { name: t('admin.reports.detail.a11y') });
  await within(aside).findByText(REASON);
  return within(aside);
}

/** Presses `button` in the panel, writes the reason, and confirms. */
async function act(
  panel: ReturnType<typeof within>,
  button: MessageKey,
  reasonLabel: MessageKey,
  confirm: MessageKey,
) {
  fireEvent.click(panel.getByRole('button', { name: ar(button) }));
  const opened = within(await screen.findByRole('dialog'));
  fireEvent.change(opened.getByLabelText(ar(reasonLabel)), {
    target: { value: '  تحققت من التسجيل  ' },
  });
  fireEvent.click(opened.getByRole('button', { name: ar(confirm) }));
  return opened;
}

describe('the reports queue (FR-612)', () => {
  it('opens on the open reports: each person a link to their record, the context and the status, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const table = within(await screen.findByRole('table'));
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.reports.title') }),
        ).toBeTruthy();
        expect(
          screen
            .getByRole('tab', { name: t('admin.reports.tabs.open') })
            .getAttribute('aria-selected'),
        ).toBe('true');
        const reported = table.getAllByRole('link', { name: REPORTED });
        expect(reported.map((link) => link.getAttribute('href'))).toEqual([
          `/users?user=${REPORTED}`,
          `/users?user=${REPORTED}`,
        ]);
        expect(table.getAllByRole('link', { name: REPORTER })[0]?.getAttribute('href')).toBe(
          `/users?user=${REPORTER}`,
        );
        expect(table.getByText(t('admin.reports.contexts.session'))).toBeTruthy();
        expect(table.getByText(t('admin.status.report.open'))).toBeTruthy();
        expect(table.getByText(t('admin.status.report.actioned'))).toBeTruthy();
      },
    );
  });

  it('reads the open reports first, then each status by its tab', async () => {
    const { api } = open();
    await screen.findByRole('table');
    expect(api.reports.list.query).toHaveBeenLastCalledWith({ status: 'open' });
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.reports.tabs.dismissed') }));
    await waitFor(() =>
      expect(api.reports.list.query).toHaveBeenLastCalledWith({ status: 'dismissed' }),
    );
  });
});

describe('a report’s detail and its decision (FR-612, FR-614)', () => {
  it('draws the reporter’s words and the evidence, a link to the enrollment, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/reports?report=${R1}`),
      async (t) => {
        const panel = await detailPanel(t);
        expect(
          panel
            .getByRole('link', { name: t('admin.reports.detail.openEnrollment') })
            .getAttribute('href'),
        ).toBe(`/sessions?enrollment=${ENROLLMENT}`);
        expect(panel.getByRole('button', { name: t('admin.reports.detail.action') })).toBeTruthy();
        expect(panel.getByRole('button', { name: t('admin.reports.detail.dismiss') })).toBeTruthy();
        expect(
          panel.getByRole('button', { name: t('admin.reports.detail.openGenderFlag') }),
        ).toBeTruthy();
      },
    );
  });

  it.each([
    [
      'actioned',
      'admin.reports.detail.action',
      'admin.dialogs.confirm.actionReport.reasonLabel',
      'admin.dialogs.confirm.actionReport.confirm',
    ],
    [
      'dismissed',
      'admin.reports.detail.dismiss',
      'admin.dialogs.confirm.dismissReport.reasonLabel',
      'admin.dialogs.confirm.dismissReport.confirm',
    ],
  ] as const)(
    'resolves it %s with its note, trimmed, once with a key',
    async (outcome, button, label, confirm) => {
      const { api } = open(fakeApi(), `/reports?report=${R1}`);
      await act(await detailPanel(), button, label, confirm);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.reports.resolve.mutate).toHaveBeenCalledTimes(1);
      expect(api.reports.resolve.mutate).toHaveBeenCalledWith({
        reportId: R1,
        outcome,
        note: 'تحققت من التسجيل',
        idempotencyKey: expect.any(String),
      });
    },
  );

  it('raises a gender flag from it: its reported person and its id', async () => {
    const { api } = open(fakeApi(), `/reports?report=${R1}`);
    await act(
      await detailPanel(),
      'admin.reports.detail.openGenderFlag',
      'admin.dialogs.confirm.raiseGenderFlag.reasonLabel',
      'admin.dialogs.confirm.raiseGenderFlag.confirm',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.genderFlags.raise.mutate).toHaveBeenCalledWith({
      targetUserId: REPORTED,
      reportId: R1,
      reason: 'تحققت من التسجيل',
      idempotencyKey: expect.any(String),
    });
  });

  it('shows a resolved report’s decision and offers no other', async () => {
    open(fakeApi(), `/reports?report=${R2}`);
    const panel = await detailPanel();
    expect(panel.getByText('أُوقف الحساب أسبوعًا')).toBeTruthy();
    expect(panel.getByText(ar('admin.status.report.actioned'))).toBeTruthy();
    expect(panel.queryByRole('button', { name: ar('admin.reports.detail.action') })).toBeNull();
    expect(panel.queryByRole('button', { name: ar('admin.reports.detail.dismiss') })).toBeNull();
  });

  it.each([
    [
      'resolve',
      refusal('CONFLICT', [{ path: 'reportId', code: 'already_resolved' }]),
      'admin.reports.refused.alreadyResolved',
    ],
    ['resolve', refusal('NOT_FOUND'), 'admin.reports.refused.notFound'],
    [
      'raise',
      refusal('CONFLICT', [{ path: 'targetUserId', code: 'open_exists' }]),
      'admin.gender.refused.openExists',
    ],
    [
      'raise',
      refusal('CONFLICT', [{ path: 'reportId', code: 'report_target_mismatch' }]),
      'admin.gender.refused.reportTargetMismatch',
    ],
    ['raise', refusal('NOT_FOUND'), 'admin.gender.refused.notFound'],
  ] as const)('says a refused %s in its own words: %#', async (procedure, error, words) => {
    const api = fakeApi();
    if (procedure === 'resolve') api.reports.resolve.mutate.mockRejectedValue(error);
    else api.genderFlags.raise.mutate.mockRejectedValue(error);
    open(api, `/reports?report=${R1}`);
    const panel = await detailPanel();
    const opened =
      procedure === 'resolve'
        ? await act(
            panel,
            'admin.reports.detail.dismiss',
            'admin.dialogs.confirm.dismissReport.reasonLabel',
            'admin.dialogs.confirm.dismissReport.confirm',
          )
        : await act(
            panel,
            'admin.reports.detail.openGenderFlag',
            'admin.dialogs.confirm.raiseGenderFlag.reasonLabel',
            'admin.dialogs.confirm.raiseGenderFlag.confirm',
          );
    expect(await opened.findByText(ar(words))).toBeTruthy();
  });
});
