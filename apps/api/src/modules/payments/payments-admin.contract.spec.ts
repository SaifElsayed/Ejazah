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

// B42, T047 (the follow-up under T047): Phase 3's three outcomes of an enrollment on the timeline.
describe('an enrollment’s outcome kinds', () => {
  it('are Phase 2’s three and Phase 3’s completed, terminated_no_show and restored', () => {
    expect(enrollmentOutcomeKind.options).toEqual([
      'confirmed',
      'order_failed',
      'cancelled',
      'completed',
      'terminated_no_show',
      'restored',
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
});
