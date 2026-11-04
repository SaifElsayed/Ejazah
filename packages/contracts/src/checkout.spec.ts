// T031 — the `checkout` schemas of specs/003-booking/contracts/app-surface.md (FR-351 to FR-358,
// FR-380 to FR-386). Written before the schemas, and run red first.
//
// The student names the package, the slot, the hold or the enrollment, and never who asks: a
// gender, a user id or a role sent is stripped, never read (R-GENDER-4). `hold`, `pay` and `retry`
// are keyed (FR-357), so they carry the kernel's idempotency key and are listed among the keyed
// procedures. Money crosses as whole piasters (R-MONEY-1); instants as UTC, a session with its local
// date, local start and zone beside them (R-TIME-6). The status is the server's row and nothing the
// client holds (R-HONEST-1); the hosted checkout's address is a web address and nothing else.
import { describe, expect, it } from 'vitest';

import {
  checkoutContinueInput,
  checkoutContinueOutput,
  checkoutCurrentOutput,
  checkoutHoldInput,
  checkoutHoldOutput,
  checkoutPayInput,
  checkoutPayOutput,
  checkoutRetryInput,
  checkoutRetryOutput,
  checkoutStatusInput,
  checkoutStatusOutput,
  checkoutSummary,
  enrollmentCancellationReason,
  enrollmentSession,
  enrollmentStatus,
  paymentStatus,
} from './checkout.js';
import { idempotentProcedures, isIdempotentProcedure } from './idempotent-procedures.js';

const ids = {
  subject: '0199d0a0-0000-7000-8000-000000000051',
  teacher: '0199d0a0-0000-7000-8000-0000000000c1',
  package: '0199d0a0-0000-7000-8000-0000000000a1',
  slot: '0199d0a0-0000-7000-8000-0000000000b1',
  hold: '0199d0a0-0000-7000-8000-0000000000d1',
  enrollment: '0199d0a0-0000-7000-8000-0000000000e1',
};

const attempt = 'checkout-0199d0a0-0000-7000';
/** The summary the student saw, as `checkout.pay` sends it (the owner's decisions of 2026-11-03). */
const quoted = {
  price_piasters: 150_000,
  sessionCount: 4,
  sessionDurationMinutes: 60,
  track: 'recitation',
};

const summary = {
  teacher: { teacherId: ids.teacher, displayName: 'أحمد سالم' },
  subject: { id: ids.subject, nameAr: 'حفظ القرآن', nameEn: 'Quran memorisation' },
  track: 'recitation',
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: 120_000,
} as const;

const firstSession = { localDate: '2026-11-08', startsAt: '2026-11-08T15:00:00.000Z' } as const;
const lastSession = { localDate: '2026-12-27', startsAt: '2026-12-27T15:00:00.000Z' } as const;

const session = {
  sequenceNumber: 1,
  localDate: '2026-11-08',
  startTimeLocal: '17:00',
  timezone: 'Africa/Cairo',
  startsAt: '2026-11-08T15:00:00.000Z',
  endsAt: '2026-11-08T15:45:00.000Z',
} as const;

const handover = {
  checkoutUrl: 'https://pay.example/checkout/ord_123?token=abc',
  orderExpiresAt: '2026-11-05T10:10:00.000Z',
} as const;

const status = {
  status: 'confirmed',
  lastOrder: { status: 'paid', reference: 'ord_123' },
  summary,
  sessions: [session],
  firstSessionMoved: { quoted: '2026-11-08', actual: '2026-11-15' },
} as const;

/** Whether an input schema's keys name the requester rather than what is asked for. */
function namesTheRequester(schema: { shape: object }): string[] {
  return Object.keys(schema.shape).filter((name) => /^(user)(Id)?$|gender|role/i.test(name));
}

const inputs = {
  checkoutHoldInput,
  checkoutPayInput,
  checkoutRetryInput,
  checkoutContinueInput,
  checkoutStatusInput,
};

describe('every checkout input names what is asked for, never who asks (R-GENDER-4)', () => {
  it('has no gender, user id or role among its fields', () => {
    for (const schema of Object.values(inputs)) {
      expect(namesTheRequester(schema)).toEqual([]);
    }
  });

  it('strips a gender, a user id or a role it was sent', () => {
    const sent = { gender: 'female', userId: ids.teacher, role: 'teacher' };
    expect(
      checkoutHoldInput.parse({
        packageId: ids.package,
        slotId: ids.slot,
        idempotencyKey: attempt,
        ...sent,
      }),
    ).toEqual({ packageId: ids.package, slotId: ids.slot, idempotencyKey: attempt });
    expect(
      checkoutPayInput.parse({
        holdId: ids.hold,
        quoted,
        idempotencyKey: attempt,
        ...sent,
      }),
    ).toEqual({ holdId: ids.hold, quoted, idempotencyKey: attempt });
    expect(
      checkoutRetryInput.parse({ enrollmentId: ids.enrollment, idempotencyKey: attempt, ...sent }),
    ).toEqual({ enrollmentId: ids.enrollment, idempotencyKey: attempt });
    for (const schema of [checkoutContinueInput, checkoutStatusInput]) {
      expect(schema.parse({ enrollmentId: ids.enrollment, ...sent })).toEqual({
        enrollmentId: ids.enrollment,
      });
    }
  });
});

describe('pay carries the summary the student saw (T036, the owner’s decisions of 2026-11-03)', () => {
  const body = { holdId: ids.hold, idempotencyKey: attempt };

  it('requires the price, the session count, the length and the track', () => {
    expect(checkoutPayInput.safeParse({ ...body, quoted }).success).toBe(true);
    expect(checkoutPayInput.safeParse(body).success).toBe(false);
    for (const field of ['price_piasters', 'sessionCount', 'sessionDurationMinutes', 'track']) {
      const rest = Object.fromEntries(Object.entries(quoted).filter(([name]) => name !== field));
      expect(checkoutPayInput.safeParse({ ...body, quoted: rest }).success, field).toBe(false);
    }
  });

  it('refuses a price that is not a positive whole number of piasters, and values no package holds', () => {
    for (const change of [
      { price_piasters: 0 },
      { price_piasters: -1 },
      { price_piasters: 1.5 },
      { price_piasters: '150000' },
      { sessionCount: 0 },
      { sessionCount: 53 },
      { sessionDurationMinutes: 50 },
      { track: 'other' },
    ]) {
      const changed = { ...body, quoted: { ...quoted, ...change } };
      expect(checkoutPayInput.safeParse(changed).success, JSON.stringify(change)).toBe(false);
    }
  });
});

describe('hold, pay and retry are keyed (FR-357)', () => {
  it('each requires the kernel’s idempotency key and refuses a malformed one', () => {
    const bodies = [
      [checkoutHoldInput, { packageId: ids.package, slotId: ids.slot }],
      [checkoutPayInput, { holdId: ids.hold, quoted }],
      [checkoutRetryInput, { enrollmentId: ids.enrollment }],
    ] as const;
    for (const [schema, body] of bodies) {
      expect(schema.safeParse({ ...body, idempotencyKey: attempt }).success).toBe(true);
      for (const idempotencyKey of [
        undefined,
        '',
        'short',
        'has space 0123456789',
        'x'.repeat(129),
      ]) {
        expect(schema.safeParse({ ...body, idempotencyKey }).success).toBe(false);
      }
    }
  });

  it('the three are keyed procedures, beside those already listed (additive, R-API-9)', () => {
    for (const procedure of ['checkout.hold', 'checkout.pay', 'checkout.retry']) {
      expect(isIdempotentProcedure(procedure)).toBe(true);
    }
    for (const published of [
      'teacher.application.submit',
      'account.delete',
      'teacher.payout.register',
      'teacher.packages.create',
      'teacher.slots.create',
    ]) {
      expect(idempotentProcedures).toContain(published);
    }
  });

  it('the reads and `continue` are not keyed', () => {
    for (const procedure of ['checkout.current', 'checkout.continue', 'checkout.status']) {
      expect(isIdempotentProcedure(procedure)).toBe(false);
    }
  });
});

describe('checkout.hold (FR-351 to FR-353, FR-358, FR-386)', () => {
  it('names the package and the slot, by id', () => {
    for (const body of [
      { slotId: ids.slot, idempotencyKey: attempt },
      { packageId: ids.package, idempotencyKey: attempt },
      { packageId: 'hifz-8', slotId: ids.slot, idempotencyKey: attempt },
      { packageId: ids.package, slotId: 'sunday-5pm', idempotencyKey: attempt },
    ]) {
      expect(checkoutHoldInput.safeParse(body).success).toBe(false);
    }
  });

  it('answers the hold, its expiry, the last moment Pay is accepted, the summary and the two session previews', () => {
    const output = {
      holdId: ids.hold,
      expiresAt: '2026-11-05T10:15:00.000Z',
      payBy: '2026-11-05T10:10:00.000Z',
      summary,
      firstSession,
      lastSession,
    };
    expect(checkoutHoldOutput.parse(output)).toEqual(output);
    for (const missing of [
      'holdId',
      'expiresAt',
      'payBy',
      'summary',
      'firstSession',
      'lastSession',
    ]) {
      const { [missing]: _gone, ...rest } = output as Record<string, unknown>;
      expect(checkoutHoldOutput.safeParse(rest).success).toBe(false);
    }
    expect(
      checkoutHoldOutput.safeParse({ ...output, expiresAt: '2026-11-05T12:15:00+02:00' }).success,
    ).toBe(false);
    expect(
      checkoutHoldOutput.safeParse({ ...output, payBy: '2026-11-05T12:10:00+02:00' }).success,
    ).toBe(false);
  });
});

describe('the payment summary (FR-358)', () => {
  it('is the teacher, then the package as subject, sessions and minutes with its track, then the price', () => {
    expect(checkoutSummary.parse(summary)).toEqual(summary);
  });

  it('refuses a price that is not whole piasters above zero, and pounds as text (R-MONEY-1)', () => {
    for (const price_piasters of [0, -100, 1200.5, '1200', undefined]) {
      expect(checkoutSummary.safeParse({ ...summary, price_piasters }).success).toBe(false);
    }
  });

  it('refuses a package the database would refuse (ERD §15 rule 36)', () => {
    for (const change of [
      { sessionCount: 0 },
      { sessionCount: 53 },
      { sessionDurationMinutes: 50 },
      { track: 'tajweed' },
      { teacher: { displayName: 'أحمد سالم' } },
    ]) {
      expect(checkoutSummary.safeParse({ ...summary, ...change }).success).toBe(false);
    }
  });

  it('strips a stored field it does not name: no gender, account or payout of the teacher (R-HONEST-4)', () => {
    const parsed = checkoutSummary.parse({
      ...summary,
      teacher: { ...summary.teacher, gender: 'male', photoKey: 'photos/x', payoutAccountRef: 'r' },
      packageId: ids.package,
      isActive: true,
    });
    for (const field of ['gender', 'photoKey', 'payoutAccountRef']) {
      expect(parsed.teacher).not.toHaveProperty(field);
    }
    expect(parsed).not.toHaveProperty('isActive');
  });
});

describe('checkout.pay (FR-354, FR-355)', () => {
  it('names the hold, by id', () => {
    expect(checkoutPayInput.safeParse({ idempotencyKey: attempt }).success).toBe(false);
    expect(checkoutPayInput.safeParse({ holdId: 'h1', idempotencyKey: attempt }).success).toBe(
      false,
    );
  });

  it('answers the enrollment, the hosted checkout and the order’s expiry', () => {
    const output = { enrollmentId: ids.enrollment, ...handover };
    expect(checkoutPayOutput.parse(output)).toEqual(output);
    expect(checkoutPayOutput.safeParse(handover).success).toBe(false);
  });

  it('accepts the stand-in’s page on a development origin', () => {
    const local = { ...handover, checkoutUrl: 'http://10.0.2.2:3000/stand-in/checkout/ord_1' };
    expect(checkoutRetryOutput.parse(local)).toEqual(local);
  });

  it('refuses an address that is not a web address the phone may open', () => {
    for (const checkoutUrl of [
      '',
      'pay.example/checkout',
      'javascript:alert(1)',
      'ijazah://checkout/return',
      'file:///etc/passwd',
      'data:text/html,hi',
    ]) {
      expect(
        checkoutPayOutput.safeParse({ enrollmentId: ids.enrollment, ...handover, checkoutUrl })
          .success,
      ).toBe(false);
    }
  });

  it('refuses an order expiry that is not a UTC instant', () => {
    for (const orderExpiresAt of ['2026-11-05 12:10', '2026-11-05T12:10:00+02:00', 600]) {
      expect(checkoutRetryOutput.safeParse({ ...handover, orderExpiresAt }).success).toBe(false);
    }
  });
});

describe('checkout.retry and checkout.continue (FR-356, FR-BOOK-12 (c))', () => {
  it('name the enrollment, by id', () => {
    expect(checkoutRetryInput.safeParse({ idempotencyKey: attempt }).success).toBe(false);
    expect(checkoutContinueInput.safeParse({}).success).toBe(false);
    expect(checkoutContinueInput.safeParse({ enrollmentId: 'e1' }).success).toBe(false);
  });

  it('answer the hosted checkout and the order’s expiry, and nothing stored beside them', () => {
    for (const schema of [checkoutRetryOutput, checkoutContinueOutput]) {
      expect(schema.parse(handover)).toEqual(handover);
      const parsed = schema.parse({
        ...handover,
        checkoutUrlEncrypted: 'x',
        gatewayOrderId: 'ord_123',
      });
      expect(parsed).toEqual(handover);
    }
  });
});

describe('checkout.current (FR-BOOK-12, CheckoutPrevious)', () => {
  it('answers no hold as an empty object', () => {
    expect(checkoutCurrentOutput.parse({})).toEqual({});
  });

  it('answers the hold before Pay, with no enrollment and no order', () => {
    const hold = {
      holdId: ids.hold,
      expiresAt: '2026-11-05T10:15:00.000Z',
      payBy: '2026-11-05T10:10:00.000Z',
      summary,
      firstSession,
      lastSession,
    };
    expect(checkoutCurrentOutput.parse({ hold })).toEqual({ hold });
    const { payBy: _gone, ...withoutPayBy } = hold;
    expect(checkoutCurrentOutput.safeParse({ hold: withoutPayBy }).success).toBe(false);
  });

  // T085 (FR-386; PR #121's review, round 1, F2): the first and last session the student would get
  // if confirmed now, `booking.slots`' previews, on every hold the answer carries (B30a, additive).
  it('answers the hold with the first and last session previews, both required', () => {
    const hold = {
      holdId: ids.hold,
      expiresAt: '2026-11-05T10:15:00.000Z',
      payBy: '2026-11-05T10:10:00.000Z',
      summary,
      firstSession,
      lastSession,
    };
    expect(checkoutCurrentOutput.parse({ hold }).hold).toMatchObject({ firstSession, lastSession });
    for (const missing of ['firstSession', 'lastSession']) {
      const { [missing]: _gone, ...rest } = hold as Record<string, unknown>;
      expect(checkoutCurrentOutput.safeParse({ hold: rest }).success).toBe(false);
    }
    for (const preview of [
      { localDate: '2026-11-08' },
      { startsAt: '2026-11-08T15:00:00.000Z' },
      { localDate: '08/11/2026', startsAt: '2026-11-08T15:00:00.000Z' },
      { localDate: '2026-11-08', startsAt: '2026-11-08T17:00:00+02:00' },
    ]) {
      expect(
        checkoutCurrentOutput.safeParse({ hold: { ...hold, firstSession: preview } }).success,
      ).toBe(false);
    }
  });

  it('answers the hold with its enrollment and its last order, and whether it can be continued', () => {
    const hold = {
      holdId: ids.hold,
      expiresAt: '2026-11-05T10:15:00.000Z',
      payBy: '2026-11-05T10:10:00.000Z',
      enrollmentId: ids.enrollment,
      summary,
      firstSession,
      lastSession,
      lastOrder: { status: 'created', expiresAt: '2026-11-05T10:10:00.000Z', canContinue: true },
    };
    expect(checkoutCurrentOutput.parse({ hold })).toEqual({ hold });
    for (const lastOrder of [
      { ...hold.lastOrder, status: 'pending' },
      { ...hold.lastOrder, canContinue: 'yes' },
      { status: 'created', canContinue: true },
    ]) {
      expect(checkoutCurrentOutput.safeParse({ hold: { ...hold, lastOrder } }).success).toBe(false);
    }
  });

  it('carries no address: only `continue` reads it back (data-model §2.4.1)', () => {
    const hold = {
      holdId: ids.hold,
      expiresAt: '2026-11-05T10:15:00.000Z',
      payBy: '2026-11-05T10:10:00.000Z',
      summary,
      firstSession,
      lastSession,
      lastOrder: {
        status: 'created',
        expiresAt: '2026-11-05T10:10:00.000Z',
        canContinue: true,
        checkoutUrl: handover.checkoutUrl,
      },
      checkoutUrl: handover.checkoutUrl,
    };
    const parsed = checkoutCurrentOutput.parse({ hold });
    expect(parsed.hold).not.toHaveProperty('checkoutUrl');
    expect(parsed.hold?.lastOrder).not.toHaveProperty('checkoutUrl');
  });
});

describe('checkout.status (FR-380 to FR-386)', () => {
  it('names the enrollment, by id', () => {
    expect(checkoutStatusInput.parse({ enrollmentId: ids.enrollment })).toEqual({
      enrollmentId: ids.enrollment,
    });
    expect(checkoutStatusInput.safeParse({}).success).toBe(false);
  });

  it('answers a confirmed enrollment with its sessions and the first session that moved', () => {
    expect(checkoutStatusOutput.parse(status)).toEqual(status);
  });

  it('answers an enrollment awaiting payment with no session', () => {
    const { sessions: _s, firstSessionMoved: _m, ...pending } = status;
    const awaiting = {
      ...pending,
      status: 'pending_payment',
      lastOrder: { ...pending.lastOrder, status: 'created' },
    };
    expect(checkoutStatusOutput.parse(awaiting)).toEqual(awaiting);
  });

  it('answers a cancelled enrollment with its reason', () => {
    const { sessions: _s, firstSessionMoved: _m, ...rest } = status;
    const cancelled = {
      ...rest,
      status: 'cancelled',
      cancellationReason: 'slot_unavailable',
      lastOrder: { ...rest.lastOrder, status: 'paid' },
    };
    expect(checkoutStatusOutput.parse(cancelled)).toEqual(cancelled);
  });

  it('refuses a status, a reason or an order status the database does not hold', () => {
    expect(checkoutStatusOutput.safeParse({ ...status, status: 'paid' }).success).toBe(false);
    expect(checkoutStatusOutput.safeParse({ ...status, status: 'confirming' }).success).toBe(false);
    expect(
      checkoutStatusOutput.safeParse({ ...status, cancellationReason: 'changed_mind' }).success,
    ).toBe(false);
    expect(
      checkoutStatusOutput.safeParse({
        ...status,
        lastOrder: { ...status.lastOrder, status: 'in_progress' },
      }).success,
    ).toBe(false);
  });

  it('requires the last order: its reference is what FR-384’s message gives', () => {
    const { lastOrder: _o, ...noOrder } = status;
    expect(checkoutStatusOutput.safeParse(noOrder).success).toBe(false);
    for (const reference of ['', undefined, 123]) {
      expect(
        checkoutStatusOutput.safeParse({ ...status, lastOrder: { ...status.lastOrder, reference } })
          .success,
      ).toBe(false);
    }
  });

  it('names no gateway amount: the price is the summary’s, and R-MONEY-6 keeps gross, fee and net in payments', () => {
    expect(Object.keys(checkoutStatusOutput.shape.lastOrder.shape).sort()).toEqual([
      'reference',
      'status',
    ]);
  });

  it('strips what the order row holds and the student is not shown: transaction, address, payload (R-HONEST-4)', () => {
    const parsed = checkoutStatusOutput.parse({
      ...status,
      confirmedAt: '2026-11-05T10:05:00.000Z',
      lastOrder: {
        ...status.lastOrder,
        gatewayTransactionId: 'txn_9',
        checkoutUrlEncrypted: 'x',
        payloadHash: 'abc',
      },
    });
    for (const field of ['gatewayTransactionId', 'checkoutUrlEncrypted', 'payloadHash']) {
      expect(parsed.lastOrder).not.toHaveProperty(field);
    }
    expect(parsed).not.toHaveProperty('confirmedAt');
  });

  it('the first session that moved is two local dates', () => {
    for (const firstSessionMoved of [
      { quoted: '2026-11-08' },
      { quoted: '2026-11-08', actual: '2026-11-15T15:00:00.000Z' },
    ]) {
      expect(checkoutStatusOutput.safeParse({ ...status, firstSessionMoved }).success).toBe(false);
    }
  });
});

describe('a session in an output (R-TIME-6, FR-393)', () => {
  it('is its local date, local start and zone, and its two instants', () => {
    expect(enrollmentSession.parse(session)).toEqual(session);
  });

  it('refuses one without its zone, without an instant, or numbered from zero', () => {
    for (const change of [
      { timezone: '' },
      { timezone: undefined },
      { endsAt: undefined },
      { startsAt: '2026-11-08T17:00:00+02:00' },
      { startTimeLocal: '17:00:00' },
      { sequenceNumber: 0 },
      { sequenceNumber: 1.5 },
    ]) {
      expect(enrollmentSession.safeParse({ ...session, ...change }).success).toBe(false);
    }
  });
});

describe('the enums mirror the database’s (ERD §7, base.prisma)', () => {
  it('an enrollment’s status', () => {
    expect(enrollmentStatus.options).toEqual([
      'pending_payment',
      'confirmed',
      'completed',
      'terminated_no_show',
      'cancelled',
    ]);
  });

  it('an enrollment’s cancellation reason', () => {
    expect(enrollmentCancellationReason.options).toEqual([
      'payment_expired',
      'payment_failed',
      'admin',
      'gender_correction',
      'teacher_suspended',
      'slot_unavailable',
      'checkout_abandoned',
      'account_deleted',
    ]);
  });

  it('an order’s status', () => {
    expect(paymentStatus.options).toEqual(['created', 'paid', 'failed', 'expired', 'refunded']);
  });
});
