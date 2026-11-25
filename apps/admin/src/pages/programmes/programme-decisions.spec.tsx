// 006:T021 (FR-706a, FR-706b, FR-709, FR-725, FR-727; SRS DEC-112, DEC-113; B-P4's conflict check
// Q-1 (a) amended, Q-8 (b); admin-surface.md `programmes.decide`, `programmes.reopen`): deciding a
// programme's open item and reopening a stopped programme, on the programme's page, in both
// languages. Each item says why it opened and what each of its decisions does: a `pay_blocked` one
// whether the payout account is verified now, its approve (the offer lapses, the fee kept) and its
// extension (the setting's hours more from now); a `no_offer` one its approve (closed as refused,
// the fee kept, the weekly time freed) and its extension, both asking the teacher's reason as the
// administrator records it (1–500, mandatory: no decision is sent without it); a `charge_unknown`
// one approve and extend only (no «confirm paid»), with the owner's line beside «مد». Where the
// assessment was not held: the fee unreleased, the fee the student's, and the button that opens a
// compensation case for the student, which never opens by itself. Each refusal in its own words.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MessageKey, setLocale, translate } from '../../i18n';
import { inBothLocales, refusal } from '../../test/app-harness';
import {
  daysAgo,
  detailOf,
  E1,
  fakeApi,
  type FakeApi,
  O_ASSESSMENT,
  openPage,
  R1,
  requestOf,
  rowOf,
} from './programmes-fixtures';

afterEach(() => setLocale('ar'));

const ar = (key: MessageKey, values?: Record<string, string | number>) =>
  translate('ar', key, values);
const KEY = /^[A-Za-z0-9_-]{16,128}$/;
/** Lets a press's mutation, if one was started, reach the client before a "nothing sent" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

type Kind = 'stop' | 'no_offer' | 'pay_blocked' | 'charge_unknown';

/** The programme's page with one open item of `kind`, opened from its queue row. */
function withItem(
  kind: Kind,
  item: Record<string, unknown> = {},
  more: Record<string, unknown> = {},
) {
  const api = fakeApi();
  const request = requestOf(kind, item);
  api.programmes.queue.query.mockResolvedValue({ items: [rowOf(kind, { request })] });
  api.programmes.get.query.mockResolvedValue(detailOf({ requests: [request], ...more }));
  return api;
}

const FILTER_TAB: Readonly<Record<Kind, MessageKey>> = {
  stop: 'admin.programme.tabs.stop',
  no_offer: 'admin.programme.tabs.noOffer',
  pay_blocked: 'admin.programme.tabs.payBlocked',
  charge_unknown: 'admin.programme.tabs.chargeUnknown',
};

/** Opens the page on `kind`'s tab, then the programme from its row; answers the page's panel. */
async function openItem(api: FakeApi, kind: Kind, t = ar) {
  openPage(api);
  fireEvent.click(await screen.findByRole('tab', { name: t(FILTER_TAB[kind]) }));
  fireEvent.click(
    (
      await screen.findAllByText(t('admin.programme.row.student', { name: 'Huda Samir' }))
    )[0] as HTMLElement,
  );
  return within(
    await screen.findByRole('complementary', { name: t('admin.programme.detail.a11y') }),
  );
}

async function dialogTitled(title: string) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return within(heading.closest('section.dialog') as HTMLElement);
}

type Box = Awaited<ReturnType<typeof dialogTitled>>;

/** Presses a decision on the page and answers its dialog. */
async function press(panel: ReturnType<typeof within>, label: MessageKey, t = ar): Promise<Box> {
  fireEvent.click(await panel.findByRole('button', { name: t(label) }));
  return dialogTitled(t('admin.programme.decide.title', { decision: t(label) }));
}

const sentDecision = (api: FakeApi, call = 0) =>
  api.programmes.decide.mutate.mock.calls[call]?.[0] as Record<string, unknown>;

describe('a pay_blocked item explains itself (FR-706b)', () => {
  it('says why it opened, whether the payout account is verified now, and what each decision does, in both languages', async () => {
    await inBothLocales(
      () => ({ view: openPage(withItem('pay_blocked')).view }),
      async (t) => {
        fireEvent.click(
          await screen.findByRole('tab', { name: t('admin.programme.tabs.payBlocked') }),
        );
        fireEvent.click(
          (
            await screen.findAllByText(t('admin.programme.row.student', { name: 'Huda Samir' }))
          )[0] as HTMLElement,
        );
        const panel = within(
          await screen.findByRole('complementary', { name: t('admin.programme.detail.a11y') }),
        );
        expect(await panel.findByText(t('admin.programme.why.payBlocked'))).toBeTruthy();
        expect(panel.getByText(t('admin.programme.payeeNow.unverified'))).toBeTruthy();
        expect(panel.getByText(t('admin.programme.effects.payBlocked.approve.lapse'))).toBeTruthy();
        expect(panel.getByText(t('admin.programme.effects.payBlocked.approve.fee'))).toBeTruthy();
        expect(
          await panel.findByText(
            t('admin.programme.effects.payBlocked.extend.more', {
              window: t('admin.programme.effects.window', { hours: 48 }),
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('approves with the item, the decision and the dialog’s key, and reads the page again', async () => {
    const api = withItem('pay_blocked');
    api.programmes.decide.mutate.mockResolvedValue({ status: 'approved' });
    const panel = await openItem(api, 'pay_blocked');
    const box = await press(panel, 'admin.programme.decision.payBlocked.approve');
    expect(box.getByText(ar('admin.programme.effects.payBlocked.approve.lapse'))).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.decide.confirm') }));
    await waitFor(() => expect(api.programmes.decide.mutate).toHaveBeenCalledTimes(1));
    expect(sentDecision(api)).toEqual({
      requestId: R1,
      decision: 'approve',
      idempotencyKey: expect.stringMatching(KEY),
    });
    await waitFor(() => expect(api.programmes.get.query).toHaveBeenCalledTimes(2));
  });

  it('extends with the setting’s hours said in its dialog, and an optional note sent as written', async () => {
    const api = withItem('pay_blocked');
    api.programmes.decide.mutate.mockResolvedValue({ status: 'extended' });
    const panel = await openItem(api, 'pay_blocked');
    const box = await press(panel, 'admin.programme.decision.payBlocked.extend');
    expect(
      await box.findByText(
        ar('admin.programme.effects.payBlocked.extend.more', {
          window: ar('admin.programme.effects.window', { hours: 48 }),
        }),
      ),
    ).toBeTruthy();
    fireEvent.change(box.getByLabelText(ar('admin.dialogs.confirm.common.noteLabel')), {
      target: { value: '  وُثّق الحساب اليوم  ' },
    });
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.decide.confirm') }));
    await waitFor(() => expect(api.programmes.decide.mutate).toHaveBeenCalledTimes(1));
    expect(sentDecision(api)).toEqual({
      requestId: R1,
      decision: 'extend',
      note: 'وُثّق الحساب اليوم',
      idempotencyKey: expect.stringMatching(KEY),
    });
  });

  it('names the setting when its hours cannot be read', async () => {
    const api = withItem('pay_blocked');
    api.settings.list.query.mockRejectedValue(refusal('INTERNAL_SERVER_ERROR'));
    const panel = await openItem(api, 'pay_blocked');
    expect(
      await panel.findByText(
        ar('admin.programme.effects.payBlocked.extend.more', {
          window: ar('admin.programme.effects.windowOfSetting', {
            setting: ar('admin.settings.keys.programme_pay_rest_hours' as MessageKey),
          }),
        }),
      ),
    ).toBeTruthy();
  });
});

describe('a no_offer item (FR-706a, FR-709; SRS DEC-112)', () => {
  it('says why it opened and each decision’s effects: approve closes as refused, the fee kept, the time freed; extend the setting’s hours from now', async () => {
    await inBothLocales(
      () => ({
        view: openPage(withItem('no_offer', { assessmentHeld: true }, { state: 'awaiting_offer' }))
          .view,
      }),
      async (t) => {
        fireEvent.click(
          await screen.findByRole('tab', { name: t('admin.programme.tabs.noOffer') }),
        );
        fireEvent.click(
          (
            await screen.findAllByText(t('admin.programme.row.student', { name: 'Huda Samir' }))
          )[0] as HTMLElement,
        );
        const panel = within(
          await screen.findByRole('complementary', { name: t('admin.programme.detail.a11y') }),
        );
        expect(await panel.findByText(t('admin.programme.why.noOffer'))).toBeTruthy();
        for (const effect of [
          'admin.programme.effects.noOffer.approve.close',
          'admin.programme.effects.noOffer.approve.fee',
          'admin.programme.effects.noOffer.approve.time',
          'admin.programme.effects.noOffer.extend.time',
        ] as const) {
          expect(panel.getByText(t(effect))).toBeTruthy();
        }
        expect(
          await panel.findByText(
            t('admin.programme.effects.noOffer.extend.more', {
              window: t('admin.programme.effects.window', { hours: 24 }),
            }),
          ),
        ).toBeTruthy();
      },
    );
  });

  it('blocks a decision without the reason: the confirm stays disabled and nothing is sent', async () => {
    const api = withItem('no_offer', { assessmentHeld: true }, { state: 'awaiting_offer' });
    const panel = await openItem(api, 'no_offer');
    const box = await press(panel, 'admin.programme.decision.noOffer.approve');
    const confirm = box.getByRole('button', { name: ar('admin.programme.decide.confirm') });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    fireEvent.change(box.getByLabelText(ar('admin.programme.decide.reasonLabel')), {
      target: { value: '    ' },
    });
    fireEvent.click(confirm);
    fireEvent.change(box.getByLabelText(ar('admin.programme.decide.reasonLabel')), {
      target: { value: 'ب'.repeat(501) },
    });
    expect(box.getByText(ar('admin.programme.decide.reasonTooLong', { max: 500 }))).toBeTruthy();
    fireEvent.click(confirm);
    await settle();
    expect(api.programmes.decide.mutate).not.toHaveBeenCalled();
  });

  it('sends the reason trimmed with the decision', async () => {
    const api = withItem('no_offer', { assessmentHeld: true }, { state: 'awaiting_offer' });
    api.programmes.decide.mutate.mockResolvedValue({ status: 'extended' });
    const panel = await openItem(api, 'no_offer');
    const box = await press(panel, 'admin.programme.decision.noOffer.extend');
    expect(box.getByText(ar('admin.programme.decide.reasonHint', { max: 500 }))).toBeTruthy();
    fireEvent.change(box.getByLabelText(ar('admin.programme.decide.reasonLabel')), {
      target: { value: '  المعلم مسافر حتى الخميس  ' },
    });
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.decide.confirm') }));
    await waitFor(() => expect(api.programmes.decide.mutate).toHaveBeenCalledTimes(1));
    expect(sentDecision(api)).toEqual({
      requestId: R1,
      decision: 'extend',
      reason: 'المعلم مسافر حتى الخميس',
      idempotencyKey: expect.stringMatching(KEY),
    });
  });
});

describe('the assessment not held (FR-ADMIN-20 (c); Q-8 (b))', () => {
  it('says the fee is unreleased and the student’s, and offers a case for the student, in both languages', async () => {
    await inBothLocales(
      () => ({
        view: openPage(withItem('no_offer', { assessmentHeld: false }, { state: 'awaiting_offer' }))
          .view,
      }),
      async (t) => {
        fireEvent.click(
          await screen.findByRole('tab', { name: t('admin.programme.tabs.noOffer') }),
        );
        fireEvent.click(
          (
            await screen.findAllByText(t('admin.programme.row.student', { name: 'Huda Samir' }))
          )[0] as HTMLElement,
        );
        const panel = within(
          await screen.findByRole('complementary', { name: t('admin.programme.detail.a11y') }),
        );
        expect(await panel.findByText(t('admin.programme.compensation.notHeld'))).toBeTruthy();
        expect(panel.getByText(t('admin.programme.compensation.feeIsStudents'))).toBeTruthy();
        expect(
          panel.getByRole('button', { name: t('admin.programme.compensation.open') }),
        ).toBeTruthy();
      },
    );
  });

  it('opens the compensation case dialog with the enrollment and the student, the party locked', async () => {
    const api = withItem('no_offer', { assessmentHeld: false }, { state: 'awaiting_offer' });
    api.cases.openManual.mutate.mockResolvedValue({
      caseId: '0193a6f0-0000-7000-8000-0000000000a9',
      enrollmentId: E1,
      party: 'student',
      status: 'open',
      joined: false,
    });
    const panel = await openItem(api, 'no_offer');
    fireEvent.click(
      await panel.findByRole('button', { name: ar('admin.programme.compensation.open') }),
    );
    const box = await dialogTitled(ar('admin.shared.manualCase.title'));
    expect(box.getByText(ar('admin.shared.manualCase.studentParty'))).toBeTruthy();
    expect(
      box.queryByRole('radio', { name: ar('admin.shared.manualCase.partyTeacher') }),
    ).toBeNull();
    expect(box.queryByLabelText(ar('admin.shared.manualCase.enrollmentLabel'))).toBeNull();
    fireEvent.change(box.getByLabelText(ar('admin.shared.manualCase.reasonLabel')), {
      target: { value: 'جلسة الاختبار لم تُعقد' },
    });
    fireEvent.click(box.getByRole('button', { name: ar('admin.shared.manualCase.confirm') }));
    await waitFor(() => expect(api.cases.openManual.mutate).toHaveBeenCalledTimes(1));
    expect(api.cases.openManual.mutate.mock.calls[0]?.[0]).toEqual({
      enrollmentId: E1,
      party: 'student',
      reason: 'جلسة الاختبار لم تُعقد',
      idempotencyKey: expect.stringMatching(KEY),
    });
  });

  it('opens no case on approve: the refusal is decided and nothing else is sent or shown', async () => {
    const api = withItem('no_offer', { assessmentHeld: false }, { state: 'awaiting_offer' });
    api.programmes.decide.mutate.mockResolvedValue({ status: 'approved' });
    const panel = await openItem(api, 'no_offer');
    const box = await press(panel, 'admin.programme.decision.noOffer.approve');
    fireEvent.change(box.getByLabelText(ar('admin.programme.decide.reasonLabel')), {
      target: { value: 'المعلم لا يريد الاستمرار' },
    });
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.decide.confirm') }));
    await waitFor(() => expect(api.programmes.decide.mutate).toHaveBeenCalledTimes(1));
    await settle();
    expect(api.cases.openManual.mutate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { level: 2, name: ar('admin.shared.manualCase.title') }),
    ).toBeNull();
  });

  it('says it on a closed programme with no assessment release, with the link to the fee’s order', async () => {
    const api = fakeApi();
    api.programmes.get.query.mockResolvedValue(
      detailOf({ state: 'closed', closedAt: daysAgo(1), assessmentHeld: false, cardSaved: false }),
    );
    openPage(api, `/programmes?programme=${E1}`);
    const panel = within(
      await screen.findByRole('complementary', { name: ar('admin.programme.detail.a11y') }),
    );
    expect(await panel.findByText(ar('admin.programme.compensation.notHeld'))).toBeTruthy();
    expect(panel.getByText(ar('admin.programme.compensation.feeIsStudents'))).toBeTruthy();
    expect(
      panel.getByRole('button', { name: ar('admin.programme.compensation.open') }),
    ).toBeTruthy();
    expect(
      panel
        .getAllByRole('link', { name: ar('admin.common.action.openInPayments') })
        .map((link) => link.getAttribute('href')),
    ).toContain(`/payments?payment=${O_ASSESSMENT}`);
  });

  it('says nothing of it where the assessment was held', async () => {
    const api = fakeApi();
    api.programmes.get.query.mockResolvedValue(
      detailOf({ state: 'closed', closedAt: daysAgo(1), assessmentHeld: true }),
    );
    openPage(api, `/programmes?programme=${E1}`);
    const panel = within(
      await screen.findByRole('complementary', { name: ar('admin.programme.detail.a11y') }),
    );
    await panel.findByText(ar('admin.programme.state.closed'));
    expect(panel.queryByText(ar('admin.programme.compensation.notHeld'))).toBeNull();
    expect(
      panel.queryByRole('button', { name: ar('admin.programme.compensation.open') }),
    ).toBeNull();
  });
});

describe('a charge_unknown item (SRS DEC-113; Q-1 (a) amended)', () => {
  it('offers approve and «مد» only, no third decision, with the owner’s line beside «مد», in both languages', async () => {
    await inBothLocales(
      () => ({ view: openPage(withItem('charge_unknown', {}, { state: 'active' })).view }),
      async (t) => {
        fireEvent.click(
          await screen.findByRole('tab', { name: t('admin.programme.tabs.chargeUnknown') }),
        );
        fireEvent.click(
          (
            await screen.findAllByText(t('admin.programme.row.student', { name: 'Huda Samir' }))
          )[0] as HTMLElement,
        );
        const panel = within(
          await screen.findByRole('complementary', { name: t('admin.programme.detail.a11y') }),
        );
        expect(await panel.findByText(t('admin.programme.why.chargeUnknown'))).toBeTruthy();
        const decisions = within(
          panel.getByRole('region', { name: t('admin.programme.detail.decisionsTitle') }),
        );
        expect(decisions.getAllByRole('button').map((button) => button.textContent)).toEqual([
          t('admin.programme.decision.chargeUnknown.approve'),
          t('admin.programme.decision.chargeUnknown.extend'),
        ]);
        expect(
          decisions.getByText(t('admin.programme.effects.chargeUnknown.paidInPaymob')),
        ).toBeTruthy();
        expect(
          decisions.getByText(t('admin.programme.effects.chargeUnknown.approve.expired')),
        ).toBeTruthy();
        expect(
          decisions.getByText(t('admin.programme.effects.chargeUnknown.approve.retries')),
        ).toBeTruthy();
        expect(
          decisions.getByText(t('admin.programme.effects.chargeUnknown.extend.asking')),
        ).toBeTruthy();
      },
    );
  });

  it('says the owner’s line in the «مد» dialog, and sends the extension', async () => {
    const api = withItem('charge_unknown', {}, { state: 'active' });
    api.programmes.decide.mutate.mockResolvedValue({ status: 'extended' });
    const panel = await openItem(api, 'charge_unknown');
    const box = await press(panel, 'admin.programme.decision.chargeUnknown.extend');
    expect(box.getByText(ar('admin.programme.effects.chargeUnknown.paidInPaymob'))).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.decide.confirm') }));
    await waitFor(() => expect(api.programmes.decide.mutate).toHaveBeenCalledTimes(1));
    expect(sentDecision(api)).toMatchObject({ requestId: R1, decision: 'extend' });
  });

  it('says `charge_answered` in its own words', async () => {
    const api = withItem('charge_unknown', {}, { state: 'active' });
    api.programmes.decide.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'cause', code: 'charge_answered' }]),
    );
    const panel = await openItem(api, 'charge_unknown');
    const box = await press(panel, 'admin.programme.decision.chargeUnknown.approve');
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.decide.confirm') }));
    expect(await box.findByText(ar('admin.programme.decide.refused.chargeAnswered'))).toBeTruthy();
  });
});

describe('a stop request (FR-725)', () => {
  it('says the teacher’s reason, approve and decline with their effects, and sends a decline', async () => {
    const api = withItem('stop', { reason: 'تأخر الدفع شهرين' });
    api.programmes.decide.mutate.mockResolvedValue({ status: 'declined' });
    const panel = await openItem(api, 'stop');
    expect(await panel.findByText(ar('admin.programme.why.stop'))).toBeTruthy();
    expect(panel.getByText(ar('admin.programme.effects.stop.approve.close'))).toBeTruthy();
    expect(panel.getByText(ar('admin.programme.effects.stop.approve.card'))).toBeTruthy();
    expect(panel.getByText(ar('admin.programme.effects.stop.decline.stays'))).toBeTruthy();
    const box = await press(panel, 'admin.programme.decision.stop.decline');
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.decide.confirm') }));
    await waitFor(() => expect(api.programmes.decide.mutate).toHaveBeenCalledTimes(1));
    expect(sentDecision(api)).toMatchObject({ requestId: R1, decision: 'decline' });
  });
});

describe('a decision refused', () => {
  it.each([
    ['not_open', 'admin.programme.decide.refused.notOpen'],
    ['decision_not_allowed', 'admin.programme.decide.refused.decisionNotAllowed'],
    ['not_offered', 'admin.programme.decide.refused.notOffered'],
    ['offer_sent', 'admin.programme.decide.refused.offerSent'],
    ['reason_required', 'admin.programme.decide.refused.reasonRequired'],
    ['makeup_pending', 'admin.programme.decide.refused.makeupPending'],
    ['sessions_pending', 'admin.programme.decide.refused.sessionsPending'],
    ['charge_answered', 'admin.programme.decide.refused.chargeAnswered'],
  ] as const)('says %s in its own words', async (cause, words) => {
    const api = withItem('stop', { reason: 'سبب' });
    api.programmes.decide.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'cause', code: cause }]),
    );
    const panel = await openItem(api, 'stop');
    const box = await press(panel, 'admin.programme.decision.stop.approve');
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.decide.confirm') }));
    expect(await box.findByText(ar(words))).toBeTruthy();
  });

  it('says NOT_FOUND, and a lost answer by the generic words; the key is reused on the retry', async () => {
    const api = withItem('stop', { reason: 'سبب' });
    api.programmes.decide.mutate
      .mockRejectedValueOnce(refusal('NOT_FOUND'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'approved' });
    const panel = await openItem(api, 'stop');
    const box = await press(panel, 'admin.programme.decision.stop.approve');
    const confirm = box.getByRole('button', { name: ar('admin.programme.decide.confirm') });
    fireEvent.click(confirm);
    expect(await box.findByText(ar('admin.programme.decide.refused.notFound'))).toBeTruthy();
    fireEvent.click(confirm);
    expect(await box.findByText(ar('admin.dialogs.submitError'))).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.programmes.decide.mutate).toHaveBeenCalledTimes(3));
    const keys = api.programmes.decide.mutate.mock.calls.map(
      ([input]) => (input as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(1);
  });
});

describe('reopening a stopped programme (FR-727; R-513)', () => {
  const stopped = () =>
    detailOf({
      state: 'closed',
      closedAt: daysAgo(1),
      cardSaved: false,
      assessmentHeld: true,
      requests: [requestOf('stop', { status: 'approved', reason: 'سبب', decidedAt: daysAgo(1) })],
    });

  it('explains the reopen and its effects, asks a reason, and sends it with a key, in both languages', async () => {
    await inBothLocales(
      () => {
        const api = fakeApi();
        api.programmes.get.query.mockResolvedValue(stopped());
        return { view: openPage(api, `/programmes?programme=${E1}`).view };
      },
      async (t) => {
        const panel = within(
          await screen.findByRole('complementary', { name: t('admin.programme.detail.a11y') }),
        );
        expect(await panel.findByText(t('admin.programme.reopen.explain'))).toBeTruthy();
        fireEvent.click(panel.getByRole('button', { name: t('admin.programme.reopen.action') }));
        const box = await dialogTitled(t('admin.programme.reopen.title'));
        expect(box.getByText(t('admin.programme.reopen.effects.paused'))).toBeTruthy();
        expect(box.getByText(t('admin.programme.reopen.effects.time'))).toBeTruthy();
        expect(box.getByLabelText(t('admin.programme.reopen.reasonLabel'))).toBeTruthy();
        fireEvent.click(
          box.getByRole('button', { name: t('admin.dialogs.confirm.common.cancel') }),
        );
      },
    );
    const api = fakeApi();
    api.programmes.get.query.mockResolvedValue(stopped());
    api.programmes.reopen.mutate.mockResolvedValue({ state: 'paused' });
    openPage(api, `/programmes?programme=${E1}`);
    fireEvent.click(
      await screen.findByRole('button', { name: ar('admin.programme.reopen.action') }),
    );
    const box = await dialogTitled(ar('admin.programme.reopen.title'));
    const confirm = box.getByRole('button', { name: ar('admin.programme.reopen.confirm') });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(box.getByLabelText(ar('admin.programme.reopen.reasonLabel')), {
      target: { value: '  اتفق الطرفان على الاستمرار  ' },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.programmes.reopen.mutate).toHaveBeenCalledTimes(1));
    expect(api.programmes.reopen.mutate.mock.calls[0]?.[0]).toEqual({
      enrollmentId: E1,
      reason: 'اتفق الطرفان على الاستمرار',
      idempotencyKey: expect.stringMatching(KEY),
    });
  });

  it.each([
    ['slot_taken', 'admin.programme.reopen.refused.slotTaken'],
    ['party_restricted', 'admin.programme.reopen.refused.partyRestricted'],
    ['gender_mismatch', 'admin.programme.reopen.refused.genderMismatch'],
    ['not_stopped', 'admin.programme.reopen.refused.notStopped'],
    ['slot_inactive', 'admin.programme.reopen.refused.slotInactive'],
    ['time_taken', 'admin.programme.reopen.refused.timeTaken'],
  ] as const)('says %s in its own words', async (cause, words) => {
    const api = fakeApi();
    api.programmes.get.query.mockResolvedValue(stopped());
    api.programmes.reopen.mutate.mockRejectedValue(
      refusal('CONFLICT', [{ path: 'cause', code: cause }]),
    );
    openPage(api, `/programmes?programme=${E1}`);
    fireEvent.click(
      await screen.findByRole('button', { name: ar('admin.programme.reopen.action') }),
    );
    const box = await dialogTitled(ar('admin.programme.reopen.title'));
    fireEvent.change(box.getByLabelText(ar('admin.programme.reopen.reasonLabel')), {
      target: { value: 'سبب' },
    });
    fireEvent.click(box.getByRole('button', { name: ar('admin.programme.reopen.confirm') }));
    expect(await box.findByText(ar(words))).toBeTruthy();
  });

  it('offers no reopen on a programme no approved stop closed', async () => {
    const api = fakeApi();
    api.programmes.get.query.mockResolvedValue(
      detailOf({ state: 'closed', closedAt: daysAgo(1), assessmentHeld: true }),
    );
    openPage(api, `/programmes?programme=${E1}`);
    const panel = within(
      await screen.findByRole('complementary', { name: ar('admin.programme.detail.a11y') }),
    );
    await panel.findByText(ar('admin.programme.state.closed'));
    expect(panel.queryByRole('button', { name: ar('admin.programme.reopen.action') })).toBeNull();
  });
});
