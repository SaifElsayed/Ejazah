// 005:T023 (B49; FR-613, FR-615 to FR-617; DEC-69; the note under T023, Q-R1 (a), Q-G1 (b), Q-I1
// (a)): the gender flags through the router, in both languages. The queue opens on the open flags;
// each row with its flagged person and its raiser as links to their records (`/users?user=`), or
// the administrator's words when one raised it, its date and its status (`fraud_ban` among them).
// A flag's detail at `?flag=`: the raiser's words, the report it came from, and the decisions while
// it is open: the dismissal with a reason; the correction, whose dialog draws each enrollment it
// ends (`enrollmentLine`, a link to `/sessions?enrollment=`) and, below them, that they can never be
// restored (FR-616, DEC-69); the fraud ban with the applicant's note (Q-G5 (b)). An administrator
// raises a flag on a person by their account's id. Each refusal of the contract in its own words.
// `sessions.restore`'s `gender_mismatch` in its own words (the follow-up under T023).
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
import { restoreFailure } from '../sessions/words';

afterEach(() => {
  setLocale('ar');
});

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const F1 = '0193a6f0-0000-7000-8000-0000000004f1';
const F2 = '0193a6f0-0000-7000-8000-0000000004f2';
const FLAGGED = '0193a6f0-0000-7000-8000-0000000004a1';
const RAISER = '0193a6f0-0000-7000-8000-0000000004a2';
const OTHER = '0193a6f0-0000-7000-8000-0000000004a3';
const REPORT = '0193a6f0-0000-7000-8000-0000000004c1';
const E1 = '0193a6f0-0000-7000-8000-0000000004e1';
const E2 = '0193a6f0-0000-7000-8000-0000000004e2';
const C1 = '0193a6f0-0000-7000-8000-0000000004b1';
const C2 = '0193a6f0-0000-7000-8000-0000000004b2';
const ADMIN = '0193a6f0-0000-7000-8000-000000000499';
const REASON = 'المستخدمة تقول إنها أُدرجت معلمًا بالخطأ';
const TAJWEED = {
  id: '0193a6f0-0000-7000-8000-0000000004d1',
  nameAr: 'التجويد',
  nameEn: 'Tajweed',
};
const HIFZ = {
  id: '0193a6f0-0000-7000-8000-0000000004d2',
  nameAr: 'الحفظ',
  nameEn: 'Memorisation',
};

const openFlag = {
  flagId: F1,
  flaggedUserId: FLAGGED,
  raisedByUserId: RAISER,
  reportId: null,
  status: 'open',
  createdAt: '2026-11-18T09:00:00.000Z',
} as const;
const fraudFlag = {
  ...openFlag,
  flagId: F2,
  raisedByUserId: null,
  reportId: REPORT,
  status: 'fraud_ban',
} as const;

const LINES = [
  {
    enrollmentId: E1,
    subject: TAJWEED,
    sessions: 8,
    counterpart: { userId: C1, displayName: 'فاطمة علي' },
  },
  { enrollmentId: E2, subject: HIFZ, sessions: 4, counterpart: { userId: C2, displayName: null } },
];

function fakeApi() {
  const api = {
    genderFlags: {
      list: query(),
      get: query(),
      raise: mutation(),
      dismiss: mutation(),
      correct: mutation(),
      fraudBan: mutation(),
    },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.genderFlags.list.query.mockResolvedValue({ items: [openFlag, fraudFlag] });
  api.genderFlags.get.query.mockImplementation(async (input) =>
    (input as { flagId: string }).flagId === F1
      ? {
          ...openFlag,
          reason: REASON,
          resolution: null,
          correctionWouldEnd: {
            count: 2,
            enrollmentIds: LINES.map(({ enrollmentId }) => enrollmentId),
            lines: LINES,
          },
        }
      : {
          ...fraudFlag,
          reason: REASON,
          resolution: {
            outcome: 'fraud_ban',
            note: 'الوثائق تثبت التزوير',
            resolvedAt: '2026-11-18T12:00:00.000Z',
            resolvedByAdminId: ADMIN,
          },
          correctionWouldEnd: { count: 0, enrollmentIds: [], lines: [] },
        },
  );
  api.genderFlags.raise.mutate.mockResolvedValue({ flagId: F1 });
  api.genderFlags.dismiss.mutate.mockResolvedValue(undefined);
  api.genderFlags.correct.mutate.mockResolvedValue({ endedEnrollments: 2 });
  api.genderFlags.fraudBan.mutate.mockResolvedValue(undefined);
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

function open(api = fakeApi(), at = '/gender') {
  return { ...renderApp({ at, session: verified, api }), api };
}

/** The flag's detail beside the list, once read. */
async function detailPanel(t: Translate = ar) {
  const aside = await screen.findByRole('complementary', { name: t('admin.gender.detail.a11y') });
  await within(aside).findByText(REASON);
  return within(aside);
}

/** Presses `button`, writes the reason (and `note` under `noteLabel`), and confirms. */
async function decide(
  button: MessageKey,
  reasonLabel: MessageKey,
  confirm: MessageKey,
  t: Translate = ar,
  note?: { readonly label: MessageKey; readonly value: string },
) {
  const panel = await detailPanel(t);
  fireEvent.click(panel.getByRole('button', { name: t(button) }));
  const opened = within(await screen.findByRole('dialog'));
  fireEvent.change(opened.getByLabelText(t(reasonLabel)), {
    target: { value: '  الوثائق تثبت الخطأ  ' },
  });
  if (note !== undefined) {
    fireEvent.change(opened.getByLabelText(t(note.label)), { target: { value: note.value } });
  }
  fireEvent.click(opened.getByRole('button', { name: t(confirm) }));
  return opened;
}

describe('the gender flags queue (FR-615)', () => {
  it('opens on the open flags: each person a link to their record, the raiser, the status, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const table = within(await screen.findByRole('table'));
        expect(
          screen.getByRole('heading', { level: 1, name: t('admin.gender.title') }),
        ).toBeTruthy();
        expect(
          screen
            .getByRole('tab', { name: t('admin.gender.tabs.open') })
            .getAttribute('aria-selected'),
        ).toBe('true');
        expect(
          table.getAllByRole('link', { name: FLAGGED }).map((link) => link.getAttribute('href')),
        ).toEqual([`/users?user=${FLAGGED}`, `/users?user=${FLAGGED}`]);
        expect(table.getByRole('link', { name: RAISER }).getAttribute('href')).toBe(
          `/users?user=${RAISER}`,
        );
        expect(table.getByText(t('admin.gender.detail.raisedByAdmin'))).toBeTruthy();
        expect(table.getByText(t('admin.status.genderFlag.open'))).toBeTruthy();
        expect(table.getByText(t('admin.status.genderFlag.fraudBan'))).toBeTruthy();
      },
    );
  });

  it('reads the open flags first, then each status by its tab', async () => {
    const { api } = open();
    await screen.findByRole('table');
    expect(api.genderFlags.list.query).toHaveBeenLastCalledWith({ status: 'open' });
    fireEvent.click(screen.getByRole('tab', { name: ar('admin.gender.tabs.fraudBan') }));
    await waitFor(() =>
      expect(api.genderFlags.list.query).toHaveBeenLastCalledWith({ status: 'fraud_ban' }),
    );
  });
});

describe('the correction dialog (FR-616, DEC-69; Q-G1 (b))', () => {
  it('draws each enrollment it ends as a link to it, then that they can never be restored, in both languages', async () => {
    await inBothLocales(
      () => open(fakeApi(), `/gender?flag=${F1}`),
      async (t, locale) => {
        const panel = await detailPanel(t);
        expect(
          panel.getByText(t('admin.gender.detail.affectedEnrollments', { count: 2 })),
        ).toBeTruthy();
        fireEvent.click(panel.getByRole('button', { name: t('admin.gender.detail.correct') }));
        const dialog = within(await screen.findByRole('dialog'));
        const lineOf = (index: 0 | 1, counterpart: string) =>
          t('admin.gender.detail.enrollmentLine', {
            subject:
              locale === 'ar'
                ? (LINES[index]?.subject.nameAr ?? '')
                : (LINES[index]?.subject.nameEn ?? ''),
            sessions: t('admin.common.sessions', { count: LINES[index]?.sessions ?? 0 }),
            counterpart,
          });
        expect(
          dialog.getByRole('link', { name: lineOf(0, 'فاطمة علي') }).getAttribute('href'),
        ).toBe(`/sessions?enrollment=${E1}`);
        expect(
          dialog
            .getByRole('link', { name: lineOf(1, t('admin.users.directory.deletedAccount')) })
            .getAttribute('href'),
        ).toBe(`/sessions?enrollment=${E2}`);
        expect(dialog.getByText(t('admin.gender.detail.neverRestored'))).toBeTruthy();
      },
    );
  });

  it('corrects the flag with its reason, trimmed, once with a key', async () => {
    const { api } = open(fakeApi(), `/gender?flag=${F1}`);
    await decide(
      'admin.gender.detail.correct',
      'admin.dialogs.confirm.genderCorrect.reasonLabel',
      'admin.dialogs.confirm.genderCorrect.confirm',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.genderFlags.correct.mutate).toHaveBeenCalledTimes(1);
    expect(api.genderFlags.correct.mutate).toHaveBeenCalledWith({
      flagId: F1,
      reason: 'الوثائق تثبت الخطأ',
      idempotencyKey: expect.any(String),
    });
  });
});

describe('the other decisions (FR-615, FR-617; Q-G5 (b))', () => {
  it('dismisses the flag with its reason and a key', async () => {
    const { api } = open(fakeApi(), `/gender?flag=${F1}`);
    await decide(
      'admin.gender.detail.dismiss',
      'admin.dialogs.confirm.dismissGenderFlag.reasonLabel',
      'admin.dialogs.confirm.dismissGenderFlag.confirm',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.genderFlags.dismiss.mutate).toHaveBeenCalledWith({
      flagId: F1,
      reason: 'الوثائق تثبت الخطأ',
      idempotencyKey: expect.any(String),
    });
  });

  it('bans for fraud with the applicant’s note, and without one when none is written', async () => {
    const { api } = open(fakeApi(), `/gender?flag=${F1}`);
    await decide(
      'admin.gender.detail.ban',
      'admin.dialogs.confirm.genderBan.reasonLabel',
      'admin.dialogs.confirm.genderBan.confirm',
      ar,
      { label: 'admin.gender.detail.applicantNoteLabel', value: ' رُفض طلبك ' },
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.genderFlags.fraudBan.mutate).toHaveBeenCalledWith({
      flagId: F1,
      reason: 'الوثائق تثبت الخطأ',
      applicantNote: 'رُفض طلبك',
      idempotencyKey: expect.any(String),
    });
    await decide(
      'admin.gender.detail.ban',
      'admin.dialogs.confirm.genderBan.reasonLabel',
      'admin.dialogs.confirm.genderBan.confirm',
    );
    await waitFor(() => expect(api.genderFlags.fraudBan.mutate).toHaveBeenCalledTimes(2));
    expect(api.genderFlags.fraudBan.mutate).toHaveBeenLastCalledWith({
      flagId: F1,
      reason: 'الوثائق تثبت الخطأ',
      idempotencyKey: expect.any(String),
    });
  });

  it('shows a decided flag’s decision and the report it came from, and offers no decision', async () => {
    open(fakeApi(), `/gender?flag=${F2}`);
    const panel = await detailPanel();
    expect(panel.getByText('الوثائق تثبت التزوير')).toBeTruthy();
    expect(
      panel.getByRole('link', { name: ar('admin.gender.detail.openReport') }).getAttribute('href'),
    ).toBe(`/reports?report=${REPORT}`);
    expect(panel.queryByRole('button', { name: ar('admin.gender.detail.correct') })).toBeNull();
    expect(panel.queryByRole('button', { name: ar('admin.gender.detail.dismiss') })).toBeNull();
  });

  it.each([
    ['correct', 'already_resolved', 'admin.gender.refused.alreadyResolved'],
    ['fraudBan', 'applicant_note_required', 'admin.gender.refused.applicantNoteRequired'],
    ['dismiss', 'already_resolved', 'admin.gender.refused.alreadyResolved'],
  ] as const)('says a refused %s `%s` in its own words', async (procedure, code, words) => {
    const api = fakeApi();
    api.genderFlags[procedure].mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'flagId', code }]),
    );
    open(api, `/gender?flag=${F1}`);
    const opened =
      procedure === 'correct'
        ? await decide(
            'admin.gender.detail.correct',
            'admin.dialogs.confirm.genderCorrect.reasonLabel',
            'admin.dialogs.confirm.genderCorrect.confirm',
          )
        : procedure === 'fraudBan'
          ? await decide(
              'admin.gender.detail.ban',
              'admin.dialogs.confirm.genderBan.reasonLabel',
              'admin.dialogs.confirm.genderBan.confirm',
            )
          : await decide(
              'admin.gender.detail.dismiss',
              'admin.dialogs.confirm.dismissGenderFlag.reasonLabel',
              'admin.dialogs.confirm.dismissGenderFlag.confirm',
            );
    expect(await opened.findByText(ar(words))).toBeTruthy();
  });

  it('says a flag not found in its own words', async () => {
    const api = fakeApi();
    api.genderFlags.dismiss.mutate.mockRejectedValue(refusal('NOT_FOUND'));
    open(api, `/gender?flag=${F1}`);
    const opened = await decide(
      'admin.gender.detail.dismiss',
      'admin.dialogs.confirm.dismissGenderFlag.reasonLabel',
      'admin.dialogs.confirm.dismissGenderFlag.confirm',
    );
    expect(await opened.findByText(ar('admin.gender.refused.notFound'))).toBeTruthy();
  });
});

describe('an administrator raises a flag (FR-614)', () => {
  /** Opens the raise dialog, writes the person's id and the reason, and confirms. */
  async function raise(target: string) {
    fireEvent.click(await screen.findByRole('button', { name: ar('admin.gender.raise') }));
    const opened = within(await screen.findByRole('dialog'));
    fireEvent.change(opened.getByLabelText(ar('admin.gender.raiseTargetLabel')), {
      target: { value: target },
    });
    fireEvent.change(
      opened.getByLabelText(ar('admin.dialogs.confirm.raiseGenderFlag.reasonLabel')),
      { target: { value: ' شكوى متكررة ' } },
    );
    return opened;
  }

  it('raises one on the person by their account’s id, with a reason and a key, and no report', async () => {
    const { api } = open();
    const opened = await raise(` ${OTHER} `);
    fireEvent.click(
      opened.getByRole('button', { name: ar('admin.dialogs.confirm.raiseGenderFlag.confirm') }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.genderFlags.raise.mutate).toHaveBeenCalledWith({
      targetUserId: OTHER,
      reason: 'شكوى متكررة',
      idempotencyKey: expect.any(String),
    });
  });

  it('sends nothing until the id is an account’s id, and says an open flag in its own words', async () => {
    const api = fakeApi();
    api.genderFlags.raise.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'targetUserId', code: 'open_exists' }]),
    );
    open(api);
    const opened = await raise('not-an-id');
    const confirm = opened.getByRole('button', {
      name: ar('admin.dialogs.confirm.raiseGenderFlag.confirm'),
    });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(opened.getByLabelText(ar('admin.gender.raiseTargetLabel')), {
      target: { value: OTHER },
    });
    fireEvent.click(confirm);
    expect(await opened.findByText(ar('admin.gender.refused.openExists'))).toBeTruthy();
  });
});

describe('the restore’s gender_mismatch (the follow-up under T023)', () => {
  it('is said in its own words, in both languages', () => {
    const failure = restoreFailure(
      refusal('RESTORE_REFUSED', [{ path: 'cause', code: 'gender_mismatch' }]),
    );
    expect(failure).toEqual({ key: 'admin.sessions.restore.refused.genderMismatch' });
    // Worded as the lift's result, then the restore's «nothing changed».
    for (const locale of ['ar', 'en'] as const) {
      const words = translate(locale, failure.key);
      expect(words.startsWith(translate(locale, 'admin.users.lift.result.genderMismatch'))).toBe(
        true,
      );
      expect(
        words.endsWith(
          translate(locale, 'admin.sessions.restore.refused.notFound').split('. ').at(-1) ?? '',
        ),
      ).toBe(true);
    }
  });
});
