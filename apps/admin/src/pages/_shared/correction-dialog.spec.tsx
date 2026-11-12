// B42 lane S (T047, T048; spec FR-439; T059's `sessions.review.revise`): the correction of an outcome
// nobody disputed. The outcome and a mandatory reason before anything is sent; the idempotency key
// minted when the dialog opens and reused on its retry; each refusal T059 names in plain words, the
// ruled one with its dispute's link; any other failure the generic `admin.dialogs.submitError`.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { inBothLocales, mutation, refusal } from '../../test/app-harness';
import { CorrectionDialog } from './CorrectionDialog';
import { currentPath, renderPiece } from './piece-harness';

afterEach(() => setLocale('ar'));

const SESSION = '0193a6f0-0000-7000-8000-0000000000c1';
const DISPUTE = '0193a6f0-0000-7000-8000-0000000000d1';
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
/** Lets a press's mutation, if one was started, reach the client before a "nothing sent" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const ANSWER = { sessionId: SESSION, sessionStatus: 'done', previousStatus: 'teacher_no_show' };

function fakeApi() {
  return { sessions: { review: { revise: mutation() } } };
}

function open(api = fakeApi()) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const rendered = renderPiece(
    () => <CorrectionDialog sessionId={SESSION} onDone={onDone} onClose={onClose} />,
    api,
  );
  return { ...rendered, api, onDone, onClose };
}

const ar = (key: MessageKey) => translate('ar', key);

async function dialog(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

/** Chooses `outcome`, writes `reason`, and presses the correction. */
async function correct(outcome: MessageKey, reason: string) {
  const box = await dialog(ar('admin.shared.correction.title'));
  fireEvent.click(box.getByRole('radio', { name: ar(outcome) }));
  fireEvent.change(box.getByLabelText(ar('admin.shared.correction.reasonLabel')), {
    target: { value: reason },
  });
  fireEvent.click(box.getByRole('button', { name: ar('admin.shared.correction.confirm') }));
  return box;
}

describe("an undisputed outcome's correction (FR-439)", () => {
  it('asks for one of the four outcomes and a reason, and says what follows, in both languages', async () => {
    await inBothLocales(
      () => open(),
      async (t) => {
        const box = await dialog(t('admin.shared.correction.title'));
        expect(box.getByText(t('admin.shared.correction.effect'))).toBeTruthy();
        for (const outcome of [
          'admin.status.session.done',
          'admin.status.session.studentNoShow',
          'admin.status.session.teacherNoShow',
          'admin.status.session.bothNoShow',
        ] as const) {
          expect(box.getByRole('radio', { name: t(outcome) })).toBeTruthy();
        }
        expect(box.getByLabelText(t('admin.shared.correction.reasonLabel'))).toBeTruthy();
      },
    );
  });

  it('sends nothing without an outcome, or with a blank reason', async () => {
    const { api } = open();
    const box = await dialog(ar('admin.shared.correction.title'));
    const confirm = box.getByRole('button', { name: ar('admin.shared.correction.confirm') });
    fireEvent.change(box.getByLabelText(ar('admin.shared.correction.reasonLabel')), {
      target: { value: 'سجل الدخول يثبت حضوره' },
    });
    fireEvent.click(confirm);
    fireEvent.click(box.getByRole('radio', { name: ar('admin.status.session.done') }));
    fireEvent.change(box.getByLabelText(ar('admin.shared.correction.reasonLabel')), {
      target: { value: '   ' },
    });
    fireEvent.click(confirm);
    await settle();
    expect(api.sessions.review.revise.mutate).not.toHaveBeenCalled();
  });

  it('sends the outcome, the reason trimmed and a key, and hands the answer back', async () => {
    const { api, onDone } = open();
    api.sessions.review.revise.mutate.mockResolvedValue(ANSWER);
    await correct('admin.status.session.done', '  سجل الدخول يثبت حضوره  ');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(ANSWER));
    expect(api.sessions.review.revise.mutate).toHaveBeenCalledTimes(1);
    const sent = api.sessions.review.revise.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toEqual({
      sessionId: SESSION,
      outcome: 'done',
      reason: 'سجل الدخول يثبت حضوره',
      idempotencyKey: expect.stringMatching(KEY),
    });
  });

  it('mints the key when the dialog opens and reuses it on its retry; another dialog mints another', async () => {
    const first = open();
    first.api.sessions.review.revise.mutate
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(ANSWER);
    const box = await correct('admin.status.session.studentNoShow', 'غاب الطالب');
    expect(await box.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: ar('admin.shared.correction.confirm') }));
    await waitFor(() => expect(first.onDone).toHaveBeenCalledWith(ANSWER));
    const [one, two] = first.api.sessions.review.revise.mutate.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(one).toMatch(KEY);
    expect(two).toBe(one);
    first.view.unmount();

    const second = open();
    second.api.sessions.review.revise.mutate.mockResolvedValue(ANSWER);
    await correct('admin.status.session.studentNoShow', 'غاب الطالب');
    await waitFor(() => expect(second.onDone).toHaveBeenCalled());
    const again = (
      second.api.sessions.review.revise.mutate.mock.calls[0]?.[0] as { idempotencyKey: string }
    ).idempotencyKey;
    expect(again).toMatch(KEY);
    expect(again).not.toBe(one);
  });

  it.each([
    ['RULING_FINAL', [{ path: 'cause', code: 'window_closed' }], 'windowClosed'],
    ['RULING_FINAL', [{ path: 'cause', code: 'remedy_offered' }], 'remedyOffered'],
    ['RULING_FINAL', [], 'final'],
    ['DISPUTE_OPEN', [], 'disputeOpen'],
    ['CONFLICT', [{ path: 'cause', code: 'not_settled' }], 'notSettled'],
    ['SESSION_UNDER_REVIEW', [], 'underReview'],
    ['NOT_FOUND', [{ path: 'cause', code: 'not_found' }], 'notFound'],
  ] as const)('says %s %j in plain words, in both languages', async (code, details, words) => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.sessions.review.revise.mutate.mockRejectedValue(refusal(code, details));
        return open(api);
      },
      async (t) => {
        const box = await dialog(t('admin.shared.correction.title'));
        fireEvent.click(box.getByRole('radio', { name: t('admin.status.session.done') }));
        fireEvent.change(box.getByLabelText(t('admin.shared.correction.reasonLabel')), {
          target: { value: 'سبب' },
        });
        fireEvent.click(box.getByRole('button', { name: t('admin.shared.correction.confirm') }));
        expect(await box.findByText(t(`admin.shared.correction.refused.${words}`))).toBeTruthy();
        expect(box.queryByText(t('admin.dialogs.submitError'))).toBeNull();
      },
    );
  });

  it('says the same key sent with other input in plain words', async () => {
    const api = fakeApi();
    api.sessions.review.revise.mutate.mockRejectedValue(refusal('CONFLICT'));
    open(api);
    const box = await correct('admin.status.session.done', 'سبب');
    expect(await box.findByText(ar('admin.shared.keyReused'))).toBeTruthy();
  });

  it("says a ruled session in plain words with its dispute's link, which leads there", async () => {
    const api = fakeApi();
    api.sessions.review.revise.mutate.mockRejectedValue(
      refusal('CONFLICT', [
        { path: 'cause', code: 'ruled' },
        { path: 'disputeId', code: DISPUTE },
      ]),
    );
    const { onClose } = open(api);
    const box = await correct('admin.status.session.teacherNoShow', 'سبب');
    expect(await box.findByText(ar('admin.shared.correction.refused.ruled'))).toBeTruthy();
    const link = box.getByRole('link', { name: ar('admin.shared.correction.refused.openDispute') });
    expect(link.getAttribute('href')).toBe(`/disputes?dispute=${DISPUTE}`);
    fireEvent.click(link);
    expect(currentPath()).toBe(`/disputes?dispute=${DISPUTE}`);
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['a refusal it does not name', refusal('RATE_LIMITED')],
    ['no answer', new Error('offline')],
  ])('says %s by the generic words', async (_case, error) => {
    const api = fakeApi();
    api.sessions.review.revise.mutate.mockRejectedValue(error);
    open(api);
    const box = await correct('admin.status.session.bothNoShow', 'سبب');
    expect(await box.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
  });

  it('closes on cancel, sending nothing', async () => {
    const { api, onClose } = open();
    const box = await dialog(ar('admin.shared.correction.title'));
    fireEvent.click(box.getByRole('button', { name: ar('admin.dialogs.confirm.common.cancel') }));
    expect(onClose).toHaveBeenCalled();
    await settle();
    expect(api.sessions.review.revise.mutate).not.toHaveBeenCalled();
  });
});
