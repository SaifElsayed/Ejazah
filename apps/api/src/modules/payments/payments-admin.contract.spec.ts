// T052 — the monitor's schemas (`@ijazah/contracts/admin`, FR-400, FR-PAYG-7): what a list may ask,
// and that an answer carries the amounts as reported, fee and net only when reported. The cases
// live here, in the payments module, because the gateway's amount names are refused in any file of
// the contracts package but `src/admin/payments.ts` itself (`paymentFolders`, the owner's decision
// of 2026-11-04).
//
// Covered elsewhere and not repeated: an unknown status, a blank search and a malformed cursor are
// refused by `payments-admin.router.spec.ts` ("refuses a malformed cursor, an unknown status and an
// empty search as VALIDATION_FAILED, writing nothing"); a field the schema does not name is
// stripped there too ("answers only the fields its schema names", for the list and the detail).
import {
  enrollmentOutcomeKind,
  paymentsCaseAmountInput,
  paymentsCaseAmountOutput,
  paymentsListInput,
  paymentsListItem,
} from '@ijazah/contracts/admin';
import { describe, expect, it } from 'vitest';

const ITEM = {
  paymentId: '0199d0a0-0000-7000-8000-0000000000f1',
  gatewayOrderId: 'fake_order_1',
  createdAt: '2026-11-03T10:00:00.000Z',
  student: { displayName: 'آمال علي' },
  gross_piasters: 120_000,
  // 003:T102: the refunded total, 0 until a refund is recorded.
  refunded_piasters: 0,
  status: 'created',
  enrollmentCancelled: false,
};

describe('payments.list’s input', () => {
  it('takes a status, a search and a cursor, each optional, the search trimmed', () => {
    expect(paymentsListInput.parse({})).toEqual({});
    expect(
      paymentsListInput.parse({ status: 'refunded', search: '  هدى ', cursor: ITEM.paymentId }),
    ).toEqual({ status: 'refunded', search: 'هدى', cursor: ITEM.paymentId });
  });

  it('refuses a search over its bound', () => {
    expect(paymentsListInput.safeParse({ search: 'م'.repeat(101) }).success).toBe(false);
  });

  // B42, T047 (the note under T047, Q6 (a)): one enrollment's orders, the link from `/sessions` and
  // `/cases`; additive (R-API-9).
  it('takes an enrollment id, optional, and refuses one that is not a uuid', () => {
    const enrollmentId = '0199d0a0-0000-7000-8000-0000000000e1';
    expect(paymentsListInput.parse({ enrollmentId })).toEqual({ enrollmentId });
    expect(paymentsListInput.safeParse({ enrollmentId: 'e1' }).success).toBe(false);
  });
});

// B42, T047 (the follow-up under T047): Phase 3's three outcomes of an enrollment on the timeline;
// B42a, T069 (Q-69-1 (a)): the held slot's release and the hold's end, additively.
describe('an enrollment’s outcome kinds', () => {
  it('are Phase 2’s three, Phase 3’s completed, terminated_no_show and restored, and T069’s slot_released and slot_hold_ended', () => {
    expect(enrollmentOutcomeKind.options).toEqual([
      'confirmed',
      'order_failed',
      'cancelled',
      'completed',
      'terminated_no_show',
      'restored',
      'slot_released',
      'slot_hold_ended',
    ]);
  });
});

describe('a listed order', () => {
  it('carries fee and net only when given, and refuses a negative or fractional amount', () => {
    expect(paymentsListItem.parse(ITEM)).toEqual(ITEM);
    const paid = { ...ITEM, status: 'paid', gatewayFee_piasters: 3_480, net_piasters: 116_520 };
    expect(paymentsListItem.parse(paid)).toEqual(paid);
    // A paid order whose gateway reported neither (lane c's Paymob callback) carries neither.
    const unreported = { ...ITEM, status: 'paid' };
    expect(paymentsListItem.parse(unreported)).toEqual(unreported);
    expect(paymentsListItem.safeParse({ ...ITEM, gross_piasters: -1 }).success).toBe(false);
    expect(paymentsListItem.safeParse({ ...ITEM, net_piasters: 1.5 }).success).toBe(false);
  });

  it('always carries its refunded total, never negative or fractional (003:T102, DEC-82)', () => {
    const partly = { ...ITEM, status: 'paid', refunded_piasters: 30_000 };
    expect(paymentsListItem.parse(partly)).toEqual(partly);
    const { refunded_piasters: _absent, ...without } = ITEM;
    expect(paymentsListItem.safeParse(without).success).toBe(false);
    expect(paymentsListItem.safeParse({ ...ITEM, refunded_piasters: -1 }).success).toBe(false);
    expect(paymentsListItem.safeParse({ ...ITEM, refunded_piasters: 0.5 }).success).toBe(false);
  });
});

describe('payments.caseAmount (003:T110, DEC-85, DEC-86)', () => {
  const IJAZAH = {
    cause: 'ijazah_dropout',
    total_piasters: 1_000_000,
    held_piasters: 525_000,
    platformPart_piasters: 300_000,
    released_piasters: 175_000,
    refunded_piasters: 0,
  };
  const RECITATION = {
    cause: 'recitation_dropout',
    refund_piasters: 600_000,
    release_piasters: 280_000,
    refunded_piasters: 0,
  };

  it('takes a case id, a uuid', () => {
    expect(paymentsCaseAmountInput.safeParse({ caseId: 'not-a-uuid' }).success).toBe(false);
  });

  it('answers each cause with its own parts, or no amount', () => {
    expect(paymentsCaseAmountOutput.parse({ amount: IJAZAH })).toEqual({ amount: IJAZAH });
    expect(paymentsCaseAmountOutput.parse({ amount: RECITATION })).toEqual({ amount: RECITATION });
    const complaint = { ...RECITATION, cause: 'student_complaint_close' };
    expect(paymentsCaseAmountOutput.parse({ amount: complaint })).toEqual({ amount: complaint });
    expect(paymentsCaseAmountOutput.parse({})).toEqual({});
  });

  it('refuses an unknown cause, a missing part, and a negative or fractional amount', () => {
    const refused = [
      { ...RECITATION, cause: 'admin_ended' },
      { ...IJAZAH, held_piasters: undefined },
      { ...RECITATION, refund_piasters: -1 },
      { ...IJAZAH, platformPart_piasters: 0.5 },
    ];
    for (const amount of refused) {
      expect(paymentsCaseAmountOutput.safeParse({ amount }).success).toBe(false);
    }
  });
});
