// B42 lane S (T047, T050; spec FR-493; research R-326; T064's `cases.openManual`): an
// administrator's manual compensation case. The enrollment pre-filled or entered (a uuid), the
// party (the student only with a remedy, which is owed to the student), a mandatory reason of 1 to
// 500 characters; the idempotency key minted when the dialog opens and reused on its retry; the
// answer said as opened or joined, with the case's link; `REMEDY_NOT_OPEN`, `NOT_FOUND`,
// `RATE_LIMITED` and `CONFLICT` in plain words; any other failure the generic words.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { inBothLocales, mutation, refusal } from '../../test/app-harness';
import { ManualCaseDialog } from './ManualCaseDialog';
import { currentPath, renderPiece } from './piece-harness';

afterEach(() => setLocale('ar'));

const ENROLLMENT = '0193a6f0-0000-7000-8000-0000000000e1';
const REMEDY = '0193a6f0-0000-7000-8000-0000000000f1';
const CASE = '0193a6f0-0000-7000-8000-0000000000a9';
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
/** Lets a press's mutation, if one was started, reach the client before a "nothing sent" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const answerOf = (more: Record<string, unknown> = {}) => ({
  caseId: CASE,
  enrollmentId: ENROLLMENT,
  party: 'student',
  status: 'open',
  joined: false,
  ...more,
});

function fakeApi() {
  return { cases: { openManual: mutation() } };
}

function open(
  props: {
    readonly enrollmentId?: string;
    readonly remedyId?: string;
    readonly party?: 'student';
  } = {
    enrollmentId: ENROLLMENT,
  },
  api = fakeApi(),
) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const rendered = renderPiece(
    () => <ManualCaseDialog {...props} onDone={onDone} onClose={onClose} />,
    api,
  );
  return { ...rendered, api, onDone, onClose };
}

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const sent = (api: ReturnType<typeof fakeApi>, call = 0) =>
  api.cases.openManual.mutate.mock.calls[call]?.[0] as Record<string, unknown>;

async function dialog(title = ar('admin.shared.manualCase.title')) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

type Box = Awaited<ReturnType<typeof dialog>>;

const write = (box: Box, label: MessageKey, value: string) =>
  fireEvent.change(box.getByLabelText(ar(label)), { target: { value } });

/** Chooses the party when asked, writes the reason, and presses the opening. */
async function openCase(party: 'partyStudent' | 'partyTeacher' | null, reason: string) {
  const box = await dialog();
  if (party !== null) {
    fireEvent.click(box.getByRole('radio', { name: ar(`admin.shared.manualCase.${party}`) }));
  }
  write(box, 'admin.shared.manualCase.reasonLabel', reason);
  fireEvent.click(box.getByRole('button', { name: ar('admin.shared.manualCase.confirm') }));
  return box;
}

describe('a manual compensation case (FR-493)', () => {
  it("on an enrollment's page asks for the party and the reason, and says what follows, in both languages", async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const box = await dialog(t('admin.shared.manualCase.title'));
        expect(box.getByText(t('admin.shared.manualCase.effect'))).toBeTruthy();
        expect(
          box.getByRole('radio', { name: t('admin.shared.manualCase.partyStudent') }),
        ).toBeTruthy();
        expect(
          box.getByRole('radio', { name: t('admin.shared.manualCase.partyTeacher') }),
        ).toBeTruthy();
        expect(box.getByLabelText(t('admin.shared.manualCase.reasonLabel'))).toBeTruthy();
        expect(box.queryByLabelText(t('admin.shared.manualCase.enrollmentLabel'))).toBeNull();
      },
    );
  });

  it('sends the enrollment, the party, the reason trimmed and a key, and says the case opened with its link', async () => {
    const { api, onDone, onClose } = open();
    api.cases.openManual.mutate.mockResolvedValue(answerOf({ party: 'teacher' }));
    const box = await openCase('partyTeacher', '  المعلم أنهى الاشتراك دون سبب  ');
    expect(await box.findByText(ar('admin.shared.manualCase.opened'))).toBeTruthy();
    expect(sent(api)).toEqual({
      enrollmentId: ENROLLMENT,
      party: 'teacher',
      reason: 'المعلم أنهى الاشتراك دون سبب',
      idempotencyKey: expect.stringMatching(KEY),
    });
    expect(onDone).toHaveBeenCalledWith(answerOf({ party: 'teacher' }));
    const link = box.getByRole('link', { name: ar('admin.shared.manualCase.viewCase') });
    expect(link.getAttribute('href')).toBe(`/cases?case=${CASE}`);
    fireEvent.click(link);
    expect(currentPath()).toBe(`/cases?case=${CASE}`);
    expect(onClose).toHaveBeenCalled();
  });

  it('says a joined case as joined, with its link, in both languages', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.cases.openManual.mutate.mockResolvedValue(answerOf({ joined: true }));
        return open(undefined, api);
      },
      async (t) => {
        const box = await dialog(t('admin.shared.manualCase.title'));
        fireEvent.click(
          box.getByRole('radio', { name: t('admin.shared.manualCase.partyStudent') }),
        );
        fireEvent.change(box.getByLabelText(t('admin.shared.manualCase.reasonLabel')), {
          target: { value: 'سبب' },
        });
        fireEvent.click(box.getByRole('button', { name: t('admin.shared.manualCase.confirm') }));
        expect(await box.findByText(t('admin.shared.manualCase.joined'))).toBeTruthy();
        expect(box.queryByText(t('admin.shared.manualCase.opened'))).toBeNull();
        expect(
          box
            .getByRole('link', { name: t('admin.shared.manualCase.viewCase') })
            .getAttribute('href'),
        ).toBe(`/cases?case=${CASE}`);
      },
    );
  });

  it('asks for the enrollment when none is given, and sends nothing until it is an enrollment id', async () => {
    const { api } = open({});
    api.cases.openManual.mutate.mockResolvedValue(answerOf());
    const box = await dialog();
    write(box, 'admin.shared.manualCase.enrollmentLabel', 'not-an-id');
    const box2 = await openCase('partyStudent', 'سبب');
    expect(await box2.findByText(ar('admin.shared.manualCase.enrollmentInvalid'))).toBeTruthy();
    await settle();
    expect(api.cases.openManual.mutate).not.toHaveBeenCalled();
    write(box, 'admin.shared.manualCase.enrollmentLabel', `  ${ENROLLMENT} `);
    fireEvent.click(box.getByRole('button', { name: ar('admin.shared.manualCase.confirm') }));
    await waitFor(() => expect(api.cases.openManual.mutate).toHaveBeenCalledTimes(1));
    expect(sent(api)).toMatchObject({ enrollmentId: ENROLLMENT, party: 'student' });
  });

  it("with a remedy offers the student only, says the remedy's handing, and sends the remedy", async () => {
    await inBothLocales(
      () => open({ enrollmentId: ENROLLMENT, remedyId: REMEDY }),
      async (t) => {
        const box = await dialog(t('admin.shared.manualCase.title'));
        expect(box.getByText(t('admin.shared.manualCase.effectRemedy'))).toBeTruthy();
        expect(box.getByText(t('admin.shared.manualCase.remedyParty'))).toBeTruthy();
        expect(
          box.queryByRole('radio', { name: t('admin.shared.manualCase.partyTeacher') }),
        ).toBeNull();
      },
    );
    const { api } = open({ enrollmentId: ENROLLMENT, remedyId: REMEDY });
    api.cases.openManual.mutate.mockResolvedValue(
      answerOf({ handedRemedy: { remedyId: REMEDY, sessionId: ENROLLMENT } }),
    );
    await openCase(null, 'التعويض لم يُحجز');
    await waitFor(() => expect(api.cases.openManual.mutate).toHaveBeenCalledTimes(1));
    expect(sent(api)).toMatchObject({
      enrollmentId: ENROLLMENT,
      party: 'student',
      remedyId: REMEDY,
    });
  });

  it('sends nothing without a party, with a blank reason, or with one over 500 characters', async () => {
    const { api } = open();
    const box = await dialog();
    const confirm = box.getByRole('button', { name: ar('admin.shared.manualCase.confirm') });
    write(box, 'admin.shared.manualCase.reasonLabel', 'سبب');
    fireEvent.click(confirm);
    fireEvent.click(box.getByRole('radio', { name: ar('admin.shared.manualCase.partyStudent') }));
    write(box, 'admin.shared.manualCase.reasonLabel', '   ');
    fireEvent.click(confirm);
    write(box, 'admin.shared.manualCase.reasonLabel', 'ب'.repeat(501));
    expect(box.getByText(ar('admin.shared.manualCase.reasonTooLong', { max: 500 }))).toBeTruthy();
    fireEvent.click(confirm);
    await settle();
    expect(api.cases.openManual.mutate).not.toHaveBeenCalled();
  });

  it('mints the key when the dialog opens and reuses it on its retry; another dialog mints another', async () => {
    const first = open();
    first.api.cases.openManual.mutate
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(answerOf());
    const box = await openCase('partyStudent', 'سبب');
    expect(await box.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: ar('admin.shared.manualCase.confirm') }));
    expect(await box.findByText(ar('admin.shared.manualCase.opened'))).toBeTruthy();
    const one = sent(first.api, 0)['idempotencyKey'];
    expect(one).toMatch(KEY);
    expect(sent(first.api, 1)['idempotencyKey']).toBe(one);
    first.view.unmount();

    const second = open();
    second.api.cases.openManual.mutate.mockResolvedValue(answerOf());
    await openCase('partyStudent', 'سبب');
    await waitFor(() => expect(second.api.cases.openManual.mutate).toHaveBeenCalled());
    expect(sent(second.api)['idempotencyKey']).toMatch(KEY);
    expect(sent(second.api)['idempotencyKey']).not.toBe(one);
  });

  it.each([
    ['REMEDY_NOT_OPEN', 'admin.shared.manualCase.refused.remedyNotOpen'],
    ['NOT_FOUND', 'admin.shared.manualCase.refused.notFound'],
    ['RATE_LIMITED', 'admin.shared.manualCase.refused.rateLimited'],
    ['CONFLICT', 'admin.shared.keyReused'],
  ] as const)('says %s in plain words, in both languages', async (code, words) => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.cases.openManual.mutate.mockRejectedValue(refusal(code));
        return open(undefined, api);
      },
      async (t) => {
        const box = await dialog(t('admin.shared.manualCase.title'));
        fireEvent.click(
          box.getByRole('radio', { name: t('admin.shared.manualCase.partyStudent') }),
        );
        fireEvent.change(box.getByLabelText(t('admin.shared.manualCase.reasonLabel')), {
          target: { value: 'سبب' },
        });
        fireEvent.click(box.getByRole('button', { name: t('admin.shared.manualCase.confirm') }));
        expect(await box.findByText(t(words))).toBeTruthy();
        expect(box.queryByText(t('admin.dialogs.submitError'))).toBeNull();
      },
    );
  });

  it.each([
    ['a refusal it does not name', refusal('VALIDATION_FAILED')],
    ['no answer', new Error('offline')],
  ])('says %s by the generic words', async (_case, error) => {
    const api = fakeApi();
    api.cases.openManual.mutate.mockRejectedValue(error);
    open(undefined, api);
    const box = await openCase('partyStudent', 'سبب');
    expect(await box.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
  });

  it('closes on cancel, sending nothing', async () => {
    const { api, onClose } = open();
    const box = await dialog();
    fireEvent.click(box.getByRole('button', { name: ar('admin.dialogs.confirm.common.cancel') }));
    expect(onClose).toHaveBeenCalled();
    await settle();
    expect(api.cases.openManual.mutate).not.toHaveBeenCalled();
  });
});

// 006:T021 (B-P4's conflict check, Q-8 (b), the owner, 2026-11-25): the programme's page opens the
// dialog for the student of an assessment never held; the preset fixes the party to the student and
// locks it, as a remedy does, and sends no remedy.
describe('the student preset (006:T021, Q-8 (b))', () => {
  it('fixes the party to the student and offers no choice, in both languages', async () => {
    await inBothLocales(
      () => open({ enrollmentId: ENROLLMENT, party: 'student' }),
      async (t) => {
        const box = await dialog(t('admin.shared.manualCase.title'));
        expect(box.getByText(t('admin.shared.manualCase.studentParty'))).toBeTruthy();
        expect(
          box.queryByRole('radio', { name: t('admin.shared.manualCase.partyTeacher') }),
        ).toBeNull();
        expect(
          box.queryByRole('radio', { name: t('admin.shared.manualCase.partyStudent') }),
        ).toBeNull();
        expect(box.queryByText(t('admin.shared.manualCase.effectRemedy'))).toBeNull();
      },
    );
  });

  it('sends the student as the party, with no remedy, once the reason is written', async () => {
    const { api } = open({ enrollmentId: ENROLLMENT, party: 'student' });
    api.cases.openManual.mutate.mockResolvedValue(answerOf());
    await openCase(null, '  جلسة التقييم لم تُعقد  ');
    await waitFor(() => expect(api.cases.openManual.mutate).toHaveBeenCalledTimes(1));
    expect(sent(api)).toEqual({
      enrollmentId: ENROLLMENT,
      party: 'student',
      reason: 'جلسة التقييم لم تُعقد',
      idempotencyKey: expect.stringMatching(KEY),
    });
  });

  it('leaves the choice to the administrator without the preset', async () => {
    open();
    const box = await dialog();
    expect(box.queryByText(ar('admin.shared.manualCase.studentParty'))).toBeNull();
    expect(
      box.getByRole('radio', { name: ar('admin.shared.manualCase.partyTeacher') }),
    ).toBeTruthy();
  });
});

describe('T058: RATE_LIMITED on the manual case (rate_limit_manual_compensation_case)', () => {
  it('its own words for RATE_LIMITED gain the time when the server gives one', async () => {
    const api = fakeApi();
    api.cases.openManual.mutate.mockRejectedValue(
      refusal('RATE_LIMITED', [{ path: 'retryAfterSeconds', code: '61' }]),
    );
    open(undefined, api);
    const box = await openCase('partyStudent', 'سبب');
    expect(await box.findByText(ar('admin.common.rateLimitedIn', { count: 2 }))).toBeTruthy();
    expect(box.queryByText(ar('admin.shared.manualCase.refused.rateLimited'))).toBeNull();
    expect(box.queryByText(ar('admin.dialogs.submitError'))).toBeNull();
  });
});
