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

const DAYS = 21;

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
    // B42b, T075 (Q-O2 (a)): `applications.get`'s `banRestoreWindowDays`, unlike the seed's 14.
    banRestoreWindowDays: DAYS,
    // R1a (002:T174, rule d): `applications.get`'s history.
    history: [],
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
      liftBan: mutation(),
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

  // T113: under an open identity request the account lands on `verification_required`, and the
  // dialog names that state rather than «نشط».
  it('says a reinstated teacher with an open identity request awaits proof of identity', async () => {
    open(
      fakeApi(
        detailOf({
          accountStatus: 'suspended',
          identityRequest: {
            requestId: '01a18400-0000-7000-8000-0000000000aa',
            reason: 'الصورة غير واضحة',
            requestedAt: '2026-10-20T09:00:00.000Z',
          },
        }),
      ),
    );
    const panel = await detail();
    fireEvent.click(
      panel.getByRole('button', { name: ar('admin.dialogs.confirm.reactivateAccount.confirm') }),
    );
    const reinstating = await dialog(
      ar('admin.dialogs.confirm.reactivateAccount.title', { name: row.displayName }),
    );
    expect(
      reinstating.getByText(
        ar('admin.dialogs.confirm.reactivateAccount.effects.reinstatedAwaitingIdentity'),
      ),
    ).toBeTruthy();
    expect(
      reinstating.queryByText(ar('admin.dialogs.confirm.reactivateAccount.effects.reinstated')),
    ).toBeNull();
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

  // T112 (c): the account's standing beside the application's chip, while the account is not active.
  it.each([
    ['suspended', 'admin.status.account.suspended', 'danger'],
    ['verification_required', 'admin.status.account.verificationPending', 'warning'],
    ['banned', 'admin.status.account.banned', 'danger'],
  ] as const)(
    'shows a %s account beside the application’s chip, in both languages',
    async (accountStatus, text, tone) => {
      await inBothLocales(
        () => open(fakeApi(detailOf({ accountStatus }))),
        async (t) => {
          await detail();
          const header = within(document.querySelector('.panel__header') as HTMLElement);
          expect(header.getByText(t('admin.status.application.approved'))).toBeTruthy();
          expect(header.getByText(t(text)).classList.contains(`badge--${tone}`)).toBe(true);
        },
      );
    },
  );

  it('shows no standing on an active account, and a ban once when the application is banned too', async () => {
    const { view } = open();
    const header = async () => {
      await detail();
      return within(document.querySelector('.panel__header') as HTMLElement);
    };
    const active = await header();
    for (const key of [
      'admin.status.account.suspended',
      'admin.status.account.verificationPending',
      'admin.status.account.banned',
    ] as const) {
      expect(active.queryByText(ar(key))).toBeNull();
    }
    view.unmount();
    open(fakeApi(detailOf({ status: 'banned', accountStatus: 'banned' })));
    expect((await header()).getAllByText(ar('admin.status.account.banned'))).toHaveLength(1);
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

describe('T058: RATE_LIMITED on a teacher’s standing', () => {
  it('the reinstatement says when to try again', async () => {
    const { api } = open(fakeApi(detailOf({ accountStatus: 'suspended' })));
    api.teachers.reinstate.mutate.mockRejectedValue(
      refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    const panel = await detail();
    fireEvent.click(
      panel.getByRole('button', { name: ar('admin.dialogs.confirm.reactivateAccount.confirm') }),
    );
    const reinstating = await dialog(
      ar('admin.dialogs.confirm.reactivateAccount.title', { name: row.displayName }),
    );
    type(
      reinstating.getByLabelText(ar('admin.dialogs.confirm.reactivateAccount.reasonLabel')),
      'انتهت المدة',
    );
    fireEvent.click(
      reinstating.getByRole('button', {
        name: ar('admin.dialogs.confirm.reactivateAccount.confirm'),
      }),
    );
    expect(
      await reinstating.findByText(ar('admin.common.rateLimitedIn', { count: 2 })),
    ).toBeTruthy();
    expect(reinstating.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });
});

// B42b, T075 of specs/004-sessions (FR-502, FR-504; SRS FR-ADMIN-5 as amended, FR-SESS-16 as
// amended, DEC-66, DEC-69; the note under T075, Q-O2 (a) and Q-R6 (a); FU5): an approved teacher's
// ban holds each enrollment's slot for `{days}` and can be lifted at any time; a suspension pauses
// the enrollments and the reinstatement offers what the cancelled sessions owe, refused
// `STUDENT_SUSPENDED` while a paused enrollment's student is suspended; «رفع الحظر» on a banned
// account promises nothing about enrollments and draws each result the answer returns, with a link
// to the person's `/users` record.
describe('T075: an approved teacher’s ban, suspension and reinstatement, in words', () => {
  it('the ban says each slot is held for the setting’s days and the ban can be lifted at any time, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const panel = await detail();
        fireEvent.click(
          panel.getByRole('button', { name: t('admin.dialogs.suspendTeacher.kinds.suspend') }),
        );
        await dialog(t('admin.dialogs.suspendTeacher.title', { name: row.displayName }));
        const kinds = within(
          screen.getByRole('group', { name: t('admin.applications.detail.standing') }),
        );
        fireEvent.click(
          kinds.getByRole('button', { name: t('admin.dialogs.suspendTeacher.kinds.ban') }),
        );
        const words = await screen.findByText(
          t('admin.dialogs.suspendTeacher.honest.ban', { days: DAYS }),
        );
        expect(words.textContent).toContain('21');
        expect(words.textContent).toMatch(locale === 'ar' ? /في أي وقت/u : /at any time/u);
        expect(words.textContent).not.toMatch(/نهائي|لا يُرفع|for good|not lifted|permanent/u);
      },
    );
  });

  it('the suspension says the enrollments pause and the reinstatement offers what is owed, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t, locale) => {
        const panel = await detail();
        fireEvent.click(
          panel.getByRole('button', { name: t('admin.dialogs.suspendTeacher.kinds.suspend') }),
        );
        const words = await screen.findByText(t('admin.dialogs.suspendTeacher.honest.suspend'));
        expect(words.textContent).toMatch(locale === 'ar' ? /تتوقف اشتراكاته مؤقتًا/u : /paused/u);
        expect(words.textContent).toMatch(locale === 'ar' ? /جلسة تعويضية/u : /make-up session/u);
      },
    );
  });

  it('the reinstatement says the paused enrollments resume, and STUDENT_SUSPENDED says what unblocks it, in both languages', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi(detailOf({ accountStatus: 'suspended' }));
        api.teachers.reinstate.mutate.mockRejectedValue(refusal('STUDENT_SUSPENDED'));
        return open(api);
      },
      async (t) => {
        const panel = await detail();
        fireEvent.click(
          panel.getByRole('button', { name: t('admin.dialogs.confirm.reactivateAccount.confirm') }),
        );
        const reinstating = await dialog(
          t('admin.dialogs.confirm.reactivateAccount.title', { name: row.displayName }),
        );
        expect(
          reinstating.getByText(t('admin.dialogs.confirm.reactivateAccount.effects.resumed')),
        ).toBeTruthy();
        type(
          reinstating.getByLabelText(t('admin.dialogs.confirm.reactivateAccount.reasonLabel')),
          'انتهت المدة',
        );
        fireEvent.click(
          reinstating.getByRole('button', {
            name: t('admin.dialogs.confirm.reactivateAccount.confirm'),
          }),
        );
        expect(
          await reinstating.findByText(
            t('admin.dialogs.confirm.reactivateAccount.refused.studentSuspended'),
          ),
        ).toBeTruthy();
        expect(reinstating.queryByText(t('admin.dialogs.submitError'))).toBeNull();
      },
    );
  });
});

describe('T075: «رفع الحظر» on the applicant’s page (Q-R6 (a))', () => {
  const E1 = '0193a6f0-0000-7000-8000-0000000000e1';
  const E2 = '0193a6f0-0000-7000-8000-0000000000e2';
  const banned = () => detailOf({ status: 'banned', accountStatus: 'banned' });
  type T = (key: MessageKey, values?: Record<string, string | number>) => string;

  async function liftDialog(t: T) {
    const panel = await detail();
    fireEvent.click(panel.getByRole('button', { name: t('admin.applications.detail.liftBan') }));
    return dialog(t('admin.users.lift.banTitle', { name: row.displayName }));
  }

  const confirmOf = (lifting: ReturnType<typeof within>, t: T) =>
    lifting
      .getAllByRole('button', { name: t('admin.applications.detail.liftBan') })
      .find(
        (button: HTMLElement) => button.closest('.dialog__actions') !== null,
      ) as HTMLButtonElement;

  it.each([
    ['a banned applicant', { status: 'banned', accountStatus: 'banned' }, true],
    ['an approved teacher banned', { status: 'approved', accountStatus: 'banned' }, true],
    ['an active approved teacher', { status: 'approved', accountStatus: 'active' }, false],
    ['an applicant in review', { status: 'in_review', accountStatus: 'active' }, false],
  ] as const)('is offered on %s: %s', async (_name, more, shown) => {
    open(fakeApi(detailOf(more)));
    const panel = await detail();
    const button = panel.queryByRole('button', { name: ar('admin.applications.detail.liftBan') });
    if (shown) expect(button).toBeTruthy();
    else expect(button).toBeNull();
  });

  it('promises nothing about enrollments, and links to the person’s record once lifted, in both languages', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi(banned());
        api.teachers.liftBan.mutate.mockResolvedValue({ enrollments: [] });
        return open(api);
      },
      async (t) => {
        const lifting = await liftDialog(t);
        const effect = lifting.getByText(t('admin.applications.lift.effect'));
        expect(effect.closest('section.dialog')?.textContent ?? '').not.toMatch(
          /اشتراك|enrollment|نهائي|لا يُرفع|permanent|for good|not lifted/iu,
        );
        expect(confirmOf(lifting, t).disabled).toBe(true);
        type(lifting.getByLabelText(t('admin.users.lift.banReasonLabel')), 'سبب');
        fireEvent.click(confirmOf(lifting, t));
        expect(await lifting.findByText(t('admin.users.lift.doneBan'))).toBeTruthy();
        expect(
          lifting.queryByRole('list', { name: t('admin.users.lift.resultsTitle') }),
        ).toBeNull();
        expect(
          lifting
            .getByRole('link', { name: t('admin.applications.lift.record') })
            .getAttribute('href'),
        ).toBe(`/users?user=${A}`);
      },
    );
  });

  it('sends the trimmed reason with the key minted when it opened, the same on a retry, and reads the detail again once lifted', async () => {
    const api = fakeApi(banned());
    api.teachers.liftBan.mutate
      .mockRejectedValueOnce(refusal('INTERNAL'))
      .mockResolvedValueOnce({ enrollments: [] });
    open(api);
    const lifting = await liftDialog(ar);
    type(lifting.getByLabelText(ar('admin.users.lift.banReasonLabel')), '  خطأ في القرار ');
    fireEvent.click(confirmOf(lifting, ar));
    await lifting.findByText(ar('admin.dialogs.submitError'));
    fireEvent.click(confirmOf(lifting, ar));
    await lifting.findByText(ar('admin.users.lift.doneBan'));
    const [first, second] = api.teachers.liftBan.mutate.mock.calls.map(([input]) => input);
    expect(first).toEqual({
      teacherUserId: A,
      reason: 'خطأ في القرار',
      idempotencyKey: expect.stringMatching(/^[\w-]{16,128}$/u),
    });
    expect(second).toEqual(first);
    await waitFor(() => expect(api.applications.get.query).toHaveBeenCalledTimes(2));
  });

  it('draws each result the answer returns, for an approved teacher’s ban, in plain words', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi(detailOf({ status: 'approved', accountStatus: 'banned' }));
        api.teachers.liftBan.mutate.mockResolvedValue({
          enrollments: [
            { enrollmentId: E1, restored: true },
            { enrollmentId: E2, restored: false, cause: 'slot_taken' },
          ],
        });
        return open(api);
      },
      async (t) => {
        const lifting = await liftDialog(t);
        type(lifting.getByLabelText(t('admin.users.lift.banReasonLabel')), 'سبب');
        fireEvent.click(confirmOf(lifting, t));
        const results = within(
          await lifting.findByRole('list', { name: t('admin.users.lift.resultsTitle') }),
        );
        expect(results.getByText(t('admin.users.lift.result.restored'))).toBeTruthy();
        expect(results.getByText(t('admin.users.lift.result.slotTaken'))).toBeTruthy();
        expect(
          results
            .getAllByRole('link', { name: t('admin.users.record.openEnrollment') })
            .map((link) => link.getAttribute('href')),
        ).toEqual([`/sessions?enrollment=${E1}`, `/sessions?enrollment=${E2}`]);
        expect(
          lifting.getByRole('link', { name: t('admin.applications.lift.record') }),
        ).toBeTruthy();
      },
    );
  });

  it('says not_banned in plain words', async () => {
    const api = fakeApi(banned());
    api.teachers.liftBan.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'cause', code: 'not_banned' }]),
    );
    open(api);
    const lifting = await liftDialog(ar);
    type(lifting.getByLabelText(ar('admin.users.lift.banReasonLabel')), 'سبب');
    fireEvent.click(confirmOf(lifting, ar));
    expect(await lifting.findByText(ar('admin.users.lift.refused.notBanned'))).toBeTruthy();
  });
});
