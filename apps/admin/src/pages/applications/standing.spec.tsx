// T073 (FR-173): the standing dialogs, reached from an approved teacher's detail (B14d, the owner's
// decision: the teacher's own page lands in a later phase). An active teacher is suspended, has the
// approval revoked, or is banned, from the board's one dialog (`AdminSuspendDialog`) with its three
// kinds, each with what the server does and nothing a later phase does, and a reason; a suspended
// teacher is reinstated with a reason (`reactivateAccount`). Nothing is offered on an application
// still open. A refusal is said in place.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getLocale, setLocale, translate, type MessageKey } from '../../i18n';
import { inBothLocales, mutation, query, refusal, renderApp } from '../../test/app-harness';

afterEach(() => setLocale('ar'));

const A = '0193a6f0-0000-7000-8000-00000000000a';
const QURAN = { id: '0193a6f0-0000-7000-8000-0000000000a1', nameAr: 'حفظ القرآن', nameEn: 'Quran' };

const row = {
  teacherUserId: A,
  displayName: 'الشيخ ياسر حمدي',
  email: 'yasser@example.com',
  gender: 'male',
  isMinor: false,
  subjects: [QURAN],
  submittedAt: '2026-10-14T09:00:00.000Z',
  status: 'approved',
} as const;

function detailOf(more: Record<string, unknown> = {}) {
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
    credentials: [],
    call: { completedOn: '2026-10-13', outcome: 'suitable', notes: 'مناسب' },
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
    teachers: {
      suspend: mutation(),
      revokeApproval: mutation(),
      ban: mutation(),
      reinstate: mutation(),
    },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.applications.list.query.mockResolvedValue({ rows: [row], total: 1, pageSize: 25 });
  api.applications.get.query.mockResolvedValue(detail);
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: 'x', displayName: 'سارة', email: 's@x.io' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;
const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const tr = (key: MessageKey, values?: Record<string, string | number>) =>
  translate(getLocale(), key, values);

function open(api = fakeApi()) {
  return { ...renderApp({ at: `/applications?teacher=${A}`, session: verified, api }), api };
}

/** The detail opened by `?teacher=`, once loaded. */
async function detail() {
  const region = within(
    await screen.findByRole('complementary', { name: tr('admin.applications.detail.a11y') }),
  );
  await region.findByText('إجازة في حفظ القرآن بالسند المتصل.');
  return region;
}

async function dialog(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

describe('the standing of an approved teacher (FR-173)', () => {
  it('offers suspend, revoke and ban on an active teacher, each saying only what follows now, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const panel = await detail();
        fireEvent.click(
          panel.getByRole('button', { name: t('admin.dialogs.suspendTeacher.kinds.suspend') }),
        );
        const suspending = await dialog(
          t('admin.dialogs.suspendTeacher.title', { name: row.displayName }),
        );
        expect(suspending.getByText(t('admin.dialogs.suspendTeacher.honest.suspend'))).toBeTruthy();
        expect(
          suspending.queryByText(t('admin.dialogs.suspendTeacher.effects.notified')),
        ).toBeNull();
        fireEvent.click(
          suspending.getByRole('button', {
            name: t('admin.dialogs.suspendTeacher.kinds.revokeApproval'),
          }),
        );
        expect(
          await screen.findByRole('heading', {
            level: 2,
            name: t('admin.dialogs.suspendTeacher.revoke.title', { name: row.displayName }),
          }),
        ).toBeTruthy();
        expect(screen.getByText(t('admin.dialogs.suspendTeacher.honest.revoke'))).toBeTruthy();
        expect(
          screen.getByLabelText(t('admin.dialogs.suspendTeacher.revoke.reasonLabel')),
        ).toBeTruthy();
      },
    );
  });

  it.each([
    [
      'suspend',
      'admin.dialogs.suspendTeacher.kinds.suspend',
      'admin.dialogs.suspendTeacher.reasonLabel',
      'suspend',
    ],
    [
      'revokeApproval',
      'admin.dialogs.suspendTeacher.kinds.revokeApproval',
      'admin.dialogs.suspendTeacher.revoke.reasonLabel',
      'revokeApproval',
    ],
    [
      'ban',
      'admin.dialogs.suspendTeacher.kinds.ban',
      'admin.dialogs.suspendTeacher.ban.reasonLabel',
      'ban',
    ],
  ] as const)('%s with the reason, once confirmed', async (_, kind, reasonLabel, procedure) => {
    const { api } = open();
    api.teachers[procedure].mutate.mockResolvedValue(undefined);
    const panel = await detail();
    fireEvent.click(
      panel.getByRole('button', { name: ar('admin.dialogs.suspendTeacher.kinds.suspend') }),
    );
    await dialog(ar('admin.dialogs.suspendTeacher.title', { name: row.displayName }));
    const kinds = within(
      screen.getByRole('group', { name: ar('admin.applications.detail.standing') }),
    );
    fireEvent.click(kinds.getByRole('button', { name: ar(kind) }));
    const go = () =>
      screen
        .getAllByRole('button', { name: ar(kind) })
        .find((button) => button.closest('.dialog__actions') !== null) as HTMLButtonElement;
    expect(go().disabled).toBe(true);
    type(screen.getByLabelText(ar(reasonLabel)), '  شكاوى متكررة ');
    fireEvent.click(go());
    await waitFor(() =>
      expect(api.teachers[procedure].mutate).toHaveBeenCalledWith({
        teacherUserId: A,
        reason: 'شكاوى متكررة',
      }),
    );
    await waitFor(() => expect(api.applications.get.query).toHaveBeenCalledTimes(2));
  });

  it('reinstates a suspended teacher with the reason, and says a refusal', async () => {
    const { api } = open(fakeApi(detailOf({ accountStatus: 'suspended' })));
    api.teachers.reinstate.mutate.mockRejectedValueOnce(refusal('CONFLICT'));
    api.teachers.reinstate.mutate.mockResolvedValueOnce(undefined);
    const panel = await detail();
    expect(
      panel.queryByRole('button', { name: ar('admin.dialogs.suspendTeacher.kinds.suspend') }),
    ).toBeNull();
    fireEvent.click(
      panel.getByRole('button', { name: ar('admin.dialogs.confirm.reactivateAccount.confirm') }),
    );
    const reinstating = await dialog(
      ar('admin.dialogs.confirm.reactivateAccount.title', { name: row.displayName }),
    );
    expect(
      reinstating.getByText(ar('admin.dialogs.confirm.reactivateAccount.effects.reinstated')),
    ).toBeTruthy();
    expect(
      reinstating.queryByText(
        ar('admin.dialogs.confirm.reactivateAccount.effects.notified', { name: row.displayName }),
      ),
    ).toBeNull();
    type(
      reinstating.getByLabelText(ar('admin.dialogs.confirm.reactivateAccount.reasonLabel')),
      'انتهت المدة',
    );
    const go = reinstating.getByRole('button', {
      name: ar('admin.dialogs.confirm.reactivateAccount.confirm'),
    });
    fireEvent.click(go);
    expect(await reinstating.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    fireEvent.click(go);
    await waitFor(() =>
      expect(api.teachers.reinstate.mutate).toHaveBeenLastCalledWith({
        teacherUserId: A,
        reason: 'انتهت المدة',
      }),
    );
  });

  it('offers no standing action on an application still open', async () => {
    open(fakeApi(detailOf({ status: 'in_review' })));
    const panel = await detail();
    expect(
      panel.queryByRole('button', { name: ar('admin.dialogs.suspendTeacher.kinds.suspend') }),
    ).toBeNull();
    expect(
      panel.queryByRole('button', { name: ar('admin.dialogs.confirm.reactivateAccount.confirm') }),
    ).toBeNull();
  });
});
