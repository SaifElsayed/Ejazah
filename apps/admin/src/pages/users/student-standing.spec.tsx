// T051 (FR-486, FR-ADMIN-5; contracts/admin-surface.md "`students`"): a student's standing dialogs,
// suspend, ban and reinstate, each with a mandatory reason, over `students.*` (T005). Each says what
// the server does now and nothing a board draws beyond it: no counts, no notification, never that a
// ban is final (the note under T051, Q1 (a) and Q2). `/users` has no route until T058, whose buttons
// open them, so the dialogs are drawn here directly, inside the App's providers and the console frame.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Console } from '../../design/components';
import { setLocale, type MessageKey } from '../../i18n';
import { AdminProvider } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';
import { createSessionStore } from '../../lib/session';
import { inBothLocales, mutation, refusal, type Translate } from '../../test/app-harness';
import { StudentStandingDialog, type StudentStandingKind } from './StudentStandingDialogs';

afterEach(() => setLocale('ar'));

const STUDENT = {
  studentUserId: '0193a6f0-0000-7000-8000-0000000000b1',
  displayName: 'عبد الله حسن',
} as const;

const KINDS: readonly StudentStandingKind[] = ['suspend', 'ban', 'reinstate'];

/** B42b, T075 (Q-O2 (a)): `users.get`'s `banRestoreWindowDays`, unlike the seed's 14. */
const DAYS = 21;

/** The values a dialog's effect interpolates: the ban's `{days}` (T075). */
const valuesOf = (key: MessageKey) =>
  key === 'admin.dialogs.suspendStudent.honest.ban.sessions' ? { days: DAYS } : undefined;

const DRAWN: Readonly<
  Record<
    StudentStandingKind,
    {
      readonly title: MessageKey;
      readonly confirm: MessageKey;
      readonly reason: MessageKey;
      readonly effects: readonly MessageKey[];
    }
  >
> = {
  suspend: {
    title: 'admin.dialogs.suspendStudent.title',
    confirm: 'admin.dialogs.suspendStudent.confirm',
    reason: 'admin.dialogs.suspendStudent.reasonLabel',
    effects: [
      'admin.dialogs.suspendStudent.honest.suspend.account',
      'admin.dialogs.suspendStudent.honest.suspend.sessions',
      'admin.dialogs.suspendStudent.honest.suspend.enrollments',
      'admin.dialogs.suspendStudent.honest.suspend.remedies',
    ],
  },
  ban: {
    title: 'admin.dialogs.suspendStudent.ban.title',
    confirm: 'admin.dialogs.suspendStudent.ban.confirm',
    reason: 'admin.dialogs.suspendStudent.ban.reasonLabel',
    effects: [
      'admin.dialogs.suspendStudent.honest.ban.account',
      'admin.dialogs.suspendStudent.honest.ban.sessions',
      'admin.dialogs.suspendStudent.honest.ban.cases',
    ],
  },
  reinstate: {
    title: 'admin.dialogs.confirm.reactivateAccount.title',
    confirm: 'admin.dialogs.confirm.reactivateAccount.confirm',
    reason: 'admin.dialogs.confirm.reactivateAccount.reasonLabel',
    effects: [
      'admin.dialogs.suspendStudent.honest.reinstate.account',
      'admin.dialogs.suspendStudent.honest.reinstate.cancelled',
      'admin.dialogs.suspendStudent.honest.reinstate.remedies',
    ],
  },
};

/** The board's words a dialog never says: counts, a notification, a ban called final (Q1, Q2). */
const BOARD_ONLY: readonly MessageKey[] = [
  'admin.dialogs.suspendStudent.ban.effects.noSignIn',
  'admin.dialogs.suspendStudent.kinds.ban',
  'admin.dialogs.suspendStudent.kinds.suspend',
  'admin.dialogs.suspendStudent.effects.noJoin',
  'admin.dialogs.suspendStudent.ban.effects.noCompensationBefore',
  'admin.dialogs.suspendStudent.ban.kept.recordText',
  'admin.dialogs.confirm.reactivateAccount.effects.reinstated',
  'admin.dialogs.confirm.reactivateAccount.effects.sessions',
];

/** Never in any dialog, in either language: a ban, or anything, said to be final. */
const FINAL = /نهائي|لا يُرفع|permanent|for good|not lifted|final/i;

function fakeApi() {
  return { students: { suspend: mutation(), ban: mutation(), reinstate: mutation() } };
}

type Api = ReturnType<typeof fakeApi>;

let current: {
  readonly api: Api;
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly onDone: ReturnType<typeof vi.fn>;
};

/** One dialog of `kind`, drawn in the console frame under the App's providers. */
function open(kind: StudentStandingKind, api: Api = fakeApi()) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const sessions = createSessionStore(() => window.sessionStorage);
  const client = {
    api: api as unknown as AdminClient['api'],
    untyped: {} as AdminClient['untyped'],
    signOut: vi.fn(async () => sessions.clear()),
  };
  const queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queries}>
      <AdminProvider services={{ client, sessions }}>
        <Console>
          <StudentStandingDialog
            kind={kind}
            student={STUDENT}
            banRestoreWindowDays={DAYS}
            onClose={onClose}
            onDone={onDone}
          />
        </Console>
      </AdminProvider>
    </QueryClientProvider>,
  );
  current = { api, onClose, onDone };
  return { view };
}

async function dialogOf(t: Translate, kind: StudentStandingKind) {
  const heading = await screen.findByRole('heading', {
    level: 2,
    name: t(DRAWN[kind].title, { name: STUDENT.displayName }),
  });
  return within(heading.closest('section.dialog') as HTMLElement);
}

function confirmOf(dialog: ReturnType<typeof within>, t: Translate, kind: StudentStandingKind) {
  return dialog.getByRole('button', { name: t(DRAWN[kind].confirm) }) as HTMLButtonElement;
}

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

describe('a student’s standing dialogs (T051, FR-486)', () => {
  it.each(KINDS)(
    '%s sends its procedure with the student’s id and the trimmed reason, in both languages',
    async (kind) => {
      await inBothLocales(
        () => open(kind),
        async (t) => {
          const { api, onDone, onClose } = current;
          api.students[kind].mutate.mockResolvedValue(undefined);
          const dialog = await dialogOf(t, kind);
          type(dialog.getByLabelText(t(DRAWN[kind].reason)), '  مخالفة متكررة للآداب ');
          fireEvent.click(confirmOf(dialog, t, kind));
          await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
          expect(api.students[kind].mutate).toHaveBeenCalledTimes(1);
          expect(api.students[kind].mutate).toHaveBeenCalledWith({
            studentUserId: STUDENT.studentUserId,
            reason: 'مخالفة متكررة للآداب',
          });
          for (const other of KINDS.filter((each) => each !== kind)) {
            expect(api.students[other].mutate).not.toHaveBeenCalled();
          }
          expect(onClose).not.toHaveBeenCalled();
        },
      );
    },
  );

  it.each(KINDS)('%s sends nothing without a reason, in both languages', async (kind) => {
    await inBothLocales(
      () => open(kind),
      async (t) => {
        const { api, onDone, onClose } = current;
        api.students[kind].mutate.mockResolvedValue(undefined);
        const dialog = await dialogOf(t, kind);
        expect(confirmOf(dialog, t, kind).disabled).toBe(true);
        fireEvent.click(confirmOf(dialog, t, kind));
        type(dialog.getByLabelText(t(DRAWN[kind].reason)), '   ');
        expect(confirmOf(dialog, t, kind).disabled).toBe(true);
        fireEvent.click(confirmOf(dialog, t, kind));
        fireEvent.click(
          dialog.getByRole('button', { name: t('admin.dialogs.suspendStudent.cancel') }),
        );
        expect(onClose).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        for (const each of KINDS) expect(api.students[each].mutate).not.toHaveBeenCalled();
        expect(onDone).not.toHaveBeenCalled();
      },
    );
  });

  it.each(KINDS)(
    '%s says what it does now, and nothing the board adds or calls final, in both languages',
    async (kind) => {
      await inBothLocales(
        () => open(kind),
        async (t) => {
          const dialog = await dialogOf(t, kind);
          for (const key of DRAWN[kind].effects) {
            expect(dialog.getByText(t(key, valuesOf(key)))).toBeTruthy();
          }
          for (const other of KINDS.filter((each) => each !== kind)) {
            for (const key of DRAWN[other].effects) {
              expect(dialog.queryByText(t(key, valuesOf(key)))).toBeNull();
            }
          }
          for (const key of BOARD_ONLY) expect(dialog.queryByText(t(key))).toBeNull();
          const section = dialog.getByRole('heading', { level: 2 }).closest('section.dialog');
          expect(section?.textContent ?? '').not.toMatch(FINAL);
        },
      );
    },
  );

  it.each(KINDS)(
    '%s says a refusal with the generic error, and sends again, in both languages',
    async (kind) => {
      await inBothLocales(
        () => open(kind),
        async (t) => {
          const { api, onDone } = current;
          api.students[kind].mutate.mockRejectedValueOnce(refusal('CONFLICT'));
          api.students[kind].mutate.mockResolvedValueOnce(undefined);
          const dialog = await dialogOf(t, kind);
          type(dialog.getByLabelText(t(DRAWN[kind].reason)), 'سبب واضح');
          fireEvent.click(confirmOf(dialog, t, kind));
          expect(await dialog.findByText(t('admin.dialogs.submitError'))).toBeTruthy();
          expect(onDone).not.toHaveBeenCalled();
          fireEvent.click(confirmOf(dialog, t, kind));
          await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
          expect(api.students[kind].mutate).toHaveBeenCalledTimes(2);
          expect(api.students[kind].mutate).toHaveBeenLastCalledWith({
            studentUserId: STUDENT.studentUserId,
            reason: 'سبب واضح',
          });
        },
      );
    },
  );
});

// B42b, T075 of specs/004-sessions (DEC-66, DEC-69; the note under T075, Q-O2 (a)): the ban holds
// each enrollment's slot for `ban_restore_window_days`, read from `users.get`, and can be lifted
// at any time.
describe('T075: the ban’s words', () => {
  it('says each slot is held for the setting’s days and the ban can be lifted at any time, in both languages', async () => {
    await inBothLocales(
      () => open('ban'),
      async (t, locale) => {
        const dialog = await dialogOf(t, 'ban');
        const words = dialog.getByText(
          t('admin.dialogs.suspendStudent.honest.ban.sessions', { days: DAYS }),
        );
        expect(words.textContent).toContain('21');
        expect(words.textContent).toMatch(locale === 'ar' ? /في أي وقت/u : /at any time/u);
      },
    );
  });
});

describe('T058: RATE_LIMITED on a student’s standing', () => {
  it.each(KINDS)('%s says when to try again, in both languages, calling no onDone', async (kind) => {
    await inBothLocales(
      () => open(kind),
      async (t) => {
        const { api, onDone } = current;
        api.students[kind].mutate.mockRejectedValue(
          refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
        );
        const dialog = await dialogOf(t, kind);
        type(dialog.getByLabelText(t(DRAWN[kind].reason)), 'سبب واضح');
        fireEvent.click(confirmOf(dialog, t, kind));
        expect(await dialog.findByText(t('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
        expect(dialog.queryByText(t('admin.dialogs.submitError'))).toBeNull();
        expect(onDone).not.toHaveBeenCalled();
      },
    );
  });
});
