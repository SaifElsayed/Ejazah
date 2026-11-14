// T050 (FR-478, FR-486, FR-453, FR-422; R-313, R-322; admin-surface.md, `cases.resolve`,
// `cases.dismiss`, `cases.decideComplaint`): closing a case and deciding a complaint from a case's
// page, through the router, in both languages. Resolve and dismiss, each with a mandatory note and
// what it does in plain words, a `student_suspended` case's two outcomes in particular; their
// refusals by code and cause (`STUDENT_SUSPENDED`, `CONFLICT` `not_open` and `no_free_week`,
// `NOT_FOUND`), any other failure in the generic words. A complaint's three-way decision, each
// with a mandatory note and its effect; `CONFLICT` `enrollment_not_confirmed` and `NOT_FOUND` in
// plain words; the answer's new case linked when present. Nothing says a closing is final.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import {
  currentPath,
  inBothLocales,
  mutation,
  query,
  refusal,
  renderApp,
  type Translate,
} from '../../test/app-harness';
import { closingFailure } from './words';

afterEach(() => setLocale('ar'));

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);

const id = (n: number) => `0193a6f0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const ENROLLMENT = id(901);
const CASE = id(11);
const COMPLAINT = id(12);
const NEW_CASE = id(13);
const ADMIN = id(99);

const parties = {
  student: { userId: id(51), displayName: 'عبد الله حسن', deleted: false },
  teacher: { userId: id(52), displayName: 'Sara Adel', deleted: false },
};

function caseDetail(reason: string) {
  return {
    case: {
      caseId: CASE,
      kind: 'compensation_case',
      enrollmentId: ENROLLMENT,
      reason,
      status: 'open',
      openedAt: '2026-11-10T09:00:00.000Z',
    },
    enrollment: {
      enrollmentId: ENROLLMENT,
      ...parties,
      status: 'confirmed',
      track: 'recitation',
      teacherNoShows: 1,
      repeatedAbsence: false,
    },
    covers: [],
    paymentsLink: { enrollmentId: ENROLLMENT },
  };
}

const complaintDetail = {
  case: {
    caseId: COMPLAINT,
    kind: 'absence_complaint',
    enrollmentId: ENROLLMENT,
    status: 'open',
    openedAt: '2026-11-08T09:00:00.000Z',
  },
  complaint: { reason: 'غاب المعلم مرارًا', raisedAt: '2026-11-08T09:00:00.000Z' },
  enrollment: {
    enrollmentId: ENROLLMENT,
    ...parties,
    status: 'confirmed',
    track: 'recitation',
    teacherNoShows: 3,
    repeatedAbsence: false,
  },
  covers: [],
  paymentsLink: { enrollmentId: ENROLLMENT },
};

function fakeApi(reason = 'student_suspended') {
  const api = {
    cases: {
      list: query(),
      get: query(),
      resolve: mutation(),
      dismiss: mutation(),
      decideComplaint: mutation(),
      openManual: mutation(),
    },
    disputes: { heldFiles: query(), heldFileLink: mutation() },
    home: { summary: query() },
    auth: { me: query() },
  };
  api.cases.list.query.mockResolvedValue({ items: [] });
  api.cases.get.query.mockImplementation(async (input) =>
    (input as { caseId: string }).caseId === COMPLAINT ? complaintDetail : caseDetail(reason),
  );
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

type Api = ReturnType<typeof fakeApi>;
let current: { readonly api: Api };

const verified = { token: 't', step: 'verified' } as const;

function open(api: Api = fakeApi(), caseId = CASE) {
  current = { api };
  return { ...renderApp({ at: `/cases?case=${caseId}`, session: verified, api }), api };
}

/** Lets a press's mutation, if one was started, reach the client before a "nothing sent" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

/** Never in a dialog: anything, a ban or a closing, said to be final. */
const FINAL = /نهائي|لا يُرفع|permanent|for good|not lifted|final/i;

type Closing = 'resolve' | 'dismiss';

const CLOSING: Readonly<
  Record<Closing, { readonly button: MessageKey; readonly title: MessageKey }>
> = {
  resolve: { button: 'admin.cases.action.resolve', title: 'admin.cases.close.resolve.title' },
  dismiss: { button: 'admin.cases.action.dismiss', title: 'admin.cases.close.dismiss.title' },
};

/** What each closing says, by the case's reason. */
const SUSPENDED_EFFECTS: Readonly<Record<Closing, readonly MessageKey[]>> = {
  resolve: [
    'admin.cases.close.suspended.resolve.effect',
    'admin.cases.close.suspended.resolve.ended',
    'admin.cases.close.suspended.resolve.reinstate',
  ],
  dismiss: [
    'admin.cases.close.suspended.dismiss.effect',
    'admin.cases.close.suspended.dismiss.ended',
  ],
};
const ORDINARY_EFFECTS: Readonly<Record<Closing, readonly MessageKey[]>> = {
  resolve: ['admin.cases.close.resolve.effect'],
  dismiss: ['admin.cases.close.dismiss.effect'],
};

async function dialogTitled(t: Translate, title: MessageKey) {
  const heading = await screen.findByRole('heading', { level: 2, name: t(title) });
  return within(heading.closest('section.dialog') as HTMLElement);
}

/** Presses `button` on the case's panel and answers its dialog. */
async function press(t: Translate, button: MessageKey, title: MessageKey) {
  const aside = await screen.findByRole('complementary', { name: t('admin.cases.detail.a11y') });
  fireEvent.click(await within(aside).findByRole('button', { name: t(button) }));
  return dialogTitled(t, title);
}

const closingConfirm = (dialog: ReturnType<typeof within>, t: Translate, kind: Closing) =>
  dialog.getByRole('button', { name: t(CLOSING[kind].button) }) as HTMLButtonElement;

describe('resolving and dismissing a case (T050, FR-478, FR-486)', () => {
  it.each(['resolve', 'dismiss'] as const)(
    '%s sends the case and the trimmed note, then reads the case again, in both languages',
    async (kind) => {
      await inBothLocales(
        () => open(),
        async (t) => {
          const { api } = current;
          api.cases[kind].mutate.mockResolvedValue({
            caseId: CASE,
            status: kind === 'resolve' ? 'resolved' : 'dismissed',
          });
          const dialog = await press(t, CLOSING[kind].button, CLOSING[kind].title);
          const reads = api.cases.get.query.mock.calls.length;
          type(dialog.getByLabelText(t('admin.cases.close.noteLabel')), '  اتصلنا بالطالب  ');
          fireEvent.click(closingConfirm(dialog, t, kind));
          await waitFor(() => expect(api.cases[kind].mutate).toHaveBeenCalledTimes(1));
          expect(api.cases[kind].mutate).toHaveBeenCalledWith({
            caseId: CASE,
            note: 'اتصلنا بالطالب',
          });
          await waitFor(() =>
            expect(
              screen.queryByRole('heading', { level: 2, name: t(CLOSING[kind].title) }),
            ).toBeNull(),
          );
          await waitFor(() => expect(api.cases.get.query.mock.calls.length).toBeGreaterThan(reads));
          const other = kind === 'resolve' ? 'dismiss' : 'resolve';
          expect(api.cases[other].mutate).not.toHaveBeenCalled();
          expect(api.cases.decideComplaint.mutate).not.toHaveBeenCalled();
        },
      );
    },
  );

  it.each(['resolve', 'dismiss'] as const)('%s sends nothing without a note', async (kind) => {
    const { api } = open();
    const dialog = await press(ar, CLOSING[kind].button, CLOSING[kind].title);
    expect(closingConfirm(dialog, ar, kind).disabled).toBe(true);
    fireEvent.click(closingConfirm(dialog, ar, kind));
    type(dialog.getByLabelText(ar('admin.cases.close.noteLabel')), '    ');
    expect(closingConfirm(dialog, ar, kind).disabled).toBe(true);
    fireEvent.click(closingConfirm(dialog, ar, kind));
    await settle();
    expect(api.cases.resolve.mutate).not.toHaveBeenCalled();
    expect(api.cases.dismiss.mutate).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'dismiss'] as const)(
    'says what %s does to a `student_suspended` case, and nothing of the other outcome, in both languages',
    async (kind) => {
      await inBothLocales(
        () => open(),
        async (t) => {
          const dialog = await press(t, CLOSING[kind].button, CLOSING[kind].title);
          for (const key of SUSPENDED_EFFECTS[kind]) expect(dialog.getByText(t(key))).toBeTruthy();
          const other = kind === 'resolve' ? 'dismiss' : 'resolve';
          for (const key of [...SUSPENDED_EFFECTS[other], ...ORDINARY_EFFECTS[other]]) {
            expect(dialog.queryByText(t(key))).toBeNull();
          }
          const section = dialog.getByRole('heading', { level: 2 }).closest('section.dialog');
          expect(section?.textContent ?? '').not.toMatch(FINAL);
        },
      );
    },
  );

  it.each(['resolve', 'dismiss'] as const)(
    'says what %s does to any other case, never the suspension’s outcomes, in both languages',
    async (kind) => {
      await inBothLocales(
        () => open(fakeApi('refund_choice')),
        async (t) => {
          const dialog = await press(t, CLOSING[kind].button, CLOSING[kind].title);
          for (const key of ORDINARY_EFFECTS[kind]) expect(dialog.getByText(t(key))).toBeTruthy();
          for (const key of [...SUSPENDED_EFFECTS.resolve, ...SUSPENDED_EFFECTS.dismiss]) {
            expect(dialog.queryByText(t(key))).toBeNull();
          }
          const section = dialog.getByRole('heading', { level: 2 }).closest('section.dialog');
          expect(section?.textContent ?? '').not.toMatch(FINAL);
        },
      );
    },
  );

  it.each([
    ['resolve', 'STUDENT_SUSPENDED', [], 'admin.cases.close.refused.studentSuspended'],
    [
      'resolve',
      'CONFLICT',
      [{ path: 'cause', code: 'not_open' }],
      'admin.cases.close.refused.notOpen',
    ],
    [
      'dismiss',
      'CONFLICT',
      [{ path: 'cause', code: 'not_open' }],
      'admin.cases.close.refused.notOpen',
    ],
    [
      'resolve',
      'CONFLICT',
      [{ path: 'cause', code: 'no_free_week' }],
      'admin.cases.close.refused.noFreeWeek',
    ],
    ['resolve', 'NOT_FOUND', [], 'admin.cases.close.refused.notFound'],
    ['dismiss', 'NOT_FOUND', [], 'admin.cases.close.refused.notFound'],
  ] as const)(
    '%s refused %s %j is said in plain words, the dialog kept open, in both languages',
    async (kind, code, details, words) => {
      await inBothLocales(
        () => open(),
        async (t) => {
          const { api } = current;
          api.cases[kind].mutate.mockRejectedValue(refusal(code, details));
          const dialog = await press(t, CLOSING[kind].button, CLOSING[kind].title);
          type(dialog.getByLabelText(t('admin.cases.close.noteLabel')), 'ملاحظة');
          fireEvent.click(closingConfirm(dialog, t, kind));
          expect(await dialog.findByText(t(words))).toBeTruthy();
          expect(dialog.queryByText(t('admin.dialogs.submitError'))).toBeNull();
        },
      );
    },
  );

  it.each([
    ['CONFLICT', []],
    ['CONFLICT', [{ path: 'cause', code: 'other' }]],
    ['INTERNAL', []],
  ] as const)(
    'any other failure (%s %j) shows the generic words, never a named refusal',
    async (code, details) => {
      const { api } = open();
      api.cases.resolve.mutate.mockRejectedValue(refusal(code, details));
      const dialog = await press(ar, CLOSING.resolve.button, CLOSING.resolve.title);
      type(dialog.getByLabelText(ar('admin.cases.close.noteLabel')), 'ملاحظة');
      fireEvent.click(closingConfirm(dialog, ar, 'resolve'));
      expect(await dialog.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
      for (const key of [
        'admin.cases.close.refused.studentSuspended',
        'admin.cases.close.refused.notOpen',
        'admin.cases.close.refused.noFreeWeek',
        'admin.cases.close.refused.notFound',
      ] as const) {
        expect(dialog.queryByText(ar(key))).toBeNull();
      }
    },
  );
});

type Decision = 'end_enrollment' | 'suspend_teacher' | 'close';

const DECISION: Readonly<
  Record<Decision, { readonly label: MessageKey; readonly effect: MessageKey }>
> = {
  end_enrollment: {
    label: 'admin.cases.decide.endEnrollment.label',
    effect: 'admin.cases.decide.endEnrollment.effect',
  },
  suspend_teacher: {
    label: 'admin.cases.decide.suspendTeacher.label',
    effect: 'admin.cases.decide.suspendTeacher.effect',
  },
  close: { label: 'admin.cases.decide.close.label', effect: 'admin.cases.decide.close.effect' },
};
const DECISIONS = Object.keys(DECISION) as Decision[];

const decideOpen = (api: Api = fakeApi()) => open(api, COMPLAINT);
const decideDialog = (t: Translate) =>
  press(t, 'admin.cases.action.decide', 'admin.cases.decide.title');
const decideConfirm = (dialog: ReturnType<typeof within>, t: Translate) =>
  dialog.getByRole('button', { name: t('admin.common.action.issueDecision') }) as HTMLButtonElement;

describe('deciding a complaint of a teacher’s absence (T050, FR-453)', () => {
  it('says what each of the three decisions does, and nothing final, in both languages', async () => {
    await inBothLocales(
      () => decideOpen(),
      async (t) => {
        const dialog = await decideDialog(t);
        for (const decision of DECISIONS) {
          expect(dialog.getByRole('radio', { name: t(DECISION[decision].label) })).toBeTruthy();
          expect(dialog.getByText(t(DECISION[decision].effect))).toBeTruthy();
        }
        const section = dialog.getByRole('heading', { level: 2 }).closest('section.dialog');
        expect(section?.textContent ?? '').not.toMatch(FINAL);
      },
    );
  });

  it.each(DECISIONS)(
    '%s sends the complaint, the decision and the trimmed note, in both languages',
    async (decision) => {
      await inBothLocales(
        () => decideOpen(),
        async (t) => {
          const { api } = current;
          api.cases.decideComplaint.mutate.mockResolvedValue({
            caseId: COMPLAINT,
            status: decision === 'close' ? 'dismissed' : 'resolved',
            enrollmentStatus: 'confirmed',
          });
          const dialog = await decideDialog(t);
          fireEvent.click(dialog.getByRole('radio', { name: t(DECISION[decision].label) }));
          type(dialog.getByLabelText(t('admin.cases.decide.noteLabel')), ' غياب ثابت ');
          fireEvent.click(decideConfirm(dialog, t));
          await waitFor(() => expect(api.cases.decideComplaint.mutate).toHaveBeenCalledTimes(1));
          expect(api.cases.decideComplaint.mutate).toHaveBeenCalledWith({
            caseId: COMPLAINT,
            decision,
            note: 'غياب ثابت',
          });
          expect(await dialog.findByText(t('admin.cases.decide.done'))).toBeTruthy();
          expect(api.cases.resolve.mutate).not.toHaveBeenCalled();
          expect(api.cases.dismiss.mutate).not.toHaveBeenCalled();
        },
      );
    },
  );

  it('sends nothing without a decision or without a note', async () => {
    const { api } = decideOpen();
    const dialog = await decideDialog(ar);
    expect(decideConfirm(dialog, ar).disabled).toBe(true);
    type(dialog.getByLabelText(ar('admin.cases.decide.noteLabel')), 'ملاحظة');
    expect(decideConfirm(dialog, ar).disabled).toBe(true);
    fireEvent.click(decideConfirm(dialog, ar));
    type(dialog.getByLabelText(ar('admin.cases.decide.noteLabel')), '   ');
    fireEvent.click(dialog.getByRole('radio', { name: ar(DECISION.close.label) }));
    expect(decideConfirm(dialog, ar).disabled).toBe(true);
    fireEvent.click(decideConfirm(dialog, ar));
    await settle();
    expect(api.cases.decideComplaint.mutate).not.toHaveBeenCalled();
  });

  it('links the new case the answer names, and follows it to `?case=`, in both languages', async () => {
    await inBothLocales(
      () => decideOpen(),
      async (t) => {
        const { api } = current;
        api.cases.decideComplaint.mutate.mockResolvedValue({
          caseId: COMPLAINT,
          status: 'resolved',
          enrollmentStatus: 'terminated_no_show',
          newCaseId: NEW_CASE,
        });
        const dialog = await decideDialog(t);
        fireEvent.click(dialog.getByRole('radio', { name: t(DECISION.end_enrollment.label) }));
        type(dialog.getByLabelText(t('admin.cases.decide.noteLabel')), 'غياب ثابت');
        fireEvent.click(decideConfirm(dialog, t));
        expect(await dialog.findByText(t('admin.cases.decide.newCase'))).toBeTruthy();
        const link = dialog.getByRole('link', { name: t('admin.cases.decide.viewNewCase') });
        expect(link.getAttribute('href')).toBe(`/cases?case=${NEW_CASE}`);
        fireEvent.click(link);
        await waitFor(() => expect(currentPath()).toBe(`/cases?case=${NEW_CASE}`));
        await waitFor(() =>
          expect(api.cases.get.query).toHaveBeenLastCalledWith({ caseId: NEW_CASE }),
        );
      },
    );
  });

  it('links no new case when the answer names none', async () => {
    const { api } = decideOpen();
    api.cases.decideComplaint.mutate.mockResolvedValue({
      caseId: COMPLAINT,
      status: 'dismissed',
      enrollmentStatus: 'confirmed',
    });
    const dialog = await decideDialog(ar);
    fireEvent.click(dialog.getByRole('radio', { name: ar(DECISION.close.label) }));
    type(dialog.getByLabelText(ar('admin.cases.decide.noteLabel')), 'لا دليل');
    fireEvent.click(decideConfirm(dialog, ar));
    expect(await dialog.findByText(ar('admin.cases.decide.done'))).toBeTruthy();
    expect(dialog.queryByText(ar('admin.cases.decide.newCase'))).toBeNull();
    expect(dialog.queryByRole('link', { name: ar('admin.cases.decide.viewNewCase') })).toBeNull();
  });

  it.each([
    [
      'CONFLICT',
      [{ path: 'cause', code: 'enrollment_not_confirmed' }],
      'admin.cases.decide.refused.notConfirmed',
    ],
    ['NOT_FOUND', [], 'admin.cases.decide.refused.notFound'],
  ] as const)(
    'a refusal %s %j is said in plain words, in both languages',
    async (code, details, words) => {
      await inBothLocales(
        () => decideOpen(),
        async (t) => {
          const { api } = current;
          api.cases.decideComplaint.mutate.mockRejectedValue(refusal(code, details));
          const dialog = await decideDialog(t);
          fireEvent.click(dialog.getByRole('radio', { name: t(DECISION.end_enrollment.label) }));
          type(dialog.getByLabelText(t('admin.cases.decide.noteLabel')), 'ملاحظة');
          fireEvent.click(decideConfirm(dialog, t));
          expect(await dialog.findByText(t(words))).toBeTruthy();
          expect(dialog.queryByText(t('admin.dialogs.submitError'))).toBeNull();
        },
      );
    },
  );

  it.each([
    ['CONFLICT', [{ path: 'cause', code: 'teacher_not_approved' }]],
    ['CONFLICT', []],
    ['INTERNAL', []],
  ] as const)(
    'any other failure (%s %j) shows the generic words, never a named refusal',
    async (code, details) => {
      const { api } = decideOpen();
      api.cases.decideComplaint.mutate.mockRejectedValue(refusal(code, details));
      const dialog = await decideDialog(ar);
      fireEvent.click(dialog.getByRole('radio', { name: ar(DECISION.suspend_teacher.label) }));
      type(dialog.getByLabelText(ar('admin.cases.decide.noteLabel')), 'ملاحظة');
      fireEvent.click(decideConfirm(dialog, ar));
      expect(await dialog.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
      expect(dialog.queryByText(ar('admin.cases.decide.refused.notConfirmed'))).toBeNull();
      expect(dialog.queryByText(ar('admin.cases.decide.refused.notFound'))).toBeNull();
    },
  );
});

describe('T058: RATE_LIMITED on a case’s decisions', () => {
  const limited = (seconds: string) =>
    refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: seconds }]);

  it.each(['resolve', 'dismiss'] as const)('%s says when to try again', async (kind) => {
    const { api } = open();
    api.cases[kind].mutate.mockRejectedValue(limited('61'));
    const dialog = await press(ar, CLOSING[kind].button, CLOSING[kind].title);
    type(dialog.getByLabelText(ar('admin.cases.close.noteLabel')), 'ملاحظة');
    fireEvent.click(closingConfirm(dialog, ar, kind));
    expect(await dialog.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(dialog.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });

  it('the complaint’s decision says when to try again', async () => {
    const { api } = decideOpen();
    api.cases.decideComplaint.mutate.mockRejectedValue(limited('120'));
    const dialog = await decideDialog(ar);
    fireEvent.click(dialog.getByRole('radio', { name: ar(DECISION.suspend_teacher.label) }));
    type(dialog.getByLabelText(ar('admin.cases.decide.noteLabel')), 'ملاحظة');
    fireEvent.click(decideConfirm(dialog, ar));
    expect(await dialog.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(dialog.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });
});

// B42b, T075 of specs/004-sessions (Q-B1 (a), the review session's ruling of 2026-11-13; N11): a
// student's suspension case cleared while the teacher is suspended is refused `TEACHER_SUSPENDED`,
// and a `teacher_suspended` case resolved or dismissed `CONFLICT` `closed_by_reinstatement`; each
// said in plain words, in Arabic and English, never the generic words.
describe('T075: a teacher’s suspension refusing a closing, in plain words', () => {
  it.each([
    [
      'TEACHER_SUSPENDED',
      refusal('TEACHER_SUSPENDED'),
      'admin.cases.close.refused.teacherSuspended',
      { ar: /المعلم ما زال موقوفًا/u, en: /teacher’s account is still suspended/u },
    ],
    [
      'CONFLICT closed_by_reinstatement',
      refusal('CONFLICT', [{ path: 'cause', code: 'closed_by_reinstatement' }]),
      'admin.cases.close.refused.closedByReinstatement',
      { ar: /يُعاد تفعيل المعلم/u, en: /teacher is reinstated/u },
    ],
  ] as const)('%s says what unblocks it', (_name, error, key, words) => {
    expect(closingFailure(error)).toEqual({ key });
    for (const locale of ['ar', 'en'] as const) {
      expect(translate(locale, key)).toMatch(words[locale]);
      expect(translate(locale, key)).not.toBe(translate(locale, 'admin.dialogs.submitError'));
    }
  });
});
