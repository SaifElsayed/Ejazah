// B42b, T075 of specs/004-sessions (FR-502, FR-503; SRS FR-ADMIN-5 as amended, DEC-66, DEC-69; the
// note under T075, Q-O2 (a); N11; contracts/admin-surface.md, `students.liftBan`, `teachers.liftBan`,
// `teachers.liftRevocation`): the lifts on `/users`, through the router, in both languages.
// - «رفع الحظر» on a banned student's or teacher's record and «إلغاء سحب الاعتماد» on a revoked
//   teacher's, at any time, by the statuses the server answered, none on a deleted account;
// - each dialog says what the lift does: the enrollments come back, their slots held until `{when}`
//   (`enrollmentsSlotHeldUntil`) for `{days}` (`banRestoreWindowDays`), and afterwards only where
//   still free; a mandatory reason; the key minted when the dialog opens, the same on a retry;
// - each enrollment's result `{ enrollmentId, restored, cause }` in plain words, each linking to its
//   enrollment on `/sessions`; the record and the list read again;
// - the refusals `not_banned`, `not_revoked`, `restore_failed` (with its enrollment), a second
//   deadlock, a reused key, `NOT_FOUND` and `RATE_LIMITED` in plain words through `errorMessageKey`;
// - no word, here or in any rewritten key of either catalogue, says a ban or a revocation is final.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import arCatalogue from '../../i18n/ar.json';
import enCatalogue from '../../i18n/en.json';
import { type MessageKey, setLocale, translate } from '../../i18n';
import { dayMonth, timeOfDay } from '../../lib/format';
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

afterEach(() => setLocale('ar'));

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const id = (suffix: string) => `0193a6f0-0000-7000-8000-${suffix.padStart(12, '0')}`;
const STUDENT = id('b1');
const TEACHER = id('b2');
const REVOKED = id('b3');
const DELETED = id('b4');
const E1 = id('e1');
const E2 = id('e2');
const E3 = id('e3');
const HELD_UNTIL = '2026-11-27T08:00:00.000Z';
const DAYS = 14;

type Kind = 'studentBan' | 'teacherBan' | 'revocation';

function recordOf(
  userId: string,
  more: {
    readonly role: 'student' | 'teacher';
    readonly accountStatus: string;
    readonly verificationStatus?: string | null;
    readonly heldUntil?: string | null;
    readonly deleted?: boolean;
  },
) {
  return {
    userId,
    profile: {
      displayName: more.deleted === true ? null : `اسم ${userId.slice(-2)}`,
      email: more.deleted === true ? null : `${userId.slice(-2)}@example.test`,
      joinedAt: '2026-10-01T09:00:00.000Z',
      deleted: more.deleted ?? false,
      ...(more.role === 'teacher' ? { teacher: { bio: 'معلم', qualification: 'إجازة' } } : {}),
    },
    role: more.role,
    gender: 'male',
    isMinor: false,
    verificationStatus: more.verificationStatus ?? null,
    accountStatus: more.accountStatus,
    cancellationRequests: { total: 0, recent: 0 },
    ...(more.role === 'teacher' ? { repeatedAbsences: [] } : {}),
    enrollmentsSlotHeldUntil: more.heldUntil === undefined ? HELD_UNTIL : more.heldUntil,
    banRestoreWindowDays: DAYS,
  };
}

const RECORDS: Readonly<Record<string, ReturnType<typeof recordOf>>> = {
  [STUDENT]: recordOf(STUDENT, { role: 'student', accountStatus: 'banned' }),
  [TEACHER]: recordOf(TEACHER, {
    role: 'teacher',
    accountStatus: 'banned',
    verificationStatus: 'banned',
  }),
  [REVOKED]: recordOf(REVOKED, {
    role: 'teacher',
    accountStatus: 'active',
    verificationStatus: 'revoked',
  }),
  [DELETED]: recordOf(DELETED, { role: 'student', accountStatus: 'banned', deleted: true }),
};

const OF_KIND: Readonly<Record<Kind, string>> = {
  studentBan: STUDENT,
  teacherBan: TEACHER,
  revocation: REVOKED,
};

function fakeApi(records = RECORDS) {
  const api = {
    users: { list: query(), get: query() },
    students: {
      suspend: mutation(),
      ban: mutation(),
      reinstate: mutation(),
      liftBan: mutation(),
    },
    teachers: { liftBan: mutation(), liftRevocation: mutation() },
    sessions: { monitor: { list: query(), get: query() } },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.users.list.query.mockResolvedValue({ items: [] });
  api.users.get.query.mockImplementation(async (input) => {
    const record = records[(input as { targetUserId: string }).targetUserId];
    if (record === undefined) throw refusal('NOT_FOUND');
    return record;
  });
  api.sessions.monitor.list.query.mockResolvedValue({ items: [] });
  api.home.summary.query.mockResolvedValue({
    queues: {
      applications: { open: 0, waitingOnApplicant: 0 },
      credentials: { open: 0, addedSubjects: 0 },
    },
    latestActions: [],
  });
  api.auth.me.query.mockResolvedValue({ adminId: id('99'), displayName: 'سارة', email: 'a@b.c' });
  return api;
}

type Api = ReturnType<typeof fakeApi>;

const verified = { token: 't', step: 'verified' } as const;

function open(userId: string, api: Api = fakeApi()) {
  return { ...renderApp({ at: `/users?user=${userId}`, session: verified, api }), api };
}

/** The lift's procedure of each kind on the fake client. */
function procedureOf(api: Api, kind: Kind) {
  if (kind === 'studentBan') return api.students.liftBan.mutate;
  return kind === 'teacherBan' ? api.teachers.liftBan.mutate : api.teachers.liftRevocation.mutate;
}

const BUTTON: Readonly<Record<Kind, MessageKey>> = {
  studentBan: 'admin.users.detail.liftBan',
  teacherBan: 'admin.users.detail.liftBan',
  revocation: 'admin.users.detail.liftRevocation',
};

const DRAWN: Readonly<
  Record<
    Kind,
    {
      readonly title: MessageKey;
      readonly reason: MessageKey;
      readonly effect: MessageKey;
      readonly kind: 'ban' | 'revocation';
      readonly done: MessageKey;
      readonly person: 'studentUserId' | 'teacherUserId';
    }
  >
> = {
  studentBan: {
    title: 'admin.users.lift.banTitle',
    reason: 'admin.users.lift.banReasonLabel',
    effect: 'admin.users.lift.studentBan',
    kind: 'ban',
    done: 'admin.users.lift.doneBan',
    person: 'studentUserId',
  },
  teacherBan: {
    title: 'admin.users.lift.banTitle',
    reason: 'admin.users.lift.banReasonLabel',
    effect: 'admin.users.lift.teacherBan',
    kind: 'ban',
    done: 'admin.users.lift.doneBan',
    person: 'teacherUserId',
  },
  revocation: {
    title: 'admin.users.lift.revocationTitle',
    reason: 'admin.users.lift.revocationReasonLabel',
    effect: 'admin.users.lift.revocation',
    kind: 'revocation',
    done: 'admin.users.lift.doneRevocation',
    person: 'teacherUserId',
  },
};

const KINDS: readonly Kind[] = ['studentBan', 'teacherBan', 'revocation'];

/** The record beside the list. */
async function record(t: Translate) {
  return within(await screen.findByRole('complementary', { name: t('admin.users.detail.a11y') }));
}

/** An instant in the panel's zone, as the page prints it. */
function at(t: Translate, locale: 'ar' | 'en', value: string): string {
  const zone = panelTimeZone();
  return t('admin.common.dateTime', {
    date: dayMonth(value, locale, zone),
    time: timeOfDay(value, locale, zone),
  });
}

async function openDialog(kind: Kind, t: Translate = ar, api: Api = fakeApi()) {
  const userId = OF_KIND[kind];
  open(userId, api);
  const panel = await record(t);
  fireEvent.click(await panel.findByRole('button', { name: t(BUTTON[kind]) }));
  return { api, dialog: await dialogFor(t, kind) };
}

/** The lift's dialog of `kind`, by its title. */
async function dialogFor(t: Translate, kind: Kind) {
  const name = RECORDS[OF_KIND[kind]]?.profile.displayName ?? '';
  const heading = await screen.findByRole('heading', {
    level: 2,
    name: t(DRAWN[kind].title, { name }),
  });
  return within(heading.closest('section.dialog') as HTMLElement);
}

/** Whether the lift's dialog of `kind` is closed. */
function closed(t: Translate, kind: Kind): boolean {
  const name = RECORDS[OF_KIND[kind]]?.profile.displayName ?? '';
  return screen.queryByRole('heading', { level: 2, name: t(DRAWN[kind].title, { name }) }) === null;
}

function confirmOf(dialog: ReturnType<typeof within>, t: Translate, kind: Kind) {
  return dialog
    .getAllByRole('button', { name: t(BUTTON[kind]) })
    .find(
      (button: HTMLElement) => button.closest('.dialog__actions') !== null,
    ) as HTMLButtonElement;
}

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

/** Never a ban or a revocation said to be final, in either language. */
const FINAL = /نهائي|لا يُرفع|لا يعود إلا|permanent|for good|not lifted|final|no return/iu;

describe('T075: the lift buttons on /users (FR-502)', () => {
  it.each([
    [STUDENT, ['admin.users.detail.liftBan']],
    [TEACHER, ['admin.users.detail.liftBan']],
    [REVOKED, ['admin.users.detail.liftRevocation']],
  ] as const)('the record of %s offers %j and no other lift', async (userId, shown) => {
    open(userId);
    const panel = await record(ar);
    await panel.findByText(`${userId.slice(-2)}@example.test`);
    for (const key of [
      'admin.users.detail.liftBan',
      'admin.users.detail.liftRevocation',
    ] as const) {
      const button = panel.queryByRole('button', { name: ar(key) });
      if ((shown as readonly string[]).includes(key)) expect(button).toBeTruthy();
      else expect(button).toBeNull();
    }
  });

  it('offers no lift on an active student, a deleted account, or a teacher neither banned nor revoked', async () => {
    const active = recordOf(STUDENT, { role: 'student', accountStatus: 'active' });
    const approved = recordOf(TEACHER, {
      role: 'teacher',
      accountStatus: 'suspended',
      verificationStatus: 'approved',
    });
    for (const [userId, records] of [
      [STUDENT, { ...RECORDS, [STUDENT]: active }],
      [TEACHER, { ...RECORDS, [TEACHER]: approved }],
      [DELETED, RECORDS],
    ] as const) {
      const { view } = open(userId, fakeApi(records));
      const panel = await record(ar);
      await panel.findByText(ar('admin.users.detail.account'));
      expect(panel.queryByRole('button', { name: ar('admin.users.detail.liftBan') })).toBeNull();
      expect(
        panel.queryByRole('button', { name: ar('admin.users.detail.liftRevocation') }),
      ).toBeNull();
      view.unmount();
    }
  });
});

describe('T075: the lift dialogs (FR-502, DEC-69)', () => {
  it.each(KINDS)(
    '%s says the enrollments come back, held until {when} for {days}, after that only where free, in both languages',
    async (kind) => {
      await inBothLocales(
        () => open(OF_KIND[kind]),
        async (t, locale) => {
          const panel = await record(t);
          fireEvent.click(await panel.findByRole('button', { name: t(BUTTON[kind]) }));
          const dialog = await dialogFor(t, kind);
          expect(dialog.getByText(t(DRAWN[kind].effect))).toBeTruthy();
          expect(
            dialog.getByText(
              t('admin.users.lift.enrollmentsHeld', {
                kind: DRAWN[kind].kind,
                days: DAYS,
                when: at(t, locale, HELD_UNTIL),
              }),
            ),
          ).toBeTruthy();
          const text =
            (await dialog.findByText(t(DRAWN[kind].effect))).closest('section.dialog')
              ?.textContent ?? '';
          expect(text).not.toMatch(FINAL);
        },
      );
    },
  );

  it('says no slot is held now when the record answers no hold, with the setting’s days', async () => {
    const records = {
      ...RECORDS,
      [STUDENT]: recordOf(STUDENT, { role: 'student', accountStatus: 'banned', heldUntil: null }),
    };
    await inBothLocales(
      () => open(STUDENT, fakeApi(records)),
      async (t) => {
        const panel = await record(t);
        fireEvent.click(
          await panel.findByRole('button', { name: t('admin.users.detail.liftBan') }),
        );
        const dialog = await dialogFor(t, 'studentBan');
        expect(
          dialog.getByText(t('admin.users.lift.enrollmentsNotHeld', { kind: 'ban', days: DAYS })),
        ).toBeTruthy();
      },
    );
  });

  it.each(KINDS)('%s sends nothing without a reason', async (kind) => {
    const { api, dialog } = await openDialog(kind);
    expect(confirmOf(dialog, ar, kind).disabled).toBe(true);
    type(dialog.getByLabelText(ar(DRAWN[kind].reason)), '   ');
    expect(confirmOf(dialog, ar, kind).disabled).toBe(true);
    fireEvent.click(confirmOf(dialog, ar, kind));
    await Promise.resolve();
    expect(procedureOf(api, kind)).not.toHaveBeenCalled();
  });

  it.each(KINDS)(
    '%s sends the person, the trimmed reason and the key minted when the dialog opened, the same key on a retry',
    async (kind) => {
      const api = fakeApi();
      procedureOf(api, kind)
        .mockRejectedValueOnce(refusal('INTERNAL'))
        .mockResolvedValueOnce({ enrollments: [] });
      const { dialog } = await openDialog(kind, ar, api);
      type(dialog.getByLabelText(ar(DRAWN[kind].reason)), '  خطأ في القرار ');
      fireEvent.click(confirmOf(dialog, ar, kind));
      expect(await dialog.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
      fireEvent.click(confirmOf(dialog, ar, kind));
      expect(await dialog.findByText(ar(DRAWN[kind].done))).toBeTruthy();
      const [first, second] = procedureOf(api, kind).mock.calls.map(([input]) => input);
      expect(first).toEqual({
        [DRAWN[kind].person]: OF_KIND[kind],
        reason: 'خطأ في القرار',
        idempotencyKey: expect.stringMatching(/^[\w-]{16,128}$/u),
      });
      expect(second).toEqual(first);
    },
  );

  it('a new dialog mints a new key', async () => {
    const api = fakeApi();
    api.students.liftBan.mutate.mockRejectedValue(refusal('INTERNAL'));
    const { dialog } = await openDialog('studentBan', ar, api);
    type(dialog.getByLabelText(ar('admin.users.lift.banReasonLabel')), 'سبب');
    fireEvent.click(confirmOf(dialog, ar, 'studentBan'));
    await dialog.findByText(ar('admin.dialogs.submitError'));
    fireEvent.click(
      dialog.getByRole('button', { name: ar('admin.dialogs.confirm.common.cancel') }),
    );
    await waitFor(() => expect(closed(ar, 'studentBan')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: ar('admin.users.detail.liftBan') }));
    const again = await dialogFor(ar, 'studentBan');
    type(again.getByLabelText(ar('admin.users.lift.banReasonLabel')), 'سبب');
    fireEvent.click(confirmOf(again, ar, 'studentBan'));
    await waitFor(() => expect(api.students.liftBan.mutate).toHaveBeenCalledTimes(2));
    const [first, second] = api.students.liftBan.mutate.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(second).not.toBe(first);
  });

  it('says each enrollment’s result in plain words, each linking to /sessions, and reads the record and the list again, in both languages', async () => {
    const causes = [
      ['not_restorable', 'notRestorable'],
      ['case_closed', 'caseClosed'],
      ['party_restricted', 'partyRestricted'],
      ['slot_inactive', 'slotInactive'],
      ['slot_changed', 'slotChanged'],
      ['slot_taken', 'slotTaken'],
      ['time_taken', 'timeTaken'],
      ['refunded', 'refunded'],
      ['gender_mismatch', 'genderMismatch'],
    ] as const;
    const enrollments = [
      { enrollmentId: E1, restored: true },
      ...causes.map(([cause], index) => ({
        enrollmentId: id(`f${index}`),
        restored: false,
        cause,
      })),
    ];
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.students.liftBan.mutate.mockResolvedValue({ enrollments });
        return open(STUDENT, api);
      },
      async (t) => {
        const panel = await record(t);
        fireEvent.click(
          await panel.findByRole('button', { name: t('admin.users.detail.liftBan') }),
        );
        const dialog = await dialogFor(t, 'studentBan');
        type(dialog.getByLabelText(t('admin.users.lift.banReasonLabel')), 'سبب');
        fireEvent.click(confirmOf(dialog, t, 'studentBan'));
        expect(await dialog.findByText(t('admin.users.lift.doneBan'))).toBeTruthy();
        const results = within(
          dialog.getByRole('list', { name: t('admin.users.lift.resultsTitle') }),
        );
        expect(results.getAllByRole('listitem')).toHaveLength(enrollments.length);
        expect(results.getByText(t('admin.users.lift.result.restored'))).toBeTruthy();
        for (const [, words] of causes) {
          expect(
            results.getByText(t(`admin.users.lift.result.${words}` as MessageKey)),
          ).toBeTruthy();
        }
        const links = results.getAllByRole('link', {
          name: t('admin.users.record.openEnrollment'),
        });
        expect(links.map((link) => link.getAttribute('href'))).toEqual(
          enrollments.map(({ enrollmentId }) => `/sessions?enrollment=${enrollmentId}`),
        );
      },
    );
  });

  it('reads the record and the list again once lifted, and closes on «إغلاق»', async () => {
    const api = fakeApi();
    api.students.liftBan.mutate.mockResolvedValue({
      enrollments: [{ enrollmentId: E2, restored: true }],
    });
    const { dialog } = await openDialog('studentBan', ar, api);
    const reads = api.users.get.query.mock.calls.length;
    const lists = api.users.list.query.mock.calls.length;
    type(dialog.getByLabelText(ar('admin.users.lift.banReasonLabel')), 'سبب');
    fireEvent.click(confirmOf(dialog, ar, 'studentBan'));
    await dialog.findByText(ar('admin.users.lift.doneBan'));
    await waitFor(() => {
      expect(api.users.get.query.mock.calls.length).toBeGreaterThan(reads);
      expect(api.users.list.query.mock.calls.length).toBeGreaterThan(lists);
    });
    expect(dialog.queryAllByRole('button', { name: ar('admin.users.detail.liftBan') })).toEqual([]);
    fireEvent.click(dialog.getByRole('button', { name: ar('admin.users.lift.close') }));
    await waitFor(() => expect(closed(ar, 'studentBan')).toBe(true));
    expect(api.students.liftBan.mutate).toHaveBeenCalledTimes(1);
  });

  it('says when the lift ended no enrollment', async () => {
    const api = fakeApi();
    api.teachers.liftRevocation.mutate.mockResolvedValue({ enrollments: [] });
    const { dialog } = await openDialog('revocation', ar, api);
    type(dialog.getByLabelText(ar('admin.users.lift.revocationReasonLabel')), 'سبب');
    fireEvent.click(confirmOf(dialog, ar, 'revocation'));
    expect(await dialog.findByText(ar('admin.users.lift.doneRevocation'))).toBeTruthy();
    expect(dialog.getByText(ar('admin.users.lift.noEnrollments'))).toBeTruthy();
  });
});

describe('T075: the lifts’ refusals in plain words (N11)', () => {
  it('says not_banned, not_revoked, restore_failed with its enrollment, a deadlock, a reused key, NOT_FOUND and RATE_LIMITED, in both languages, and any other failure in the generic words', async () => {
    const refusals = [
      [
        refusal('CONFLICT', [{ path: 'cause', code: 'not_banned' }]),
        'admin.users.lift.refused.notBanned',
      ],
      [
        refusal('CONFLICT', [{ path: 'cause', code: 'not_revoked' }]),
        'admin.users.lift.refused.notRevoked',
      ],
      [
        refusal('CONFLICT', [
          { path: 'cause', code: 'restore_failed' },
          { path: 'enrollmentId', code: E3 },
        ]),
        'admin.users.lift.refused.restoreFailed',
      ],
      [
        refusal('CONFLICT', [{ path: 'cause', code: 'restore_failed' }]),
        'admin.users.lift.refused.busy',
      ],
      [refusal('CONFLICT'), 'admin.shared.keyReused'],
      [refusal('NOT_FOUND'), 'admin.users.lift.refused.notFound'],
      [refusal('INTERNAL'), 'admin.dialogs.submitError'],
    ] as const;
    await inBothLocales(
      () => {
        const api = fakeApi();
        for (const [error] of refusals) api.teachers.liftBan.mutate.mockRejectedValueOnce(error);
        api.teachers.liftBan.mutate.mockRejectedValueOnce(
          refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
        );
        return open(TEACHER, api);
      },
      async (t) => {
        const panel = await record(t);
        fireEvent.click(
          await panel.findByRole('button', { name: t('admin.users.detail.liftBan') }),
        );
        const dialog = await dialogFor(t, 'teacherBan');
        type(dialog.getByLabelText(t('admin.users.lift.banReasonLabel')), 'سبب');
        for (const [, words] of refusals) {
          fireEvent.click(confirmOf(dialog, t, 'teacherBan'));
          expect(await dialog.findByText(t(words))).toBeTruthy();
          const link = dialog.queryByRole('link', {
            name: t('admin.users.lift.refused.openFailed'),
          });
          if (words === 'admin.users.lift.refused.restoreFailed') {
            expect(link?.getAttribute('href')).toBe(`/sessions?enrollment=${E3}`);
          } else {
            expect(link).toBeNull();
          }
        }
        fireEvent.click(confirmOf(dialog, t, 'teacherBan'));
        expect(await dialog.findByText(t('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
        expect(dialog.queryByText(t('admin.users.lift.doneBan'))).toBeNull();
      },
    );
  });

  it('the failed enrollment’s link opens it on /sessions', async () => {
    const api = fakeApi();
    api.students.liftBan.mutate.mockRejectedValue(
      refusal('CONFLICT', [
        { path: 'cause', code: 'restore_failed' },
        { path: 'enrollmentId', code: E3 },
      ]),
    );
    const { dialog } = await openDialog('studentBan', ar, api);
    type(dialog.getByLabelText(ar('admin.users.lift.banReasonLabel')), 'سبب');
    fireEvent.click(confirmOf(dialog, ar, 'studentBan'));
    fireEvent.click(
      await dialog.findByRole('link', { name: ar('admin.users.lift.refused.openFailed') }),
    );
    await waitFor(() => expect(currentPath()).toBe(`/sessions?enrollment=${E3}`));
  });
});

// T075's line: every word that called a ban or a revocation final is rewritten (the owner's
// decisions of 2026-11-12; lines on develop `35512ed1` in the conflict check's §5), drawn by a page
// or not (`banDisputeParty.*` and `genderBan.*` are drawn by none).
describe('T075: no word says a ban or a revocation is final, in either catalogue', () => {
  const REWRITTEN = [
    'admin.dialogs.confirm.banDisputeParty.effects.banned',
    'admin.dialogs.confirm.genderBan.effects.banned',
    'admin.dialogs.decision.ban.banner',
    'admin.dialogs.suspendStudent.ban.effects.noSignIn',
    'admin.dialogs.suspendStudent.honest.ban.sessions',
    'admin.dialogs.suspendStudent.kinds.ban',
    'admin.dialogs.suspendTeacher.ban.effects.banned',
    'admin.dialogs.suspendTeacher.honest.ban',
    'admin.dialogs.suspendTeacher.revoke.effects.lost',
  ] as const;

  const valueOf = (catalogue: unknown, key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        catalogue,
      );

  it.each(REWRITTEN)('%s says the ban or the revocation can be lifted at any time', (key) => {
    for (const [catalogue, lifted] of [
      [arCatalogue, /في أي وقت/u],
      [enCatalogue, /at any time/u],
    ] as const) {
      const words = valueOf(catalogue, key);
      expect(typeof words).toBe('string');
      expect(words).not.toMatch(FINAL);
      expect(words).toMatch(lifted);
    }
  });

  it.each([
    'admin.dialogs.confirm.banDisputeParty.effects.banned',
    'admin.dialogs.confirm.genderBan.effects.banned',
    'admin.dialogs.suspendStudent.honest.ban.sessions',
    'admin.dialogs.suspendTeacher.ban.effects.banned',
    'admin.dialogs.suspendTeacher.honest.ban',
  ] as const)(
    '%s says the enrollments come back, surely within {days} days, after that where free',
    (key) => {
      for (const locale of ['ar', 'en'] as const) {
        const words = translate(locale, key, { days: 9, role: 'x' });
        expect(words).toContain('9');
        expect(words).toMatch(locale === 'ar' ? /خاليًا/u : /still free/u);
      }
    },
  );
});
