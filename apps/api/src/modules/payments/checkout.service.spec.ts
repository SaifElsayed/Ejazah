// T036, T037 — the checkout's orchestration (ARCHITECTURE §8.1, FR-BOOK-12, FR-354 to FR-357; the
// owner's decisions of 2026-11-03: keyed in two steps), over fakes standing for the idempotency
// store, the gateway, the cipher and the transaction-level steps. What the fakes show plainly: that
// the gateway is called outside any transaction and never for a completed key, that a payable
// previous order is cancelled before the hold is placed again, and that an order the transaction
// refused or a duplicate made unnecessary is cancelled at the gateway. Over the real tables and the
// stand-in gateway: `tests/db-integrity/checkout.spec.ts`.
import { piasters } from '@ijazah/money';
import { addSeconds } from '@ijazah/time';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { JsonValue } from '../../platform/idempotency/idempotency.service.js';
import type {
  CancelOutcome,
  Checkout,
  CheckoutPayee,
} from '../../platform/ports/payment/payment.port.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import {
  type CheckoutHold,
  type CheckoutEnrollmentRow,
  type HeldRow,
  PayableCheckout,
} from '../booking/index.js';
import type { ProgrammePayTarget, ProgrammeRenewTarget } from '../booking/index.js';
import type { AssessmentOrder } from './checkout.repository.js';
import { CHECKOUT_URL_COLUMN, CheckoutService, type CheckoutSteps } from './checkout.service.js';
import { createProgrammePayee, type PaymentMode } from './programme-payee.js';

const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const STUDENT = id(10);
const TEACHER = id(90);
const PACKAGE = id(30);
const SLOT = id(40);
const HOLD = id(50);
const ENROLLMENT = id(60);
const PAYMENT = id(70);
const OTHER_PAYMENT = id(71);
const KEY = 'checkout-attempt-0001';
const student = { userId: STUDENT, gender: 'female' as RequesterGender };

/** Tuesday 2026-11-03, 10:00 in Cairo. */
const NOW = new Date('2026-11-03T08:00:00Z');
/** The hold placed at NOW: ten minutes of checkout and five of grace. */
const HOLD_EXPIRES = new Date('2026-11-03T08:15:00Z');
const ORDER_EXPIRES = new Date('2026-11-03T08:10:00Z');

/**
 * 006:T009: an offer of 40 sessions at 250 EGP, 10,000 EGP in all (10 months of 1,000), its 48 hours
 * ending Thursday 2026-11-05 at 08:00Z; the assessment paid 500 EGP at 70 % and 25 %.
 */
const PROGRAMME: ProgrammePayTarget = {
  enrollmentId: ENROLLMENT,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
  track: 'ijazah_track',
  payByAt: new Date('2026-11-05T08:00:00Z'),
  offerSessionCount: 40,
  total_piasters: piasters(1_000_000),
};
/** 006:T016: month 2 of that offer by hand, 4 × 250 = 1,000 EGP. */
const RENEW: ProgrammeRenewTarget = {
  enrollmentId: ENROLLMENT,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
  track: 'ijazah_track',
  instalmentMonth: 2,
  offerSessionCount: 40,
  total_piasters: piasters(1_000_000),
};
const ASSESSMENT_ORDER: AssessmentOrder = {
  gross_piasters: piasters(50_000),
  teacherShareRatePercent: 70,
  halfReleaseRatePercent: 25,
};

const settings: SettingsReader = {
  read: async (key, schema) =>
    schema.parse(
      {
        slot_hold_ttl_minutes: 10,
        slot_hold_grace_minutes: 5,
        first_session_lead_hours: 24,
        slot_release_buffer_weeks: 0,
        teacher_share_percent: 70,
        // 003:T105: the ijazah half's percent, the seed's.
        ijazah_half_release_percent: 25,
        // 006:T005: the programme on, its assessment 30 minutes at 200 EGP.
        programme_enabled: 1,
        assessment_price_piasters: 20_000,
        assessment_duration_minutes: 30,
        // 006:T016: the early-renewal days, the seed's.
        programme_renew_early_days: 3,
      }[key],
    ),
};

/** A key store with Postgres's visible behaviour: a repeat answers the first outcome. */
function fakeIdempotency(log: unknown[][]) {
  const stored = new Map<string, JsonValue>();
  let competitor: JsonValue | undefined;
  return {
    stored,
    /** The next `run` meets a duplicate that committed this outcome first. */
    duplicateFirst(outcome: JsonValue) {
      competitor = outcome;
    },
    service: {
      completed: async <T extends JsonValue>(request: { key: string; scope: string }) => {
        log.push(['key read', request.scope]);
        return stored.get(`${request.scope}:${request.key}`) as T | undefined;
      },
      run: async <T extends JsonValue>(
        request: { key: string; scope: string },
        effect: (tx: Transaction) => Promise<T>,
      ) => {
        const name = `${request.scope}:${request.key}`;
        if (competitor !== undefined) {
          stored.set(name, competitor);
          competitor = undefined;
        }
        const first = stored.get(name);
        if (first !== undefined) return first as T;
        log.push(['transaction']);
        const outcome = await effect({} as Transaction);
        log.push(['commit']);
        stored.set(name, outcome);
        return outcome;
      },
    },
  };
}

const heldAnswer: CheckoutHold = {
  holdId: HOLD,
  expiresAt: HOLD_EXPIRES,
  summary: {
    teacher: { teacherId: TEACHER, displayName: 'الشيخ' },
    subject: { id: id(5), nameAr: 'تجويد', nameEn: 'Tajweed' },
    track: 'recitation',
    sessionCount: 4,
    sessionDurationMinutes: 60,
    price_piasters: 100_000,
  },
  firstSession: {
    requestedLocalDate: '2026-11-05',
    startsAt: '2026-11-05T07:00:00.000Z',
  } as unknown as CheckoutHold['firstSession'],
  lastSession: {
    requestedLocalDate: '2026-11-26',
    startsAt: '2026-11-26T07:00:00.000Z',
  } as unknown as CheckoutHold['lastSession'],
};

/** The first and last session `checkout.current` answers, as booking's `currentHoldOf` previews them (T085). */
const FIRST_SESSION = { localDate: '2026-11-05', startsAt: '2026-11-05T07:00:00.000Z' };
const LAST_SESSION = { localDate: '2026-11-26', startsAt: '2026-11-26T07:00:00.000Z' };

const enrollmentRow: CheckoutEnrollmentRow = {
  id: ENROLLMENT,
  studentUserId: STUDENT,
  teacherUserId: TEACHER,
  packageId: PACKAGE,
  slotId: SLOT,
  status: 'pending_payment',
  cancellationReason: null,
  snapshotPricePiasters: 100_000n,
  snapshotSessionCount: 4,
  snapshotDurationMinutes: 60,
  snapshotSubjectId: id(5),
  snapshotSlotTimezone: 'Africa/Cairo',
  snapshotTrack: 'recitation',
  quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
};
const holdRow: HeldRow = {
  id: HOLD,
  slotId: SLOT,
  studentUserId: STUDENT,
  enrollmentId: ENROLLMENT,
  expiresAt: HOLD_EXPIRES,
};

interface World {
  /** What each placement attempt does, in turn; the last repeats. */
  readonly placements?: readonly (CheckoutHold | Error)[];
  readonly cancel?: CancelOutcome;
  readonly hold?: HeldRow | null;
  readonly targetError?: Error;
  readonly lockError?: Error;
  /** The order's row a repeat reads its address again from. */
  readonly order?: { status: 'created' | 'paid' | 'failed' | 'expired'; expiresAt: Date } | null;
  readonly enrollment?: CheckoutEnrollmentRow | null;
  readonly current?: {
    holdId: string;
    expiresAt: Date;
    enrollmentId: string | null;
    summary: CheckoutHold['summary'];
    firstSession: typeof FIRST_SESSION;
    lastSession: typeof LAST_SESSION;
  } | null;
  readonly now?: Date;
  readonly cancelFails?: boolean;
  readonly payTargetError?: Error;
  /** T104: the teacher's share setting, when not the seed's 70. */
  readonly sharePercent?: number;
  /** 003:T105: the enrollment a retry reads, when not the recitation one. */
  readonly retryEnrollment?: CheckoutEnrollmentRow;
  /** 003:T105: the ijazah half's percent setting, when not the seed's 25. */
  readonly halfPercent?: number;
  /** T101: the teacher's verified payout recipient; none by default. */
  readonly recipient?: string | null;
  /** T175: the teacher's name a replay reads through visibility; null once not visible. */
  readonly visibleName?: string | null;
  /** 006:T005: the order's kind the retry's target and Pay's target answer; `package` by default. */
  readonly kind?: 'package' | 'assessment';
  /** 006:T005: the switch, when not on. */
  readonly programmeEnabled?: number;
  /** 006:T009: what booking's programme.pay check answers, when not the default offer. */
  readonly programme?: Partial<ProgrammePayTarget>;
  /** 006:T009: the check's refusal, before the gateway (`first`) or under the record's locks. */
  readonly programmeRefusal?: { readonly at: 'first' | 'record'; readonly error: Error };
  /** 006:T009: the programme's assessment order, when not the default's 500 EGP at 70 % and 25 %. */
  readonly assessmentOrder?: AssessmentOrder;
  /** 006:T009 (Q-C2 (a)): the student's payable programme order; none by default. */
  readonly programmeOrder?: { readonly enrollmentId: string; readonly expiresAt: Date };
  /**
   * 006:T016: the payment mode T008's «unverified in live mode» is bound over (its real entry, the
   * recipient read as `recipient`); none bound by default.
   */
  readonly paymentMode?: PaymentMode;
  /** 006:T016: what booking's programme.renew check answers, when not month 2 of the default offer. */
  readonly renew?: Partial<ProgrammeRenewTarget>;
  /** 006:T016: the renewal check's refusal, before the gateway (`first`) or under the record's locks. */
  readonly renewRefusal?: { readonly at: 'first' | 'record'; readonly error: Error };
}

function setUp(world: World = {}) {
  const log: unknown[][] = [];
  const inserted: Parameters<CheckoutSteps['insertOrder']>[1][] = [];
  /** T101: the payee each gateway order was asked with, and whose recipient was read. */
  const payees: (CheckoutPayee | undefined)[] = [];
  /** 006:T013: the `saveCard` each gateway order was asked with (R-510). */
  const saveCards: (boolean | undefined)[] = [];
  const recipientsAsked: string[] = [];
  const readers: unknown[] = [];
  const idempotency = fakeIdempotency(log);
  let placement = 0;
  let draws = 0;
  let orders = 0;
  let checks = 0;
  let renewChecks = 0;
  /** 006:T009: what each placement was handed as payments' read of the programme orders. */
  const handed: string[] = [];
  const steps: CheckoutSteps = {
    transaction: async (work) => work({} as Transaction),
    // T175: booking's read through the visibility predicate, as `checkoutHoldStore` reads it.
    teacherName: async (_tx, requester, teacherUserId) => {
      log.push(['teacher name', requester, teacherUserId]);
      return world.visibleName === undefined ? 'الشيخ' : world.visibleName;
    },
    placeHold: async (_tx, who, request, dependencies) => {
      log.push(['place', who.userId, request.slotId, dependencies.terms.now.toISOString()]);
      // 006:T009: payments' read of the student's payable programme orders, handed in.
      handed.push(typeof dependencies.programmeOrders);
      const outcomes = world.placements ?? [heldAnswer];
      const outcome = outcomes[Math.min(placement, outcomes.length - 1)];
      placement += 1;
      if (outcome instanceof Error) throw outcome;
      return outcome ?? heldAnswer;
    },
    retryTarget: async () => {
      log.push(['read target']);
      if (world.targetError !== undefined) throw world.targetError;
      return {
        enrollment: world.retryEnrollment ?? enrollmentRow,
        hold: world.hold === undefined ? holdRow : world.hold,
        // 006:T005 (rule d): the order's kind.
        kind: world.kind ?? 'package',
      };
    },
    lockOrderTarget: async (_tx, target, stillPayable) => {
      log.push(['lock target', target.holdId, stillPayable(HOLD_EXPIRES)]);
      if (world.lockError !== undefined) throw world.lockError;
    },
    insertOrder: async (_tx, order) => {
      inserted.push(order);
      log.push(['insert order', order.id, order.gatewayOrderId, [...order.checkoutUrlEncrypted]]);
    },
    recordCancelled: async (enrollmentId, paymentId) => {
      log.push(['record failed', enrollmentId, paymentId]);
    },
    studentEnrollment: async () =>
      world.enrollment === undefined ? enrollmentRow : world.enrollment,
    orderById: async (_tx, paymentId) => ({
      id: paymentId,
      enrollmentId: ENROLLMENT,
      gatewayOrderId: 'fake_ord_recorded',
      status: world.order?.status ?? 'created',
      expiresAt: world.order?.expiresAt ?? ORDER_EXPIRES,
      checkoutUrlEncrypted: Uint8Array.from([1, 2, 3]),
    }),
    lastOrderOf: async () =>
      world.order === null
        ? null
        : {
            id: PAYMENT,
            enrollmentId: ENROLLMENT,
            gatewayOrderId: 'fake_ord_last',
            status: world.order?.status ?? 'created',
            expiresAt: world.order?.expiresAt ?? ORDER_EXPIRES,
            checkoutUrlEncrypted:
              (world.order?.status ?? 'created') === 'created' ? Uint8Array.from([1, 2, 3]) : null,
          },
    currentHold: async (_tx, who, rule) => {
      log.push(['current hold', who.userId, rule.now.toISOString(), rule.leadHours]);
      return world.current === undefined
        ? {
            holdId: HOLD,
            expiresAt: HOLD_EXPIRES,
            enrollmentId: ENROLLMENT,
            summary: heldAnswer.summary,
            firstSession: FIRST_SESSION,
            lastSession: LAST_SESSION,
          }
        : world.current;
    },
    enrollmentStatus: async () => {
      if (world.enrollment === null) throw new DomainError('NOT_FOUND');
      return { enrollmentId: ENROLLMENT, status: 'pending_payment', summary: heldAnswer.summary };
    },
    drawRowId: async () => {
      draws += 1;
      log.push(['draw', draws]);
      return draws === 1 ? PAYMENT : id(100 + draws);
    },
    payTarget: async (_tx, request, quoted) => {
      log.push(['read pay target', request.holdId, quoted.price_piasters]);
      if (world.payTargetError !== undefined) throw world.payTargetError;
      const hold = {
        id: HOLD,
        slotId: SLOT,
        studentUserId: STUDENT,
        packageId: PACKAGE,
        sessionCount: 4,
        enrollmentId: null,
        expiresAt: world.hold?.expiresAt ?? HOLD_EXPIRES,
        releasedAt: null,
      };
      // 006:T005 (rule d): the order's kind, an assessment priced by the fee.
      return world.kind === 'assessment'
        ? {
            hold,
            packageId: PACKAGE,
            teacherUserId: TEACHER,
            kind: 'assessment',
            price_piasters: null,
          }
        : {
            hold,
            packageId: PACKAGE,
            teacherUserId: TEACHER,
            kind: 'package',
            price_piasters: piasters(100_000),
          };
    },
    payoutRecipient: async (teacherUserId) => {
      recipientsAsked.push(teacherUserId);
      return world.recipient ?? null;
    },
    enrollOnHold: async (_tx, target, enrolment) => {
      log.push(['enroll', target.hold.id, enrolment.enrollmentId, enrolment.leadHours]);
      // 006:T005: the programme's reader reaches the enrolment's check under the locks.
      readers.push(await enrolment.programme?.());
      if (world.lockError !== undefined) throw world.lockError;
    },
    // 006:T009: booking's check of programme.pay, before the gateway and under the record's locks.
    programmePayTarget: async (_tx, request, dependencies) => {
      checks += 1;
      log.push(['programme check', request.studentUserId, request.enrollmentId, checks]);
      expect(typeof dependencies.orders).toBe('function');
      const refused = world.programmeRefusal;
      if (refused !== undefined && (refused.at === 'first') === (checks === 1)) {
        throw refused.error;
      }
      return { ...PROGRAMME, ...world.programme };
    },
    programmeOrderOf: async (_tx, studentUserId, at) => {
      log.push(['programme order', studentUserId, at.toISOString()]);
      return world.programmeOrder ?? null;
    },
    assessmentOrderOf: async (_tx, enrollmentId) => {
      log.push(['assessment order', enrollmentId]);
      return world.assessmentOrder ?? ASSESSMENT_ORDER;
    },
    // 006:T016: booking's check of programme.renew, before the gateway and under the record's locks.
    programmeRenewTarget: async (_tx, request, dependencies) => {
      renewChecks += 1;
      log.push([
        'renew check',
        request.studentUserId,
        request.enrollmentId,
        dependencies.earlyDays,
        typeof dependencies.orders,
        typeof dependencies.monthOrders,
        renewChecks,
      ]);
      const refused = world.renewRefusal;
      if (refused !== undefined && (refused.at === 'first') === (renewChecks === 1)) {
        throw refused.error;
      }
      return { ...RENEW, ...world.renew };
    },
  };
  const payment = {
    createCheckout: async (
      enrollmentId: string,
      gross: number,
      currency: string,
      latestExpiry: Date,
      payee?: CheckoutPayee,
      saveCard?: boolean,
    ): Promise<Checkout> => {
      payees.push(payee);
      saveCards.push(saveCard);
      log.push(['gateway create', enrollmentId, gross, currency, latestExpiry.toISOString()]);
      orders += 1;
      return {
        gatewayOrderId: `fake_ord_${String(orders)}`,
        checkoutUrl: `https://pay.example/${String(orders)}`,
        expiresAt: latestExpiry,
      };
    },
    cancelCheckout: async (gatewayOrderId: string): Promise<CancelOutcome> => {
      log.push(['gateway cancel', gatewayOrderId]);
      if (world.cancelFails === true) throw new Error('the gateway is down');
      return world.cancel ?? 'cancelled';
    },
  };
  const cipher = {
    encrypt: (plaintext: string, column: string, rowId: string) =>
      Buffer.from(`${column}|${rowId}|${plaintext}`),
    decrypt: (_stored: Uint8Array, column: string, rowId: string) => {
      log.push(['decrypt', rowId]);
      return `https://pay.example/again/${column}/${rowId}`;
    },
  };
  const reported: Error[] = [];
  const service = new CheckoutService({
    settings: {
      read: (key, schema) => {
        if (key === 'teacher_share_percent' && world.sharePercent !== undefined) {
          return Promise.resolve(schema.parse(world.sharePercent));
        }
        if (key === 'ijazah_half_release_percent' && world.halfPercent !== undefined) {
          return Promise.resolve(schema.parse(world.halfPercent));
        }
        if (key === 'programme_enabled' && world.programmeEnabled !== undefined) {
          return Promise.resolve(schema.parse(world.programmeEnabled));
        }
        return settings.read(key, schema);
      },
    },
    idempotency: idempotency.service,
    payment,
    cipher,
    gateway: 'fake',
    now: () => world.now ?? NOW,
    report: (error) => void reported.push(error),
    steps,
    ...(world.paymentMode === undefined
      ? {}
      : {
          payee: createProgrammePayee({
            paymentMode: world.paymentMode,
            cipher: { decrypt: () => 'never decrypted here' },
            recipientOf: async (_tx, teacherUserId) => {
              log.push(['payee read', teacherUserId]);
              return world.recipient ?? null;
            },
          }),
        }),
  });
  return {
    log,
    service,
    idempotency,
    reported,
    inserted,
    payees,
    saveCards,
    recipientsAsked,
    readers,
    handed,
  };
}

describe('the teacher share kept on the order (T104; ADR 0025 D1, SRS DEC-80, FR-PAYG-7 as amended)', () => {
  it('records the rate the setting holds when a retry creates the order, and the share it gives, rounded up', async () => {
    const { service, inserted } = setUp();
    await service.retry(student, retryInput);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      teacherShareRatePercent: 70,
      teacherShare_piasters: 70_000,
    });
  });

  it('records the rate and the share when a payment creates the order', async () => {
    const { service, inserted } = setUp();
    await service.pay(student, payInput);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      teacherShareRatePercent: 70,
      teacherShare_piasters: 70_000,
    });
  });

  it('reads the rate when the order is created, so a changed setting reaches the next order', async () => {
    const { service, inserted } = setUp({ sharePercent: 33 });
    await service.retry(student, retryInput);

    expect(inserted[0]).toMatchObject({
      teacherShareRatePercent: 33,
      teacherShare_piasters: 33_000,
    });
  });

  it('refuses a setting outside 0 to 100 before the gateway, creating no order (fails closed)', async () => {
    const { service, log, inserted } = setUp({ sharePercent: 101 });
    await expect(service.retry(student, retryInput)).rejects.toThrow();

    expect(log.some(([kind]) => kind === 'gateway create')).toBe(false);
    expect(inserted).toEqual([]);
  });
});

describe('the ijazah half kept on the order (003:T105; ADR 0025 D2, D6, SRS DEC-81; Q-4 (a))', () => {
  const ijazahEnrollment: CheckoutEnrollmentRow = {
    ...enrollmentRow,
    snapshotTrack: 'ijazah_track',
  };

  it('records the setting’s percent on an ijazah_track order a retry creates', async () => {
    const { service, inserted } = setUp({ retryEnrollment: ijazahEnrollment });
    await service.retry(student, retryInput);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ halfReleaseRatePercent: 25 });
  });

  it('records the percent on an ijazah_track order a payment creates, as the setting holds it now', async () => {
    const { service, inserted } = setUp({ halfPercent: 40 });
    await service.pay(student, {
      ...payInput,
      quoted: { ...payInput.quoted, track: 'ijazah_track' as const },
    });

    expect(inserted[0]).toMatchObject({ halfReleaseRatePercent: 40 });
  });

  it('records no percent on a recitation order', async () => {
    const { service, inserted } = setUp();
    await service.pay(student, payInput);
    await service.retry(student, { ...retryInput, idempotencyKey: id(99) });

    expect(inserted).toHaveLength(2);
    expect(inserted.map((order) => order.halfReleaseRatePercent)).toEqual([null, null]);
  });

  it('refuses a setting outside 0 to 100 on an ijazah_track order before the gateway (fails closed)', async () => {
    const { service, log, inserted } = setUp({
      retryEnrollment: ijazahEnrollment,
      halfPercent: 101,
    });
    await expect(service.retry(student, retryInput)).rejects.toThrow();

    expect(log.some(([kind]) => kind === 'gateway create')).toBe(false);
    expect(inserted).toEqual([]);
  });
});

async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  return promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => {
      if (!(error instanceof DomainError)) throw error;
      return error;
    },
  );
}

const holdInput = { packageId: PACKAGE, slotId: SLOT, idempotencyKey: KEY };
const retryInput = { enrollmentId: ENROLLMENT, idempotencyKey: KEY };
const payable = () =>
  new PayableCheckout(id(61), {
    paymentId: id(72),
    gatewayOrderId: 'fake_ord_previous',
    expiresAt: ORDER_EXPIRES,
  });

describe("the teacher's share split to the payee (T101; ADR 0025 D2, SRS DEC-80, Q-B2 (a))", () => {
  it("asks a retry's order to split the share to the teacher's verified recipient", async () => {
    const { service, payees, recipientsAsked } = setUp({ recipient: 'rcp_teacher_verified' });
    await service.retry(student, retryInput);

    expect(recipientsAsked).toEqual([TEACHER]);
    expect(payees).toEqual([{ recipientRef: 'rcp_teacher_verified', share_piasters: 70_000 }]);
  });

  it("asks a payment's order to split the share at the setting's rate", async () => {
    const { service, payees, recipientsAsked } = setUp({
      recipient: 'rcp_teacher_verified',
      sharePercent: 33,
    });
    await service.pay(student, payInput);

    expect(recipientsAsked).toEqual([TEACHER]);
    expect(payees).toEqual([{ recipientRef: 'rcp_teacher_verified', share_piasters: 33_000 }]);
  });

  it('asks for no split when the teacher has no verified recipient (live mode refuses it at the gateway)', async () => {
    const { service, payees, inserted } = setUp({ recipient: null });
    await service.retry(student, retryInput);

    expect(payees).toEqual([undefined]);
    expect(inserted).toHaveLength(1);
  });
});

describe('checkout.hold (FR-BOOK-12, FR-357)', () => {
  it('answers the hold as the contract writes it', async () => {
    const { service } = setUp();
    await expect(service.hold(student, holdInput)).resolves.toEqual({
      holdId: HOLD,
      expiresAt: HOLD_EXPIRES.toISOString(),
      payBy: ORDER_EXPIRES.toISOString(),
      summary: heldAnswer.summary,
      firstSession: { localDate: '2026-11-05', startsAt: '2026-11-05T07:00:00.000Z' },
      lastSession: { localDate: '2026-11-26', startsAt: '2026-11-26T07:00:00.000Z' },
    });
  });

  it('answers a completed key’s outcome without placing anything again, the teacher’s name read again through visibility (T175)', async () => {
    const { service, log } = setUp();
    const first = await service.hold(student, holdInput);
    log.length = 0;
    await expect(service.hold(student, holdInput)).resolves.toEqual(first);
    expect(log).toEqual([
      ['key read', 'checkout.hold'],
      ['teacher name', 'female', TEACHER],
    ]);
  });

  // T175 (R1a; the note under T175, (1)): the key stores everything but the teacher's name.
  it('stores the hold without the teacher’s name (T175)', async () => {
    const { service, idempotency } = setUp();
    await service.hold(student, holdInput);
    const stored = idempotency.stored.get(`checkout.hold:${KEY}`);
    expect(stored).toEqual({
      holdId: HOLD,
      expiresAt: HOLD_EXPIRES.toISOString(),
      payBy: ORDER_EXPIRES.toISOString(),
      summary: { ...heldAnswer.summary, teacher: { teacherId: TEACHER } },
      firstSession: { localDate: '2026-11-05', startsAt: '2026-11-05T07:00:00.000Z' },
      lastSession: { localDate: '2026-11-26', startsAt: '2026-11-26T07:00:00.000Z' },
    });
    expect(JSON.stringify(stored)).not.toContain('الشيخ');
  });

  it('answers a replay NOT_FOUND once the teacher is no longer visible to the student (T175)', async () => {
    // The first call answers the name the placement read; the replay reads it again, and none is.
    const { service } = setUp({ visibleName: null });
    await service.hold(student, holdInput);
    const error = await refusal(service.hold(student, holdInput));
    expect(error.code).toBe('NOT_FOUND');
  });

  it('answers a duplicate that committed first with the name read again through visibility (T175)', async () => {
    const { service, idempotency, log } = setUp({ visibleName: 'الشيخ الآن' });
    const { idempotency: firstKeys, service: first } = setUp();
    await first.hold(student, holdInput);
    const competitor = firstKeys.stored.get(`checkout.hold:${KEY}`);
    if (competitor === undefined) throw new Error('no stored outcome');
    idempotency.duplicateFirst(competitor);
    const answer = await service.hold(student, holdInput);
    expect(answer.summary.teacher).toEqual({ teacherId: TEACHER, displayName: 'الشيخ الآن' });
    expect(log).toContainEqual(['teacher name', 'female', TEACHER]);
  });

  it('(b) cancels the previous payable order outside any transaction, records it failed, then holds again', async () => {
    const { service, log } = setUp({ placements: [payable(), heldAnswer] });
    await expect(service.hold(student, holdInput)).resolves.toMatchObject({ holdId: HOLD });
    expect(log.filter(([kind]) => kind !== 'place')).toEqual([
      ['key read', 'checkout.hold'],
      ['transaction'],
      ['gateway cancel', 'fake_ord_previous'],
      ['record failed', id(61), id(72)],
      ['transaction'],
      ['commit'],
    ]);
  });

  it.each(['paid', 'in_progress'] as const)(
    '(b) refuses PREVIOUS_CHECKOUT as processing when the gateway answers %s, writing nothing',
    async (outcome) => {
      const { service, log } = setUp({ placements: [payable()], cancel: outcome });
      const error = await refusal(service.hold(student, holdInput));
      expect(error.code).toBe('PREVIOUS_CHECKOUT');
      expect(error.details).toEqual([
        { path: 'enrollmentId', code: id(61) },
        { path: 'state', code: 'processing' },
      ]);
      expect(log.some(([kind]) => kind === 'record failed' || kind === 'commit')).toBe(false);
    },
  );

  it('(c) refuses PREVIOUS_CHECKOUT as payable, with the time left, when the gateway offers no cancellation', async () => {
    const { service, log } = setUp({ placements: [payable()], cancel: 'unsupported' });
    const error = await refusal(service.hold(student, holdInput));
    expect(error.details).toEqual([
      { path: 'enrollmentId', code: id(61) },
      { path: 'state', code: 'payable' },
      { path: 'expiresAt', code: ORDER_EXPIRES.toISOString() },
    ]);
    expect(log.some(([kind]) => kind === 'record failed' || kind === 'commit')).toBe(false);
  });

  it('stops when the order it recorded failed comes back payable, rather than loop', async () => {
    const { service } = setUp({ placements: [payable()] });
    await expect(service.hold(student, holdInput)).rejects.toThrow(/came back payable/);
  });
});

describe('checkout.retry (FR-356, FR-357, ARCHITECTURE §8.1)', () => {
  it('creates the order outside any transaction, no later than the hold’s expiry minus the grace, then records it with its address encrypted to its row', async () => {
    const { service, log } = setUp();
    await expect(service.retry(student, retryInput)).resolves.toEqual({
      checkoutUrl: 'https://pay.example/1',
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    const encrypted = [...Buffer.from(`${CHECKOUT_URL_COLUMN}|${PAYMENT}|https://pay.example/1`)];
    expect(log).toEqual([
      ['key read', 'checkout.retry'],
      ['read target'],
      ['draw', 1],
      ['gateway create', ENROLLMENT, piasters(100_000), 'EGP', ORDER_EXPIRES.toISOString()],
      ['transaction'],
      ['lock target', HOLD, true],
      ['insert order', PAYMENT, 'fake_ord_1', encrypted],
      ['commit'],
    ]);
  });

  it('answers a completed key by reading the address again under continue’s conditions, calling no gateway', async () => {
    const { service, log } = setUp();
    await service.retry(student, retryInput);
    log.length = 0;
    await expect(service.retry(student, retryInput)).resolves.toEqual({
      checkoutUrl: `https://pay.example/again/${CHECKOUT_URL_COLUMN}/${PAYMENT}`,
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    expect(log).toEqual([
      ['key read', 'checkout.retry'],
      ['decrypt', PAYMENT],
    ]);
  });

  it('answers a completed key ORDER_NOT_PAYABLE once its order is no longer payable', async () => {
    for (const order of [
      { status: 'paid' as const, expiresAt: ORDER_EXPIRES },
      { status: 'created' as const, expiresAt: NOW },
    ]) {
      const { service } = setUp({ order });
      await service.retry(student, retryInput);
      const error = await refusal(service.retry(student, retryInput));
      expect(error.code).toBe('ORDER_NOT_PAYABLE');
    }
  });

  it('answers NOT_FOUND for another student’s enrollment, calling no gateway and writing nothing', async () => {
    const { service, log } = setUp({ targetError: new DomainError('NOT_FOUND') });
    const error = await refusal(service.retry(student, retryInput));
    expect(error.code).toBe('NOT_FOUND');
    expect(log.some(([kind]) => kind === 'gateway create' || kind === 'transaction')).toBe(false);
  });

  it.each([
    ['no active hold', { hold: null }],
    ['the hold’s expiry minus the grace already past', { now: new Date('2026-11-03T08:10:00Z') }],
  ])('refuses ORDER_NOT_PAYABLE with %s, calling no gateway', async (_name, world) => {
    const { service, log } = setUp(world);
    const error = await refusal(service.retry(student, retryInput));
    expect(error.code).toBe('ORDER_NOT_PAYABLE');
    expect(log.some(([kind]) => kind === 'gateway create')).toBe(false);
  });

  it('cancels the new order at the gateway when the transaction refuses it, and answers the refusal', async () => {
    const { service, log } = setUp({ lockError: new DomainError('ORDER_NOT_PAYABLE') });
    const error = await refusal(service.retry(student, retryInput));
    expect(error.code).toBe('ORDER_NOT_PAYABLE');
    expect(log.at(-1)).toEqual(['gateway cancel', 'fake_ord_1']);
    expect(log.some(([kind]) => kind === 'insert order')).toBe(false);
  });

  it('when a duplicate with the same key committed first, answers its outcome and cancels the extra order', async () => {
    const { service, log, idempotency } = setUp();
    idempotency.duplicateFirst({
      paymentId: OTHER_PAYMENT,
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    await expect(service.retry(student, retryInput)).resolves.toEqual({
      checkoutUrl: `https://pay.example/again/${CHECKOUT_URL_COLUMN}/${OTHER_PAYMENT}`,
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    expect(log.some(([kind]) => kind === 'insert order')).toBe(false);
    expect(log).toContainEqual(['gateway cancel', 'fake_ord_1']);
  });

  it('reports a cancellation the gateway failed, and still answers the refusal it had', async () => {
    const { service, reported } = setUp({
      lockError: new DomainError('ORDER_NOT_PAYABLE'),
      cancelFails: true,
    });
    const error = await refusal(service.retry(student, retryInput));
    expect(error.code).toBe('ORDER_NOT_PAYABLE');
    expect(reported.map(({ message }) => message)).toEqual(['the gateway is down']);
  });
});

const payInput = {
  holdId: HOLD,
  quoted: {
    price_piasters: 100_000,
    sessionCount: 4,
    sessionDurationMinutes: 60 as const,
    track: 'recitation' as const,
  },
  idempotencyKey: KEY,
};
const ENROLLMENT_DRAWN = PAYMENT;
const PAYMENT_DRAWN = id(102);

describe('checkout.pay (FR-354, FR-355, FR-357; the owner’s decisions of 2026-11-03)', () => {
  it('draws the enrollment’s id first, hands it to the gateway outside any transaction, then writes the enrollment and records the order in one', async () => {
    const { service, log } = setUp();
    await expect(service.pay(student, payInput)).resolves.toEqual({
      enrollmentId: ENROLLMENT_DRAWN,
      checkoutUrl: 'https://pay.example/1',
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    const encrypted = [
      ...Buffer.from(`${CHECKOUT_URL_COLUMN}|${PAYMENT_DRAWN}|https://pay.example/1`),
    ];
    expect(log).toEqual([
      ['key read', 'checkout.pay'],
      ['read pay target', HOLD, 100_000],
      ['draw', 1],
      ['draw', 2],
      ['gateway create', ENROLLMENT_DRAWN, piasters(100_000), 'EGP', ORDER_EXPIRES.toISOString()],
      ['transaction'],
      ['enroll', HOLD, ENROLLMENT_DRAWN, 24],
      ['insert order', PAYMENT_DRAWN, 'fake_ord_1', encrypted],
      ['commit'],
    ]);
  });

  it.each([
    ['SUMMARY_CHANGED', new DomainError('SUMMARY_CHANGED')],
    ['NOT_FOUND', new DomainError('NOT_FOUND')],
    ['HOLD_EXPIRED', new DomainError('HOLD_EXPIRED')],
  ])('refuses %s before the gateway: no order created and nothing written', async (code, error) => {
    const { service, log } = setUp({ payTargetError: error });
    const refused = await refusal(service.pay(student, payInput));
    expect(refused.code).toBe(code);
    expect(log.some(([kind]) => kind === 'gateway create' || kind === 'transaction')).toBe(false);
  });

  it('refuses HOLD_EXPIRED past the hold’s expiry minus the grace, calling no gateway', async () => {
    const { service, log } = setUp({ now: new Date('2026-11-03T08:10:00Z') });
    const refused = await refusal(service.pay(student, payInput));
    expect(refused.code).toBe('HOLD_EXPIRED');
    expect(log.some(([kind]) => kind === 'gateway create')).toBe(false);
  });

  it('accepts Pay until payBy as checkout.hold answered it, and the order expires at that instant (FR-355, FR-358)', async () => {
    const { service: holding } = setUp();
    const { payBy } = await holding.hold(student, holdInput);
    const justBefore = new Date(addSeconds(new Date(payBy), -1));
    const { service, log } = setUp({ now: justBefore });
    const answer = await service.pay(student, payInput);
    expect(answer.orderExpiresAt).toBe(payBy);
    expect(log).toContainEqual([
      'gateway create',
      ENROLLMENT_DRAWN,
      piasters(100_000),
      'EGP',
      payBy,
    ]);
  });

  it.each([
    ['at payBy', 0],
    ['one second after payBy', 1],
  ])('refuses HOLD_EXPIRED %s, calling no gateway', async (_when, after) => {
    const { service: holding } = setUp();
    const { payBy } = await holding.hold(student, holdInput);
    const { service, log } = setUp({ now: new Date(addSeconds(new Date(payBy), after)) });
    const refused = await refusal(service.pay(student, payInput));
    expect(refused.code).toBe('HOLD_EXPIRED');
    expect(log.some(([kind]) => kind === 'gateway create' || kind === 'transaction')).toBe(false);
  });

  it('cancels the order at the gateway when the summary changed under the locks, and answers SUMMARY_CHANGED', async () => {
    const { service, log } = setUp({ lockError: new DomainError('SUMMARY_CHANGED') });
    const refused = await refusal(service.pay(student, payInput));
    expect(refused.code).toBe('SUMMARY_CHANGED');
    expect(log.some(([kind]) => kind === 'insert order')).toBe(false);
    expect(log.at(-1)).toEqual(['gateway cancel', 'fake_ord_1']);
  });

  it('two calls with one key at the same moment: one enrollment, one address, the extra order cancelled at the gateway', async () => {
    const { service, log, idempotency } = setUp();
    idempotency.duplicateFirst({
      enrollmentId: ENROLLMENT,
      paymentId: OTHER_PAYMENT,
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    await expect(service.pay(student, payInput)).resolves.toEqual({
      enrollmentId: ENROLLMENT,
      checkoutUrl: `https://pay.example/again/${CHECKOUT_URL_COLUMN}/${OTHER_PAYMENT}`,
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    expect(log.some(([kind]) => kind === 'enroll' || kind === 'insert order')).toBe(false);
    expect(log).toContainEqual(['gateway cancel', 'fake_ord_1']);
  });

  it('answers a completed key’s enrollment and the address read again, calling no gateway', async () => {
    const { service, log } = setUp();
    await service.pay(student, payInput);
    log.length = 0;
    await expect(service.pay(student, payInput)).resolves.toEqual({
      enrollmentId: ENROLLMENT_DRAWN,
      checkoutUrl: `https://pay.example/again/${CHECKOUT_URL_COLUMN}/${PAYMENT_DRAWN}`,
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    expect(log).toEqual([
      ['key read', 'checkout.pay'],
      ['decrypt', PAYMENT_DRAWN],
    ]);
  });
});

describe('checkout.current: what CheckoutPrevious shows (FR-BOOK-12 (c), T037)', () => {
  it('answers no hold as an empty answer', async () => {
    const { service } = setUp({ current: null });
    await expect(service.current(student)).resolves.toEqual({});
  });

  it('answers a hold before Pay without an order', async () => {
    const { service } = setUp({
      current: {
        holdId: HOLD,
        expiresAt: HOLD_EXPIRES,
        enrollmentId: null,
        summary: heldAnswer.summary,
        firstSession: FIRST_SESSION,
        lastSession: LAST_SESSION,
      },
    });
    await expect(service.current(student)).resolves.toEqual({
      hold: {
        holdId: HOLD,
        expiresAt: HOLD_EXPIRES.toISOString(),
        payBy: ORDER_EXPIRES.toISOString(),
        summary: heldAnswer.summary,
        firstSession: FIRST_SESSION,
        lastSession: LAST_SESSION,
      },
    });
  });

  it('answers the first and last session booking previews from now with the lead setting (FR-386, T085)', async () => {
    const { service, log } = setUp();
    const answer = await service.current(student);
    expect(answer.hold?.firstSession).toEqual(FIRST_SESSION);
    expect(answer.hold?.lastSession).toEqual(LAST_SESSION);
    expect(log).toContainEqual(['current hold', STUDENT, NOW.toISOString(), 24]);
  });

  it.each([
    [
      'a created order before its expiry',
      { status: 'created' as const, expiresAt: ORDER_EXPIRES },
      true,
    ],
    ['a created order past its expiry', { status: 'created' as const, expiresAt: NOW }, false],
    ['a paid order', { status: 'paid' as const, expiresAt: ORDER_EXPIRES }, false],
    ['a failed order', { status: 'failed' as const, expiresAt: ORDER_EXPIRES }, false],
  ])('answers %s with canContinue %s, decrypting nothing', async (_name, order, canContinue) => {
    const { service, log } = setUp({ order });
    await expect(service.current(student)).resolves.toEqual({
      hold: {
        holdId: HOLD,
        expiresAt: HOLD_EXPIRES.toISOString(),
        payBy: ORDER_EXPIRES.toISOString(),
        enrollmentId: ENROLLMENT,
        summary: heldAnswer.summary,
        firstSession: FIRST_SESSION,
        lastSession: LAST_SESSION,
        lastOrder: { status: order.status, expiresAt: order.expiresAt.toISOString(), canContinue },
      },
    });
    expect(log.some(([kind]) => kind === 'decrypt')).toBe(false);
  });
});

describe('checkout.continue: the payable order’s page again (data-model §2.4.1, T037)', () => {
  it('decrypts the address of a created order before its expiry, for the student who owns it', async () => {
    const { service, log } = setUp();
    await expect(service.continue(student, { enrollmentId: ENROLLMENT })).resolves.toEqual({
      checkoutUrl: `https://pay.example/again/${CHECKOUT_URL_COLUMN}/${PAYMENT}`,
      orderExpiresAt: ORDER_EXPIRES.toISOString(),
    });
    expect(log).toContainEqual(['decrypt', PAYMENT]);
  });

  it('answers another student’s enrollment NOT_FOUND, decrypting nothing (M3)', async () => {
    const { service, log } = setUp({ enrollment: null });
    const error = await refusal(service.continue(student, { enrollmentId: ENROLLMENT }));
    expect(error.code).toBe('NOT_FOUND');
    expect(log.some(([kind]) => kind === 'decrypt')).toBe(false);
  });

  it.each([
    ['paid', { status: 'paid' as const, expiresAt: ORDER_EXPIRES }],
    ['failed', { status: 'failed' as const, expiresAt: ORDER_EXPIRES }],
    ['expired', { status: 'expired' as const, expiresAt: ORDER_EXPIRES }],
    ['created past its expires_at', { status: 'created' as const, expiresAt: NOW }],
    ['missing', null],
  ])('answers an order %s ORDER_NOT_PAYABLE, decrypting nothing', async (_name, order) => {
    const { service, log } = setUp({ order });
    const error = await refusal(service.continue(student, { enrollmentId: ENROLLMENT }));
    expect(error.code).toBe('ORDER_NOT_PAYABLE');
    expect(log.some(([kind]) => kind === 'decrypt')).toBe(false);
  });
});

describe('checkout.status: the enrollment as the server holds it (FR-380 to FR-386, T037)', () => {
  it('answers the status, the summary and the last order with its reference', async () => {
    const { service, log } = setUp({ order: { status: 'failed', expiresAt: ORDER_EXPIRES } });
    await expect(service.status(student, { enrollmentId: ENROLLMENT })).resolves.toEqual({
      status: 'pending_payment',
      summary: heldAnswer.summary,
      lastOrder: { status: 'failed', reference: 'fake_ord_last' },
    });
    expect(log.some(([kind]) => kind === 'decrypt')).toBe(false);
  });

  it('answers another student’s enrollment NOT_FOUND (M3)', async () => {
    const { service } = setUp({ enrollment: null });
    const error = await refusal(service.status(student, { enrollmentId: ENROLLMENT }));
    expect(error.code).toBe('NOT_FOUND');
  });
});

describe('the order’s kind (006:T005; FR-701, FR-702, R-504, R-511)', () => {
  const assessmentQuote = {
    ...payInput,
    quoted: {
      price_piasters: 20_000,
      sessionCount: 1,
      sessionDurationMinutes: 30 as const,
      track: 'ijazah_track' as const,
    },
  };

  it('records a package’s order as `package`, at its total, on Pay and on Retry', async () => {
    const { service, inserted } = setUp();
    await service.pay(student, payInput);
    await service.retry(student, { enrollmentId: ENROLLMENT, idempotencyKey: KEY });
    expect(inserted.map((order) => order.kind)).toEqual(['package', 'package']);
    expect(inserted.map((order) => order.gross_piasters)).toEqual([100_000, 100_000]);
  });

  it('records a programme package’s Pay as an `assessment` at the fee, with the rate and the 25 % read as today', async () => {
    const { service, inserted, log, readers } = setUp({ kind: 'assessment' });
    await service.pay(student, assessmentQuote);
    expect(inserted).toEqual([
      expect.objectContaining({
        kind: 'assessment',
        gross_piasters: 20_000,
        teacherShareRatePercent: 70,
        teacherShare_piasters: 14_000,
        halfReleaseRatePercent: 25,
      }),
    ]);
    expect(log).toContainEqual([
      'gateway create',
      ENROLLMENT_DRAWN,
      20_000,
      'EGP',
      ORDER_EXPIRES.toISOString(),
    ]);
    expect(readers).toEqual([
      { open: true, assessmentPrice_piasters: 20_000, assessmentDurationMinutes: 30 },
    ]);
  });

  it('records an assessment’s Retry as an `assessment` at the snapshot’s price', async () => {
    const assessment = {
      ...enrollmentRow,
      snapshotPricePiasters: 20_000n,
      snapshotSessionCount: 1,
      snapshotDurationMinutes: 30,
      snapshotTrack: 'ijazah_track' as const,
    };
    const { service, inserted } = setUp({ kind: 'assessment', retryEnrollment: assessment });
    await service.retry(student, { enrollmentId: ENROLLMENT, idempotencyKey: KEY });
    expect(inserted).toEqual([
      expect.objectContaining({
        kind: 'assessment',
        gross_piasters: 20_000,
        halfReleaseRatePercent: 25,
      }),
    ]);
  });

  it('refuses a programme package’s Pay while the switch is off, before the gateway, writing nothing', async () => {
    const { service, log } = setUp({ kind: 'assessment', programmeEnabled: 0 });
    const refused = await refusal(service.pay(student, assessmentQuote));
    expect(refused).toEqual(
      new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'programme_disabled' }],
      }),
    );
    expect(log.some(([kind]) => kind === 'gateway create' || kind === 'transaction')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T009 (FR-710 to FR-713; R-507, R-509, R-511; contracts/app-surface.md `programme.pay`).

describe('programme.pay: the first payment of the rest, in full or a month (006:T009)', () => {
  const payRest = (plan: 'in_full' | 'monthly', saveCard = false) => ({
    enrollmentId: ENROLLMENT,
    plan,
    saveCard,
    idempotencyKey: KEY,
  });
  const lines: [object, string][] = [];
  const log = { info: (fields: object, message: string) => void lines.push([fields, message]) };

  it('pays the rest in full as the total less the assessment’s 500: 9,500 EGP, a rest_in_full order', async () => {
    const { service, inserted, log: steps } = setUp();
    await expect(service.programmePay(student, payRest('in_full'), log)).resolves.toEqual({
      checkoutUrl: 'https://pay.example/1',
    });
    expect(inserted).toEqual([
      expect.objectContaining({
        enrollmentId: ENROLLMENT,
        kind: 'rest_in_full',
        gross_piasters: 950_000,
        teacherShareRatePercent: 70,
        teacherShare_piasters: 665_000,
        halfReleaseRatePercent: 25,
      }),
    ]);
    expect(inserted[0]).not.toHaveProperty('instalmentMonth');
    expect(inserted[0]).not.toHaveProperty('cardConsentAt');
    expect(steps).toContainEqual([
      'gateway create',
      ENROLLMENT,
      950_000,
      'EGP',
      ORDER_EXPIRES.toISOString(),
    ]);
  });

  it('pays month 1 as 4 × the session price: 1,000 EGP, an instalment of month 1', async () => {
    const { service, inserted } = setUp();
    await service.programmePay(student, payRest('monthly'), log);
    expect(inserted).toEqual([
      expect.objectContaining({
        kind: 'instalment',
        instalmentMonth: 1,
        gross_piasters: 100_000,
        teacherShare_piasters: 70_000,
      }),
    ]);
  });

  it('pays month 1 of an offer of 3 sessions as the whole 3: 750 EGP (the remainder rule, FR-711)', async () => {
    const { service, inserted } = setUp({
      programme: { offerSessionCount: 3, total_piasters: piasters(75_000) },
    });
    await service.programmePay(student, payRest('monthly'), log);
    expect(inserted.map(({ gross_piasters }) => gross_piasters)).toEqual([75_000]);
  });

  it('pays the rest of an offer of 3 sessions in full: 750 − 500 = 250 EGP', async () => {
    const { service, inserted } = setUp({
      programme: { offerSessionCount: 3, total_piasters: piasters(75_000) },
    });
    await service.programmePay(student, payRest('in_full'), log);
    expect(inserted.map(({ gross_piasters }) => gross_piasters)).toEqual([25_000]);
  });

  it('refuses rest_not_positive in full when the total is not above the fee (2 × 250 − 500 = 0), before the gateway, with one line', async () => {
    lines.length = 0;
    const {
      service,
      log: steps,
      inserted,
    } = setUp({
      programme: { offerSessionCount: 2, total_piasters: piasters(50_000) },
    });
    const refused = await refusal(service.programmePay(student, payRest('in_full'), log));
    expect(refused).toEqual(
      new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'rest_not_positive' }],
      }),
    );
    expect(steps.some(([kind]) => kind === 'gateway create')).toBe(false);
    expect(inserted).toEqual([]);
    expect(lines).toEqual([
      [
        { studentUserId: STUDENT, enrollmentId: ENROLLMENT, reason: 'rest_not_positive' },
        'A programme payment was refused',
      ],
    ]);
  });

  it('pays month 1 of an offer of 2 sessions by months: 500 EGP, nothing refused', async () => {
    const { service, inserted } = setUp({
      programme: { offerSessionCount: 2, total_piasters: piasters(50_000) },
    });
    await service.programmePay(student, payRest('monthly'), log);
    expect(inserted.map(({ gross_piasters }) => gross_piasters)).toEqual([50_000]);
  });

  it('copies the rate and the 25 % from the assessment order, whatever the settings say now (R-511)', async () => {
    const { service, inserted } = setUp({
      sharePercent: 50,
      halfPercent: 10,
      assessmentOrder: {
        gross_piasters: piasters(50_000),
        teacherShareRatePercent: 65,
        halfReleaseRatePercent: 20,
      },
    });
    await service.programmePay(student, payRest('monthly'), log);
    expect(inserted).toEqual([
      expect.objectContaining({
        teacherShareRatePercent: 65,
        teacherShare_piasters: 65_000,
        halfReleaseRatePercent: 20,
      }),
    ]);
  });

  it('holds no hold: the order expires at now + slot_hold_ttl_minutes when pay_by_at is later', async () => {
    const { service, log: steps } = setUp();
    await service.programmePay(student, payRest('monthly'), log);
    expect(steps).toContainEqual([
      'gateway create',
      ENROLLMENT,
      100_000,
      'EGP',
      ORDER_EXPIRES.toISOString(),
    ]);
  });

  it('expires the order at pay_by_at when the 48 hours end within the checkout’s 10 minutes', async () => {
    const payBy = new Date('2026-11-03T08:04:00Z');
    const { service, log: steps } = setUp({ programme: { payByAt: payBy } });
    await service.programmePay(student, payRest('monthly'), log);
    expect(steps).toContainEqual([
      'gateway create',
      ENROLLMENT,
      100_000,
      'EGP',
      payBy.toISOString(),
    ]);
  });

  it('records the consent to save the card at the request’s instant when ticked (Q-4 (a))', async () => {
    const { service, inserted } = setUp();
    await service.programmePay(student, payRest('monthly', true), log);
    expect(inserted[0]).toMatchObject({ cardConsentAt: NOW });
  });

  it('asks the gateway to save the card only when the consent is ticked (006:T013, R-510, FR-713)', async () => {
    const ticked = setUp();
    await ticked.service.programmePay(student, payRest('monthly', true), log);
    expect(ticked.saveCards).toEqual([true]);
    const unticked = setUp();
    await unticked.service.programmePay(student, payRest('monthly'), log);
    expect(unticked.saveCards).toEqual([undefined]);
  });

  it('checks the programme before the gateway and again under the record’s locks, the gateway between', async () => {
    const { service, log: steps } = setUp();
    await service.programmePay(student, payRest('in_full'), log);
    expect(
      steps
        .map(([kind]) => kind)
        .filter((kind) =>
          ['programme check', 'gateway create', 'transaction', 'insert order', 'commit'].includes(
            kind as string,
          ),
        ),
    ).toEqual([
      'programme check',
      'gateway create',
      'transaction',
      'programme check',
      'insert order',
      'commit',
    ]);
  });

  it('answers the check’s refusal before the gateway, calling none and writing nothing', async () => {
    const error = new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'pay_by_passed' }],
    });
    const {
      service,
      log: steps,
      inserted,
    } = setUp({
      programmeRefusal: { at: 'first', error },
    });
    await expect(service.programmePay(student, payRest('in_full'), log)).rejects.toBe(error);
    expect(steps.some(([kind]) => kind === 'gateway create')).toBe(false);
    expect(inserted).toEqual([]);
  });

  it('cancels the order at the gateway when the check refuses under the record’s locks', async () => {
    const error = new DomainError('PREVIOUS_CHECKOUT');
    const {
      service,
      log: steps,
      inserted,
    } = setUp({
      programmeRefusal: { at: 'record', error },
    });
    await expect(service.programmePay(student, payRest('monthly'), log)).rejects.toBe(error);
    expect(steps).toContainEqual(['gateway cancel', 'fake_ord_1']);
    expect(inserted).toEqual([]);
  });

  it('is keyed on programme.pay: a completed key answers the address read again, calling no gateway', async () => {
    const { service, log: steps } = setUp();
    await service.programmePay(student, payRest('monthly'), log);
    const created = steps.filter(([kind]) => kind === 'gateway create').length;
    await expect(service.programmePay(student, payRest('monthly'), log)).resolves.toEqual({
      checkoutUrl: `https://pay.example/again/${CHECKOUT_URL_COLUMN}/${PAYMENT}`,
    });
    expect(steps.filter(([kind]) => kind === 'gateway create').length).toBe(created);
    expect(steps).toContainEqual(['key read', 'programme.pay']);
  });
});

describe('programme.pay refuses payee_unverified before the gateway (006:T016; FR-716, FR-720)', () => {
  const payRest = (plan: 'in_full' | 'monthly') => ({
    enrollmentId: ENROLLMENT,
    plan,
    saveCard: false,
    idempotencyKey: KEY,
  });
  const lines: [object, string][] = [];
  const log = { info: (fields: object, message: string) => void lines.push([fields, message]) };

  it('red first: live mode, the teacher’s payout account unverified: CONFLICT payee_unverified, no gateway, nothing written, one line', async () => {
    lines.length = 0;
    const { service, log: steps, inserted } = setUp({ paymentMode: 'live', recipient: null });
    const refused = await refusal(service.programmePay(student, payRest('monthly'), log));
    expect(refused).toEqual(
      new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'payee_unverified' }],
      }),
    );
    expect(steps).toContainEqual(['payee read', TEACHER]);
    expect(steps.some(([kind]) => kind === 'gateway create')).toBe(false);
    expect(inserted).toEqual([]);
    expect(lines).toEqual([
      [
        { studentUserId: STUDENT, enrollmentId: ENROLLMENT, reason: 'payee_unverified' },
        'A programme payment was refused',
      ],
    ]);
  });

  it('live mode with the account verified: the order is created with its payee', async () => {
    const { service, payees } = setUp({ paymentMode: 'live', recipient: 'rcp_verified' });
    await service.programmePay(student, payRest('monthly'), log);
    expect(payees).toEqual([{ recipientRef: 'rcp_verified', share_piasters: 70_000 }]);
  });

  it('test mode refuses nothing: the stand-in charges with no payee', async () => {
    const { service, payees, log: steps } = setUp({ paymentMode: 'test', recipient: null });
    await expect(service.programmePay(student, payRest('in_full'), log)).resolves.toEqual({
      checkoutUrl: 'https://pay.example/1',
    });
    expect(payees).toEqual([undefined]);
    expect(steps.some(([kind]) => kind === 'payee read')).toBe(false);
  });
});

describe('programme.renew: the next month by hand (006:T016; FR-713a, FR-715, FR-716, FR-720)', () => {
  const renew = (saveCard = false) => ({ enrollmentId: ENROLLMENT, saveCard, idempotencyKey: KEY });
  const lines: [object, string][] = [];
  const log = { info: (fields: object, message: string) => void lines.push([fields, message]) };

  it('red first: renews month 2 as 4 × the session price: 1,000 EGP, an instalment of month 2, at the assessment’s rates', async () => {
    const { service, inserted, saveCards } = setUp({
      sharePercent: 50,
      assessmentOrder: {
        gross_piasters: piasters(50_000),
        teacherShareRatePercent: 65,
        halfReleaseRatePercent: 20,
      },
    });
    await expect(service.programmeRenew(student, renew(), log)).resolves.toEqual({
      checkoutUrl: 'https://pay.example/1',
    });
    expect(inserted).toEqual([
      expect.objectContaining({
        enrollmentId: ENROLLMENT,
        kind: 'instalment',
        instalmentMonth: 2,
        gross_piasters: 100_000,
        teacherShareRatePercent: 65,
        teacherShare_piasters: 65_000,
        halfReleaseRatePercent: 20,
      }),
    ]);
    expect(inserted[0]).not.toHaveProperty('cardConsentAt');
    expect(saveCards).toEqual([undefined]);
  });

  it('red first: the last month takes the remainder: month 11 of 42 sessions is 2 × 250 = 500 EGP', async () => {
    const { service, inserted } = setUp({
      renew: { instalmentMonth: 11, offerSessionCount: 42, total_piasters: piasters(1_050_000) },
    });
    await service.programmeRenew(student, renew(), log);
    expect(inserted.map(({ gross_piasters }) => gross_piasters)).toEqual([50_000]);
  });

  it('red first: «change card»: a ticked consent is kept on the order and the gateway asked to save the card', async () => {
    const { service, inserted, saveCards } = setUp();
    await service.programmeRenew(student, renew(true), log);
    expect(inserted[0]).toMatchObject({ cardConsentAt: NOW });
    expect(saveCards).toEqual([true]);
  });

  it('red first: the order expires at now + slot_hold_ttl_minutes (no hold), with the check’s early days', async () => {
    const { service, log: steps } = setUp();
    await service.programmeRenew(student, renew(), log);
    expect(steps).toContainEqual([
      'gateway create',
      ENROLLMENT,
      100_000,
      'EGP',
      ORDER_EXPIRES.toISOString(),
    ]);
    expect(steps).toContainEqual([
      'renew check',
      STUDENT,
      ENROLLMENT,
      3,
      'function',
      'function',
      1,
    ]);
  });

  it('red first: checks before the gateway and again under the record’s locks, the gateway between', async () => {
    const { service, log: steps } = setUp();
    await service.programmeRenew(student, renew(), log);
    expect(
      steps
        .map(([kind]) => kind)
        .filter((kind) =>
          ['renew check', 'gateway create', 'transaction', 'insert order', 'commit'].includes(
            kind as string,
          ),
        ),
    ).toEqual([
      'renew check',
      'gateway create',
      'transaction',
      'renew check',
      'insert order',
      'commit',
    ]);
  });

  it('red first: answers the check’s refusal before the gateway, calling none and writing nothing', async () => {
    const error = new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'charge_pending' }],
    });
    const { service, log: steps, inserted } = setUp({ renewRefusal: { at: 'first', error } });
    await expect(service.programmeRenew(student, renew(), log)).rejects.toBe(error);
    expect(steps.some(([kind]) => kind === 'gateway create')).toBe(false);
    expect(inserted).toEqual([]);
  });

  it('red first: cancels the order at the gateway when the check refuses under the record’s locks (an automatic charge recorded meanwhile)', async () => {
    const error = new DomainError('CONFLICT', undefined, {
      details: [{ path: 'cause', code: 'charge_pending' }],
    });
    const { service, log: steps, inserted } = setUp({ renewRefusal: { at: 'record', error } });
    await expect(service.programmeRenew(student, renew(), log)).rejects.toBe(error);
    expect(steps).toContainEqual(['gateway cancel', 'fake_ord_1']);
    expect(inserted).toEqual([]);
  });

  it('red first: live mode, the payout account unverified: CONFLICT payee_unverified before the gateway, one line', async () => {
    lines.length = 0;
    const { service, log: steps, inserted } = setUp({ paymentMode: 'live', recipient: null });
    const refused = await refusal(service.programmeRenew(student, renew(), log));
    expect(refused).toEqual(
      new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'payee_unverified' }],
      }),
    );
    expect(steps.some(([kind]) => kind === 'gateway create')).toBe(false);
    expect(inserted).toEqual([]);
    expect(lines).toEqual([
      [
        { studentUserId: STUDENT, enrollmentId: ENROLLMENT, reason: 'payee_unverified' },
        'A programme renewal was refused',
      ],
    ]);
  });

  it('after a no_payee refusal, once the payout account is verified, takes the month by hand with its payee (PR #153 r4 Minor 1)', async () => {
    const { service, payees } = setUp({ paymentMode: 'live', recipient: 'rcp_verified' });
    await service.programmeRenew(student, renew(), log);
    expect(payees).toEqual([{ recipientRef: 'rcp_verified', share_piasters: 70_000 }]);
  });

  it('test mode refuses nothing: the stand-in charges with no payee', async () => {
    const { service, payees } = setUp({ paymentMode: 'test', recipient: null });
    await service.programmeRenew(student, renew(), log);
    expect(payees).toEqual([undefined]);
  });

  it('red first: is keyed on programme.renew: a completed key answers the address read again, calling no gateway', async () => {
    const { service, log: steps } = setUp();
    await service.programmeRenew(student, renew(), log);
    const created = steps.filter(([kind]) => kind === 'gateway create').length;
    await expect(service.programmeRenew(student, renew(), log)).resolves.toEqual({
      checkoutUrl: `https://pay.example/again/${CHECKOUT_URL_COLUMN}/${PAYMENT}`,
    });
    expect(steps.filter(([kind]) => kind === 'gateway create').length).toBe(created);
    expect(steps).toContainEqual(['key read', 'programme.renew']);
  });
});

describe('a new hold while a programme order is payable (006:T009, FR-BOOK-12)', () => {
  it('hands the placement payments’ read of the student’s payable programme orders', async () => {
    const { service, handed } = setUp();
    await service.hold(student, { packageId: PACKAGE, slotId: SLOT, idempotencyKey: KEY });
    expect(handed).toEqual(['function']);
  });
});

// 006:T009 (the owner's Q-C2 (a)): checkout.current shows the student's payable programme order,
// which has no hold, beside the hold if there is one; continue hands its page back.
describe('checkout.current shows a payable programme order (006:T009, Q-C2 (a), R-509)', () => {
  const PROGRAMME_ENROLLMENT = id(61);
  const PROGRAMME_ORDER_EXPIRES = new Date('2026-11-03T08:07:00Z');
  const programmeOrder = { enrollmentId: PROGRAMME_ENROLLMENT, expiresAt: PROGRAMME_ORDER_EXPIRES };

  it('answers the programme order alone while it is payable and the student holds nothing', async () => {
    const { service, log } = setUp({ current: null, programmeOrder });
    await expect(service.current(student)).resolves.toEqual({
      programmeOrder: {
        enrollmentId: PROGRAMME_ENROLLMENT,
        expiresAt: PROGRAMME_ORDER_EXPIRES.toISOString(),
        canContinue: true,
      },
    });
    expect(log).toContainEqual(['programme order', STUDENT, NOW.toISOString()]);
  });

  it('answers it beside an own hold with no order yet', async () => {
    const { service } = setUp({ programmeOrder, order: null });
    const answer = await service.current(student);
    expect(answer.hold?.holdId).toBe(HOLD);
    expect(answer.programmeOrder?.enrollmentId).toBe(PROGRAMME_ENROLLMENT);
  });

  it('answers no programme order when none is payable', async () => {
    const { service } = setUp({ current: null });
    await expect(service.current(student)).resolves.toEqual({});
  });
});
