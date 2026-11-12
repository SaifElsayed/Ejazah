// B42, T058 (FR-481, FR-459, FR-486, FR-451, FR-426; SRS FR-ADMIN-4; contracts/admin-surface.md
// "`users`"): `/users`, the user directory, through the router, in both languages. The list newest
// first as the server answers it, searched by the start of a name once the typing stops, in keyset
// pages; each user's name or FR-426's stand-in (a deleted user's role may be null), role and account
// status. A user's record at `?user=` with exactly the contract's fields; a teacher's marked
// enrollments, each linking to `/sessions?enrollment=`; on a student's record the suspend, ban and
// reinstate buttons opening T051's dialogs, by the account status the server answered, and both reads
// again after one is done. None of the board-only behaviour (the note under T058, Q2); no word calls
// a ban final (Q1 (a)). `RATE_LIMITED` says when to try again.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { dayMonthYear } from '../../lib/format';
import { panelTimeZone } from '../../lib/zone';
import {
  currentPath,
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
} from '../../test/app-harness';

afterEach(() => {
  setLocale('ar');
});

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const U1 = '0193a6f0-0000-7000-8000-0000000000b1';
const U2 = '0193a6f0-0000-7000-8000-0000000000b2';
const U3 = '0193a6f0-0000-7000-8000-0000000000b3';
const U4 = '0193a6f0-0000-7000-8000-0000000000b4';
const U5 = '0193a6f0-0000-7000-8000-0000000000b5';
const E1 = '0193a6f0-0000-7000-8000-0000000000e1';
const E2 = '0193a6f0-0000-7000-8000-0000000000e2';

const student = {
  userId: U1,
  displayName: 'عبد الله حسن',
  deleted: false,
  role: 'student',
  accountStatus: 'active',
} as const;
const teacher = {
  userId: U2,
  displayName: 'Sarah Adel',
  deleted: false,
  role: 'teacher',
  accountStatus: 'suspended',
} as const;
const deletedStudent = {
  userId: U3,
  displayName: null,
  deleted: true,
  role: 'student',
  accountStatus: 'active',
} as const;
const deletedNoRole = {
  userId: U4,
  displayName: null,
  deleted: true,
  role: null,
  accountStatus: 'active',
} as const;
const noRole = {
  userId: U5,
  displayName: 'Probe',
  deleted: false,
  role: null,
  accountStatus: 'banned',
} as const;

type AccountStatus = 'active' | 'suspended' | 'verification_required' | 'banned';

function studentRecord(accountStatus: AccountStatus = 'active') {
  return {
    userId: U1,
    profile: {
      displayName: 'عبد الله حسن',
      email: 'abdullah@example.test',
      joinedAt: '2026-10-01T09:00:00.000Z',
      deleted: false,
    },
    role: 'student',
    gender: 'male',
    isMinor: true,
    verificationStatus: null,
    accountStatus,
    cancellationRequests: { total: 4, recent: 1 },
  } as const;
}

/** A deleted student's record: erasure nulled the name, the email and the date of birth (ADR 0015),
 *  so the server's `isMinor` is false, and the account status is the one the row kept. */
const deletedStudentRecord = {
  userId: U3,
  profile: {
    displayName: null,
    email: null,
    joinedAt: '2026-08-01T09:00:00.000Z',
    deleted: true,
  },
  role: 'student',
  gender: 'female',
  isMinor: false,
  verificationStatus: null,
  accountStatus: 'active',
  cancellationRequests: { total: 0, recent: 0 },
} as const;

const teacherRecord = {
  userId: U2,
  profile: {
    displayName: 'Sarah Adel',
    email: 'sarah@example.test',
    joinedAt: '2026-09-15T09:00:00.000Z',
    deleted: false,
    teacher: { bio: 'تحفّظ القرآن منذ عشرين عامًا', qualification: 'إجازة برواية حفص' },
  },
  role: 'teacher',
  gender: 'female',
  isMinor: false,
  verificationStatus: 'approved',
  accountStatus: 'suspended',
  cancellationRequests: { total: 2, recent: 0 },
  repeatedAbsences: [
    {
      enrollmentId: E1,
      student: { userId: U1, displayName: 'عبد الله حسن', deleted: false },
      status: 'confirmed',
      teacherNoShows: 5,
    },
    {
      enrollmentId: E2,
      student: { userId: U3, displayName: null, deleted: true },
      status: 'terminated_no_show',
      teacherNoShows: 6,
    },
  ],
} as const;

function fakeApi(studentStatus: AccountStatus = 'active') {
  const api = {
    users: { list: query(), get: query() },
    students: { suspend: mutation(), ban: mutation(), reinstate: mutation() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.users.list.query.mockImplementation(async (input) => {
    const { cursor } = (input ?? {}) as { cursor?: string };
    if (cursor === U4) return { items: [noRole] };
    return { items: [student, teacher, deletedStudent, deletedNoRole], nextCursor: U4 };
  });
  api.users.get.query.mockImplementation(async (input) => {
    const { targetUserId } = input as { targetUserId: string };
    if (targetUserId === U3) return deletedStudentRecord;
    return targetUserId === U2 ? teacherRecord : studentRecord(studentStatus);
  });
  for (const kind of ['suspend', 'ban', 'reinstate'] as const) {
    api.students[kind].mutate.mockResolvedValue(undefined);
  }
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: U5, displayName: 'سارة عادل', email: 'a@b.c' });
  return api;
}

const verified = { token: 't', step: 'verified' } as const;

function open(api = fakeApi(), at = '/users') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The table's row of the cell reading `text`. */
async function rowOf(text: string) {
  const cell = await screen.findByText(text);
  return cell.closest('tr') as HTMLElement;
}

/** The record beside the list. */
async function record(t: (key: MessageKey) => string) {
  return within(
    await screen.findByRole('complementary', { name: t('admin.users.detail.a11y') }),
  );
}

const STANDING: Readonly<Record<'suspend' | 'ban' | 'reinstate', MessageKey>> = {
  suspend: 'admin.users.detail.suspend',
  ban: 'admin.users.detail.ban',
  reinstate: 'admin.users.reactivate',
};

describe('AdminUsers: the list (FR-481)', () => {
  it('draws each user’s name or stand-in, role and account status, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        expect(await screen.findByText(t('admin.users.directory.lede'))).toBeTruthy();
        const one = within(await rowOf(student.displayName));
        for (const column of ['user', 'role', 'status'] as const) {
          expect(
            screen.getByRole('columnheader', { name: t(`admin.users.columns.${column}`) }),
          ).toBeTruthy();
        }
        expect(one.getByText(t('admin.common.role.student'))).toBeTruthy();
        expect(one.getByText(t('admin.status.account.active'))).toBeTruthy();
        const two = within(await rowOf(teacher.displayName));
        expect(two.getByText(t('admin.common.role.teacher'))).toBeTruthy();
        expect(two.getByText(t('admin.status.account.suspended'))).toBeTruthy();
        // A deleted student reads the student's stand-in; a deleted user with no role, the account's.
        const gone = within(await rowOf(t('admin.shared.party.deletedStudent')));
        expect(gone.getByText(t('admin.common.role.student'))).toBeTruthy();
        const none = within(await rowOf(t('admin.users.directory.deletedAccount')));
        expect(none.getByText(t('admin.users.directory.noRole'))).toBeTruthy();
      },
    );
  });

  it('reads the first page with no search, and pages by the cursor the server wrote', async () => {
    const { api } = open();
    await rowOf(student.displayName);
    expect(api.users.list.query).toHaveBeenLastCalledWith({});
    const pages = screen.getByRole('navigation', { name: ar('admin.common.a11y.pages') });
    fireEvent.click(within(pages).getByRole('button', { name: '2' }));
    const row = within(await rowOf(noRole.displayName));
    expect(api.users.list.query).toHaveBeenLastCalledWith({ cursor: U4 });
    expect(row.getByText(ar('admin.users.directory.noRole'))).toBeTruthy();
    expect(row.getByText(ar('admin.status.account.banned'))).toBeTruthy();
  });

  it('sends the start of a name once the typing stops', async () => {
    const { api } = open();
    await rowOf(student.displayName);
    fireEvent.change(screen.getByPlaceholderText(ar('admin.users.directory.searchPlaceholder')), {
      target: { value: ' عبد ' },
    });
    await waitFor(() => expect(api.users.list.query).toHaveBeenLastCalledWith({ name: 'عبد' }));
  });

  it('says when there is no user yet, and when a search finds none', async () => {
    const api = fakeApi();
    api.users.list.query.mockResolvedValue({ items: [] });
    open(api);
    expect(await screen.findByText(ar('admin.users.directory.emptyAll.title'))).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(ar('admin.users.directory.searchPlaceholder')), {
      target: { value: 'zz' },
    });
    expect(await screen.findByText(ar('admin.users.searchEmpty.title'))).toBeTruthy();
    expect(screen.getByText(ar('admin.users.directory.searchEmptyText'))).toBeTruthy();
  });

  it('opens a row’s record at ?user=', async () => {
    const { api } = open();
    fireEvent.click(await rowOf(student.displayName));
    await waitFor(() => expect(currentPath()).toBe(`/users?user=${U1}`));
    await waitFor(() =>
      expect(api.users.get.query).toHaveBeenLastCalledWith({ targetUserId: U1 }),
    );
  });
});

describe('AdminUsers: a user’s record (SRS FR-ADMIN-4)', () => {
  it('draws a student’s record with exactly the contract’s fields, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/users?user=${U1}`),
      async (t, locale) => {
        const panel = await record(t);
        expect(await panel.findByText('abdullah@example.test')).toBeTruthy();
        expect(
          panel.getByText(dayMonthYear('2026-10-01T09:00:00.000Z', locale, panelTimeZone())),
        ).toBeTruthy();
        expect(panel.getByText(t('admin.users.record.deleted'))).toBeTruthy();
        expect(panel.getByText(t('admin.common.gender.male'))).toBeTruthy();
        expect(panel.getByText(t('admin.users.detail.minor'))).toBeTruthy();
        expect(panel.getByText(t('admin.users.record.cancellationsTotal'))).toBeTruthy();
        expect(panel.getByText('4')).toBeTruthy();
        expect(panel.getByText('1')).toBeTruthy();
        expect(panel.getAllByText(t('admin.status.account.active')).length).toBeGreaterThan(0);
        // A student has no teacher profile: no verification status, bio or qualification.
        expect(panel.queryByText(t('admin.users.record.verification'))).toBeNull();
        expect(panel.queryByText(t('admin.users.record.bio'))).toBeNull();
      },
    );
  });

  it('draws a teacher’s bio, qualification, verification status and marked enrollments, each linking to /sessions', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/users?user=${U2}`),
      async (t) => {
        const panel = await record(t);
        expect(await panel.findByText(teacherRecord.profile.teacher.bio)).toBeTruthy();
        expect(panel.getByText(teacherRecord.profile.teacher.qualification)).toBeTruthy();
        expect(panel.getByText(t('admin.users.record.verification'))).toBeTruthy();
        expect(panel.getByText(t('admin.users.record.verificationStatus.approved'))).toBeTruthy();
        expect(panel.getByText(t('admin.common.gender.female'))).toBeTruthy();
        const marked = within(
          panel.getByRole('region', { name: t('admin.users.record.repeatedAbsences') }),
        );
        expect(marked.getByText('عبد الله حسن')).toBeTruthy();
        expect(marked.getByText(t('admin.shared.party.deletedStudent'))).toBeTruthy();
        expect(marked.getByText(t('admin.status.enrollment.confirmed'))).toBeTruthy();
        expect(marked.getByText(t('admin.status.enrollment.terminatedNoShow'))).toBeTruthy();
        expect(marked.getByText(t('admin.shared.noShows.count', { count: 5 }))).toBeTruthy();
        expect(marked.getByText(t('admin.shared.noShows.count', { count: 6 }))).toBeTruthy();
        const links = marked.getAllByRole('link', { name: t('admin.users.record.openEnrollment') });
        expect(links.map((link) => link.getAttribute('href'))).toEqual([
          `/sessions?enrollment=${E1}`,
          `/sessions?enrollment=${E2}`,
        ]);
      },
    );
  });

  it('a marked enrollment’s link opens it on /sessions', async () => {
    open(fakeApi(), `/users?user=${U2}`);
    const panel = await record(ar);
    const [first] = await panel.findAllByRole('link', {
      name: ar('admin.users.record.openEnrollment'),
    });
    fireEvent.click(first as HTMLElement);
    await waitFor(() => expect(currentPath()).toBe(`/sessions?enrollment=${E1}`));
  });

  it('says a teacher with no marked enrollment has none', async () => {
    const api = fakeApi();
    api.users.get.query.mockResolvedValue({ ...teacherRecord, repeatedAbsences: [] });
    open(api, `/users?user=${U2}`);
    const panel = await record(ar);
    expect(await panel.findByText(ar('admin.users.record.noRepeatedAbsences'))).toBeTruthy();
  });

  it('a deleted account’s minor row reads «—», a live one’s its yes or no (PR #137 r1, Minor 2)', async () => {
    const minorValue = (panel: ReturnType<typeof within>) =>
      panel.getByText(ar('admin.users.detail.minor')).closest('.kv__item')?.querySelector('dd')
        ?.textContent;
    const live = open(fakeApi(), `/users?user=${U1}`);
    const livePanel = await record(ar);
    expect(await livePanel.findByText('abdullah@example.test')).toBeTruthy();
    expect(minorValue(livePanel)).toBe(ar('admin.common.yes'));
    live.view.unmount();
    open(fakeApi(), `/users?user=${U3}`);
    const gone = await record(ar);
    expect(await gone.findByText(ar('admin.users.record.deleted'))).toBeTruthy();
    expect(minorValue(gone)).toBe(ar('admin.payments.dash'));
  });

  it('a teacher’s record has no student standing button', async () => {
    open(fakeApi(), `/users?user=${U2}`);
    const panel = await record(ar);
    expect(await panel.findByText(teacherRecord.profile.teacher.bio)).toBeTruthy();
    for (const kind of ['suspend', 'ban', 'reinstate'] as const) {
      expect(panel.queryByRole('button', { name: ar(STANDING[kind]) })).toBeNull();
    }
  });
});

/** T051's dialog of each kind: its title, reason label and confirm (StudentStandingDialogs.tsx). */
const DIALOG: Readonly<
  Record<
    'suspend' | 'ban' | 'reinstate',
    { readonly title: MessageKey; readonly reason: MessageKey; readonly confirm: MessageKey }
  >
> = {
  suspend: {
    title: 'admin.dialogs.suspendStudent.title',
    reason: 'admin.dialogs.suspendStudent.reasonLabel',
    confirm: 'admin.dialogs.suspendStudent.confirm',
  },
  ban: {
    title: 'admin.dialogs.suspendStudent.ban.title',
    reason: 'admin.dialogs.suspendStudent.ban.reasonLabel',
    confirm: 'admin.dialogs.suspendStudent.ban.confirm',
  },
  reinstate: {
    title: 'admin.dialogs.confirm.reactivateAccount.title',
    reason: 'admin.dialogs.confirm.reactivateAccount.reasonLabel',
    confirm: 'admin.dialogs.confirm.reactivateAccount.confirm',
  },
};

describe('AdminUsers: a student’s standing (FR-486; T051’s dialogs)', () => {
  it.each([
    ['active', ['suspend', 'ban']],
    ['verification_required', ['suspend', 'ban']],
    ['suspended', ['reinstate']],
    ['banned', []],
  ] as const)('a %s student shows %j and no other', async (status, shown) => {
    open(fakeApi(status), `/users?user=${U1}`);
    const panel = await record(ar);
    expect(await panel.findByText('abdullah@example.test')).toBeTruthy();
    for (const kind of ['suspend', 'ban', 'reinstate'] as const) {
      const button = panel.queryByRole('button', { name: ar(STANDING[kind]) });
      if ((shown as readonly string[]).includes(kind)) expect(button).toBeTruthy();
      else expect(button).toBeNull();
    }
  });

  it('a deleted student shows no standing button, whatever the status kept (PR #137 r1, Minor 1)', async () => {
    open(fakeApi(), `/users?user=${U3}`);
    const panel = await record(ar);
    expect(await panel.findByText(ar('admin.users.record.deleted'))).toBeTruthy();
    for (const kind of ['suspend', 'ban', 'reinstate'] as const) {
      expect(panel.queryByRole('button', { name: ar(STANDING[kind]) })).toBeNull();
    }
  });

  it.each([
    ['suspend', 'active'],
    ['ban', 'active'],
    ['reinstate', 'suspended'],
  ] as const)(
    '%s opens T051’s dialog; once done it closes and the record and the list are read again',
    async (kind, status) => {
      const { api } = open(fakeApi(status), `/users?user=${U1}`);
      const panel = await record(ar);
      fireEvent.click(await panel.findByRole('button', { name: ar(STANDING[kind]) }));
      const heading = await screen.findByRole('heading', {
        level: 2,
        name: ar(DIALOG[kind].title, { name: 'عبد الله حسن' }),
      });
      const dialog = within(heading.closest('section.dialog') as HTMLElement);
      const reads = api.users.get.query.mock.calls.length;
      const lists = api.users.list.query.mock.calls.length;
      fireEvent.change(dialog.getByLabelText(ar(DIALOG[kind].reason)), {
        target: { value: ' سبب واضح ' },
      });
      fireEvent.click(dialog.getByRole('button', { name: ar(DIALOG[kind].confirm) }));
      await waitFor(() =>
        expect(api.students[kind].mutate).toHaveBeenCalledWith({
          studentUserId: U1,
          reason: 'سبب واضح',
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('heading', {
            level: 2,
            name: ar(DIALOG[kind].title, { name: 'عبد الله حسن' }),
          }),
        ).toBeNull(),
      );
      await waitFor(() => {
        expect(api.users.get.query.mock.calls.length).toBeGreaterThan(reads);
        expect(api.users.list.query.mock.calls.length).toBeGreaterThan(lists);
      });
    },
  );
});

describe('AdminUsers: nothing only the board draws (the note under T058, Q2)', () => {
  it('no filter, email search, date of birth, sign-in method, identity or bar action, and no final ban', async () => {
    open(fakeApi(), `/users?user=${U1}`);
    const panel = await record(ar);
    expect(await panel.findByText('abdullah@example.test')).toBeTruthy();
    expect(screen.getByRole('button', { name: ar('admin.users.detail.suspend') })).toBeTruthy();
    for (const key of [
      'admin.users.filter.age',
      'admin.users.filter.minorsOnly',
      'admin.users.detail.birthDate',
      'admin.users.detail.signInMethod',
      'admin.users.detail.timeZone',
      'admin.users.detail.requireId',
      'admin.users.detail.barFromIjazahs',
      'admin.users.detail.idRequests',
      'admin.users.detail.footer',
      'admin.users.lede',
    ] as const) {
      expect(screen.queryByText(ar(key))).toBeNull();
    }
    expect(screen.queryByPlaceholderText(ar('admin.users.search.placeholder'))).toBeNull();
    expect(screen.queryByText(/نهائي/)).toBeNull();
  });
});

describe('AdminUsers: RATE_LIMITED (T058)', () => {
  it('says when to try again on the list, and to wait a little on a record, in both languages', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.users.list.query.mockRejectedValue(
          refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
        );
        api.users.get.query.mockRejectedValue(refusal('RATE_LIMITED'));
        return open(api, `/users?user=${U1}`);
      },
      async (t) => {
        expect(
          await screen.findByText(t('admin.common.rateLimitedIn', { count: 2 })),
        ).toBeTruthy();
        const panel = await record(t);
        expect(await panel.findByText(t('admin.common.rateLimited'))).toBeTruthy();
        expect(screen.queryByText(t('admin.common.loadError.text'))).toBeNull();
      },
    );
  });

  it('any other failure keeps the page’s generic words', async () => {
    const api = fakeApi();
    api.users.list.query.mockRejectedValue(refusal('INTERNAL'));
    open(api);
    expect(
      await screen.findByText(ar('admin.common.loadError.title', { page: ar('admin.users.title') })),
    ).toBeTruthy();
    expect(screen.getByText(ar('admin.common.loadError.text'))).toBeTruthy();
  });
});
