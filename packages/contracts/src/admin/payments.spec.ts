// 003:T124 (SRS DEC-91, FR-ADMIN-5, FR-AUTH-11; ADR 0018 D5; Q-7 (a), Q-7a (a), Q-7b (a)) — the case
// amount of a close on a student's ban or confirmed fault, `student_fault_close`: the sessions owed
// before the close as a refund due, the rest not taken as the administrator's decision (no refund
// shown for it), the teacher's release as today, and the refunds already recorded. Added to
// `paymentsCaseAmount` additively (R-API-9). Written before the member, run red first. T110's
// three causes stay covered in `apps/api/src/modules/payments/payments-admin.contract.spec.ts`.
import { describe, expect, it } from 'vitest';

import { paymentsCaseAmountOutput } from './payments.js';

// The task's example: 8 sessions of 1,000 EGP (125 each), 3 delivered, 1 missed by the student,
// 1 by the teacher, 3 cancelled by the close, a 70 % share: owed 125 EGP, the decision 375 EGP,
// the teacher's release 350 EGP (4 × 87.50).
const FAULT = {
  cause: 'student_fault_close',
  owed_piasters: 12_500,
  decision_piasters: 37_500,
  release_piasters: 35_000,
  refunded_piasters: 0,
};

describe('payments.caseAmount: a close on a student’s ban or confirmed fault (003:T124)', () => {
  it('answers the owed refund, the administrator’s decision, the release and the refunds recorded', () => {
    const answered = paymentsCaseAmountOutput.safeParse({ amount: FAULT });
    expect(answered.success).toBe(true);
    expect(answered.data).toEqual({ amount: FAULT });
  });

  it('refuses a missing part, a negative or fractional amount, and a refund for the decided part', () => {
    const { owed_piasters: _owed, ...withoutOwed } = FAULT;
    const { decision_piasters: _decision, ...withoutDecision } = FAULT;
    for (const amount of [
      withoutOwed,
      withoutDecision,
      { ...FAULT, decision_piasters: -1 },
      { ...FAULT, release_piasters: 0.5 },
    ]) {
      expect(paymentsCaseAmountOutput.safeParse({ amount }).success, JSON.stringify(amount)).toBe(
        false,
      );
    }
    // No refund is shown for the decided part: a `refund_piasters` part is not this cause's.
    const stripped = paymentsCaseAmountOutput.safeParse({
      amount: { ...FAULT, refund_piasters: 1 },
    });
    expect(stripped.data?.amount).toEqual(FAULT);
  });
});

// 003:T125 (SRS DEC-104, DEC-96; Q-3 (a)): the case of an end by the administration (the student's
// stop, a student's deletion by an administrator, a gender correction), `direct_end`: the refund of
// the sessions not taken and the teacher's release of those consumed, less what was already
// released. Added additively (R-API-9). Written before the member, run red first.
describe('payments.caseAmount: an end by the administration (003:T125)', () => {
  // Ijazah, 10 sessions of 1,000 EGP, 6 delivered, the half (1,750) released: 4,000 / 2,450 more.
  const DIRECT = {
    cause: 'direct_end',
    refund_piasters: 400_000,
    release_piasters: 245_000,
    refunded_piasters: 0,
  };

  it('answers the refund of what was not taken, the release and the refunds recorded', () => {
    const answered = paymentsCaseAmountOutput.safeParse({ amount: DIRECT });
    expect(answered.success).toBe(true);
    expect(answered.data).toEqual({ amount: DIRECT });
  });
});
