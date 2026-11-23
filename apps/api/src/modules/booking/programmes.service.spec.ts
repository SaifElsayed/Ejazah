// 006:T005 (FR-701, R-504, R-507; U-1, N-12; Q-5 (a)) — the assessment's terms and the student's
// own programme's weekly time.
//
// A package with a count and a length is booked as today; a programme package is booked as its
// assessment: one session at `assessment_duration_minutes` on any weekly time at least that long,
// priced at the assessment's fee, or refused with the switch's or the fee's cause while the
// programme is closed. An active programme's weekly time is answered as its occurrences overlapping a
// window, each resolved on its own date by `packages/time` in the enrollment's zone, so every booking
// path can read it as occupied. Over fakes; the query is `programmes.repository.spec.ts`'s.
//
// 006:T007: the offer (its own section below).
import type { ProgrammeOfferInput } from '@ijazah/contracts';
import { piasters, programmeOfferAmounts, toPlainNumber } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type {
  BookablePackage,
  PackageRow,
  ProgrammeAvailability,
  SlotRow,
} from '../catalog/index.js';
import type { AssessmentOutcome } from '../sessions/index.js';
import type { FrozenOffer, OfferEnrollment } from './programmes.repository.js';
import {
  bookingTermsOf,
  createProgrammeServices,
  fitsSlot,
  offerWindowOf,
  type ProgrammeOfferStore,
  type ProgrammeServiceDependencies,
  type ProgrammeServices,
  type ProgrammeTimesStore,
  programmeTimesOf,
  purchaseTermsOf,
  refusedStart,
  startProgramme,
  withProgrammeTimes,
} from './programmes.service.js';

const TEACHER = '0199d0a0-0000-7000-8000-0000000005d1';
const STUDENT = '0199d0a0-0000-7000-8000-0000000005d2';
const PACKAGE = '0199d0a0-0000-7000-8000-0000000005d3';
const ENROLLMENT = '0199d0a0-0000-7000-8000-0000000005e1';
const OTHER_ENROLLMENT = '0199d0a0-0000-7000-8000-0000000005e2';
const SLOT = '0199d0a0-0000-7000-8000-0000000005f1';
const CAIRO = 'Africa/Cairo';

const tx = {} as Transaction;

const fixed: BookablePackage = {
  id: PACKAGE,
  teacherUserId: TEACHER,
  isProgramme: false,
  sessionCount: 8,
  sessionDurationMinutes: 45,
};
const PRICES = {
  m30_piasters: piasters(20_000),
  m45_piasters: piasters(28_000),
  m60_piasters: piasters(35_000),
};
const programme: BookablePackage = {
  id: PACKAGE,
  teacherUserId: TEACHER,
  isProgramme: true,
  prices: PRICES,
};
const SUBJECT = { id: '0199d0a0-0000-7000-8000-000000000561', nameAr: 'القرآن', nameEn: "Qur'an" };
const fixedRow: PackageRow = {
  id: PACKAGE,
  subject: SUBJECT,
  isActive: true,
  track: 'recitation',
  isProgramme: false,
  sessionCount: 8,
  sessionDurationMinutes: 45,
  price_piasters: piasters(160_000),
};
const programmeRow: PackageRow = {
  id: PACKAGE,
  subject: SUBJECT,
  isActive: true,
  track: 'ijazah_track',
  isProgramme: true,
  prices: PRICES,
};

/** The fee 200 EGP = 20,000 piasters; the assessment 30 minutes (§3.14's default). */
const OPEN: ProgrammeAvailability = {
  open: true,
  assessmentPrice_piasters: piasters(20_000),
  assessmentDurationMinutes: 30,
};

function readerOf(availability: ProgrammeAvailability) {
  const calls: string[] = [];
  return {
    calls,
    read: async () => {
      calls.push('programme');
      return availability;
    },
  };
}

describe('the terms a package is booked on (FR-701, R-504)', () => {
  it('books a package with a count and a length as today, reading no programme setting', async () => {
    const { read, calls } = readerOf(OPEN);
    await expect(bookingTermsOf(fixed, read)).resolves.toStrictEqual({
      kind: 'package',
      sessionCount: 8,
      sessionDurationMinutes: 45,
    });
    expect(calls).toEqual([]);
  });

  it('books a programme package as its assessment: one session at the assessment’s length', async () => {
    await expect(bookingTermsOf(programme, readerOf(OPEN).read)).resolves.toStrictEqual({
      kind: 'assessment',
      sessionCount: 1,
      sessionDurationMinutes: 30,
    });
  });

  it('refuses a programme package while the switch is off or the fee is unset (Q-5 (a))', async () => {
    for (const refusal of ['programme_disabled', 'assessment_fee_unset'] as const) {
      await expect(
        bookingTermsOf(programme, readerOf({ open: false, refusal }).read),
      ).resolves.toStrictEqual({ refusal });
    }
  });

  it('prices a package at its total and an assessment at the fee (FR-701, FR-702)', async () => {
    await expect(purchaseTermsOf(fixedRow, readerOf(OPEN).read)).resolves.toStrictEqual({
      kind: 'package',
      sessionCount: 8,
      sessionDurationMinutes: 45,
      price_piasters: piasters(160_000),
    });
    await expect(purchaseTermsOf(programmeRow, readerOf(OPEN).read)).resolves.toStrictEqual({
      kind: 'assessment',
      sessionCount: 1,
      sessionDurationMinutes: 30,
      price_piasters: piasters(20_000),
    });
  });

  it('refuses to price a programme package while the programme is closed', async () => {
    await expect(
      purchaseTermsOf(
        programmeRow,
        readerOf({ open: false, refusal: 'assessment_fee_unset' }).read,
      ),
    ).resolves.toStrictEqual({ refusal: 'assessment_fee_unset' });
  });

  it('fits a package on a slot of exactly its length, an assessment on one at least as long (R-504)', () => {
    const pkg = { kind: 'package', sessionCount: 8, sessionDurationMinutes: 45 } as const;
    const assessment = { kind: 'assessment', sessionCount: 1, sessionDurationMinutes: 30 } as const;
    expect([30, 45, 60].map((minutes) => fitsSlot(pkg, minutes))).toEqual([false, true, false]);
    expect([30, 45, 60].map((minutes) => fitsSlot(assessment, minutes))).toEqual([
      true,
      true,
      true,
    ]);
    const longAssessment = { ...assessment, sessionDurationMinutes: 45 };
    expect([30, 45, 60].map((minutes) => fitsSlot(longAssessment, minutes))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('answers a closed programme as CONFLICT with the cause, as every programme refusal', () => {
    expect(refusedStart('programme_disabled')).toEqual(
      new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'programme_disabled' }],
      }),
    );
  });
});

/** Thursday 09:00 for 60 minutes in Cairo, saved in Riyadh's zone to show the enrollment's zone wins. */
const thursdayNine: SlotRow = {
  id: SLOT,
  dayOfWeek: 4,
  startTimeLocal: '09:00:00',
  durationMinutes: 60,
  timezone: 'Asia/Riyadh',
  isActive: true,
  createdAt: new Date('2026-10-01T00:00:00Z'),
};

function timesStoreOf(rows: { enrollmentId: string; slotId: string; timezone: string }[]) {
  const reads: unknown[][] = [];
  const store: ProgrammeTimesStore = {
    activeProgrammeSlotsOf: async (_tx, studentUserIds, exceptEnrollmentId) => {
      reads.push(['activeProgrammeSlotsOf', studentUserIds, exceptEnrollmentId]);
      return rows.filter(({ enrollmentId }) => enrollmentId !== exceptEnrollmentId);
    },
    readSlot: async (_tx, slotId) => {
      reads.push(['readSlot', slotId]);
      return slotId === SLOT ? thursdayNine : null;
    },
  };
  return { store, reads };
}

const asText = (times: readonly { startsAt: Date; endsAt: Date }[]) =>
  times.map(({ startsAt, endsAt }) => [startsAt.toISOString(), endsAt.toISOString()]);

describe('the student’s own programme’s weekly time (U-1, N-12)', () => {
  const window = { from: new Date('2026-11-03T00:00:00Z'), to: new Date('2026-11-20T00:00:00Z') };

  it('answers each week’s occurrence inside the window, in the enrollment’s zone, for the slot’s length', async () => {
    const { store, reads } = timesStoreOf([
      { enrollmentId: ENROLLMENT, slotId: SLOT, timezone: CAIRO },
    ]);
    const times = await programmeTimesOf(tx, [STUDENT], window, { store });
    expect(asText(times)).toEqual([
      ['2026-11-05T07:00:00.000Z', '2026-11-05T08:00:00.000Z'],
      ['2026-11-12T07:00:00.000Z', '2026-11-12T08:00:00.000Z'],
      ['2026-11-19T07:00:00.000Z', '2026-11-19T08:00:00.000Z'],
    ]);
    expect(reads).toEqual([
      ['activeProgrammeSlotsOf', [STUDENT], undefined],
      ['readSlot', SLOT],
    ]);
  });

  it('answers an occurrence that only overlaps the window’s start, and none that only touches its end', async () => {
    const { store } = timesStoreOf([{ enrollmentId: ENROLLMENT, slotId: SLOT, timezone: CAIRO }]);
    const edges = {
      from: new Date('2026-11-05T07:30:00Z'),
      to: new Date('2026-11-12T07:00:00Z'),
    };
    expect(asText(await programmeTimesOf(tx, [STUDENT], edges, { store }))).toEqual([
      ['2026-11-05T07:00:00.000Z', '2026-11-05T08:00:00.000Z'],
    ]);
  });

  it('resolves each week on its own date across Cairo’s April 2026 change', async () => {
    const { store } = timesStoreOf([{ enrollmentId: ENROLLMENT, slotId: SLOT, timezone: CAIRO }]);
    const april = { from: new Date('2026-04-20T00:00:00Z'), to: new Date('2026-05-02T00:00:00Z') };
    expect(asText(await programmeTimesOf(tx, [STUDENT], april, { store }))).toEqual([
      ['2026-04-23T07:00:00.000Z', '2026-04-23T08:00:00.000Z'],
      ['2026-04-30T06:00:00.000Z', '2026-04-30T07:00:00.000Z'],
    ]);
  });

  it('leaves out the enrollment it is asked for (its own make-up, its own postponement)', async () => {
    const { store, reads } = timesStoreOf([
      { enrollmentId: ENROLLMENT, slotId: SLOT, timezone: CAIRO },
    ]);
    const times = await programmeTimesOf(tx, [STUDENT], window, {
      store,
      exceptEnrollmentId: ENROLLMENT,
    });
    expect(times).toEqual([]);
    expect(reads).toEqual([['activeProgrammeSlotsOf', [STUDENT], ENROLLMENT]]);
  });

  it('answers nothing, reading no slot, for a student with no active programme', async () => {
    const { store, reads } = timesStoreOf([]);
    expect(await programmeTimesOf(tx, [STUDENT], window, { store })).toEqual([]);
    expect(reads).toEqual([['activeProgrammeSlotsOf', [STUDENT], undefined]]);
  });

  it('adds the student’s programme times, and only the student’s, to the parties’ busy times', async () => {
    const asked: unknown[] = [];
    const base = async () => [
      { startsAt: new Date('2026-11-04T07:00:00Z'), endsAt: new Date('2026-11-04T08:00:00Z') },
    ];
    const read = withProgrammeTimes(base, async (_tx, studentUserIds, at) => {
      asked.push([studentUserIds, at]);
      return [
        { startsAt: new Date('2026-11-05T07:00:00Z'), endsAt: new Date('2026-11-05T08:00:00Z') },
      ];
    });
    const times = await read(tx, { studentUserId: STUDENT, teacherUserId: TEACHER }, window);
    expect(asText(times)).toEqual([
      ['2026-11-04T07:00:00.000Z', '2026-11-04T08:00:00.000Z'],
      ['2026-11-05T07:00:00.000Z', '2026-11-05T08:00:00.000Z'],
    ]);
    expect(asked).toEqual([[[STUDENT], window]]);
  });

  it('answers another programme of the student beside the one left out', async () => {
    const { store } = timesStoreOf([
      { enrollmentId: ENROLLMENT, slotId: SLOT, timezone: CAIRO },
      { enrollmentId: OTHER_ENROLLMENT, slotId: SLOT, timezone: CAIRO },
    ]);
    const times = await programmeTimesOf(tx, [STUDENT], window, {
      store,
      exceptEnrollmentId: ENROLLMENT,
    });
    expect(times).toHaveLength(3);
  });
});

describe('the programme row (R-504)', () => {
  it('writes the confirmed assessment’s programme `awaiting_offer`, once whatever runs twice', async () => {
    const calls: unknown[] = [];
    const client = {
      programme: {
        createMany: async (query: unknown) => {
          calls.push(query);
          return { count: 1 };
        },
      },
    } as unknown as Transaction;
    await startProgramme(client, ENROLLMENT);
    expect(calls).toEqual([
      { data: [{ enrollmentId: ENROLLMENT, state: 'awaiting_offer' }], skipDuplicates: true },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 006:T007 (FR-705, FR-706a; R-505, R-506, R-507; K-5) — the offer. Over a recording store: the
// locks in kernel.md's order (the teacher's account, the programme, the enrollment), the offer and
// the snapshot written once on the keyed effect's transaction, the amounts from the function payments
// hands in, each refusal `CONFLICT` with its cause, nothing written and one line logged, and the
// live signal to both parties. The rows against Postgres are `tests/db-integrity/programme-offer.spec.ts`'.

/** The DEC-94 example: the 45-minute price 250 EGP, 40 sessions, 10,000 EGP in 10 months. */
const OFFER_PRICES = {
  m30_piasters: piasters(20_000),
  m45_piasters: piasters(25_000),
  m60_piasters: piasters(30_000),
};
const OFFER_PACKAGE: PackageRow = { ...programmeRow, prices: OFFER_PRICES };
const OTHER_TEACHER = '0199d0a0-0000-7000-8000-0000000005d9';
const KEY = '0199d0a0-0000-7000-8000-0000000005aa';

/** Session 1 done, Monday 18:00 Cairo (16:00Z): the offer is due Tuesday 16:00Z (24 h). */
const MONDAY_END = new Date('2026-11-23T16:00:00Z');
const TUESDAY_MORNING = new Date('2026-11-24T10:00:00Z');

// 006:T008 (rule d: T007's seam replaced, Q-3 (a) amended): session 1's outcome chain as sessions'
// entry answers it, in place of the sessions' rows.
const delivered = (endsAt: Date): AssessmentOutcome => ({ kind: 'delivered', endsAt });
const WAITING: AssessmentOutcome = { kind: 'waiting' };

const OFFER_INPUT: ProgrammeOfferInput = {
  enrollmentId: ENROLLMENT,
  level: 'يحفظ جزء عم',
  readiness: 'جاهز',
  expectedLength: 'عشرة أشهر',
  durationMinutes: 45,
  sessionCount: 40,
  idempotencyKey: KEY,
};

type Standing = Awaited<ReturnType<ProgrammeOfferStore['readStanding']>>;

interface OfferWorld {
  enrollment: OfferEnrollment | null;
  standing: Standing;
  outcome: AssessmentOutcome;
  /** 006:T008: the latest `extended` `no_offer` item's decision instant. */
  extendedAt: Date | null;
  slotMinutes: number;
  pkg: PackageRow | null;
  now: Date;
  moved: boolean;
}

const ACTIVE_TEACHER: Standing = {
  accountStatus: 'active',
  teacher: { verificationStatus: 'approved', applicationStatus: 'approved' },
};

function offerWorld(change: Partial<OfferWorld> = {}) {
  const world: OfferWorld = {
    enrollment: {
      id: ENROLLMENT,
      studentUserId: STUDENT,
      teacherUserId: TEACHER,
      packageId: PACKAGE,
      slotId: SLOT,
      status: 'confirmed',
      state: 'awaiting_offer',
    },
    standing: ACTIVE_TEACHER,
    outcome: delivered(MONDAY_END),
    extendedAt: null,
    slotMinutes: 60,
    pkg: OFFER_PACKAGE,
    now: TUESDAY_MORNING,
    moved: true,
    ...change,
  };
  const calls: string[] = [];
  const written: FrozenOffer[] = [];
  const events: [string, Date][] = [];
  const keyed: unknown[] = [];
  const signals: [readonly string[], unknown][] = [];
  const lines: [Readonly<Record<string, unknown>>, string][] = [];
  const priced: [number, number][] = [];
  const dues: (Date | null)[] = [];
  const store: ProgrammeOfferStore = {
    offerEnrollmentOf: async (_tx, id) => {
      calls.push(`read ${id}`);
      return world.enrollment;
    },
    lockAccount: async (_tx, id) => {
      calls.push(`lock users ${id}`);
    },
    readStanding: async (_tx, id) => {
      calls.push(`standing ${id}`);
      return world.standing;
    },
    lockProgramme: async (_tx, id) => {
      calls.push(`lock programmes ${id}`);
    },
    lockEnrollment: async (_tx, id) => {
      calls.push(`lock enrollments ${id}`);
    },
    assessmentOutcome: async (_tx, id) => {
      calls.push(`outcome ${id}`);
      return world.outcome;
    },
    lastExtendedAt: async (_tx, id) => {
      calls.push(`extended ${id}`);
      return world.extendedAt;
    },
    writeOfferDue: async (_tx, id, offerDueAt) => {
      calls.push(`due ${id}`);
      dues.push(offerDueAt);
    },
    readSlot: async (_tx, id) => {
      calls.push(`slot ${id}`);
      return {
        id,
        dayOfWeek: 1,
        startTimeLocal: '17:30',
        durationMinutes: world.slotMinutes,
        timezone: CAIRO,
        isActive: true,
        createdAt: new Date('2026-11-01T00:00:00Z'),
      } as unknown as SlotRow;
    },
    packageOf: async (_tx, teacherUserId, packageId) => {
      calls.push(`package ${teacherUserId} ${packageId}`);
      return world.pkg;
    },
    writeOffer: async (_tx, id, offer) => {
      calls.push(`write ${id}`);
      written.push(offer);
      return world.moved;
    },
    recordOffered: async (_tx, id, occurredAt) => {
      calls.push(`event ${id}`);
      events.push([id, occurredAt]);
    },
  };
  const hours: Readonly<Record<string, number>> = {
    programme_offer_hours: 24,
    programme_pay_rest_hours: 48,
  };
  const services = createProgrammeServices({
    idempotency: {
      run: async (request, effect) => {
        keyed.push(request);
        return effect(tx);
      },
    } as ProgrammeServiceDependencies['idempotency'],
    settings: {
      read: async (key: string) => hours[key],
    } as unknown as ProgrammeServiceDependencies['settings'],
    amounts: (price_piasters, count) => {
      priced.push([toPlainNumber(price_piasters), count]);
      return programmeOfferAmounts(price_piasters, count);
    },
    log: { info: (fields, message) => lines.push([fields, message]) },
    clock: async () => world.now,
    store,
  });
  const live = {
    afterCommit: (to: readonly string[], event: unknown) => signals.push([to, event]),
  } as unknown as Parameters<ProgrammeServices['offer']>[2];
  const offer = (teacherUserId: string = TEACHER, input: ProgrammeOfferInput = OFFER_INPUT) =>
    services.offer(teacherUserId, input, live);
  return { world, offer, calls, written, events, keyed, signals, lines, priced, dues };
}

/** The refusal's cause; a failure when the call was not refused `CONFLICT` with one. */
async function causeOf(call: Promise<unknown>): Promise<string> {
  const error: unknown = await call.then(
    () => new Error('answered instead of refused'),
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe('CONFLICT');
  const [detail] = (error as DomainError).details ?? [];
  expect(detail?.path).toBe('cause');
  return String(detail?.code);
}

describe('programme.offer (006:T007, FR-705, R-506)', () => {
  it('freezes the offer and the snapshot (N + 1, the length, N × its price) and answers the amounts', async () => {
    const { offer, written, priced } = offerWorld();
    await expect(offer()).resolves.toStrictEqual({
      total_piasters: 1_000_000,
      sessionPrice_piasters: 25_000,
      monthCount: 10,
    });
    expect(priced).toEqual([[25_000, 40]]);
    expect(written).toStrictEqual([
      {
        level: 'يحفظ جزء عم',
        readiness: 'جاهز',
        expectedLength: 'عشرة أشهر',
        offeredAt: TUESDAY_MORNING,
        payByAt: new Date('2026-11-26T10:00:00Z'),
        monthCount: 10,
        snapshot: { sessionCount: 41, durationMinutes: 45, price_piasters: 1_000_000 },
      },
    ]);
  });

  it('takes the teacher’s account, the programme, then the enrollment, before it reads the price or writes', async () => {
    const { offer, calls } = offerWorld();
    await offer();
    expect(calls).toEqual([
      `read ${ENROLLMENT}`,
      `lock users ${TEACHER}`,
      `standing ${TEACHER}`,
      `lock programmes ${ENROLLMENT}`,
      `lock enrollments ${ENROLLMENT}`,
      `read ${ENROLLMENT}`,
      `outcome ${ENROLLMENT}`,
      `extended ${ENROLLMENT}`,
      `slot ${SLOT}`,
      `package ${TEACHER} ${PACKAGE}`,
      `due ${ENROLLMENT}`,
      `write ${ENROLLMENT}`,
      `event ${ENROLLMENT}`,
    ]);
  });

  it('records one programme_offered event at the offer’s instant, on the offer’s transaction (FU-A1 (a))', async () => {
    const { offer, events } = offerWorld();
    await offer();
    expect(events).toStrictEqual([[ENROLLMENT, TUESDAY_MORNING]]);
  });

  it('is keyed on programme.offer by the teacher, and signals both parties after the commit', async () => {
    const { offer, keyed, signals, lines } = offerWorld();
    await offer();
    const { idempotencyKey, ...rest } = OFFER_INPUT;
    expect(keyed).toEqual([
      { scope: 'programme.offer', key: idempotencyKey, actorId: TEACHER, input: rest },
    ]);
    expect(signals).toEqual([
      [[TEACHER, STUDENT], { type: 'enrollment', enrollmentId: ENROLLMENT }],
    ]);
    expect(lines).toEqual([
      [
        { teacherUserId: TEACHER, enrollmentId: ENROLLMENT, reason: 'offered' },
        'A programme offer was sent',
      ],
    ]);
  });

  it('prices each length the reserved weekly time holds (60 → 30, 45 or 60)', async () => {
    for (const [durationMinutes, total] of [
      [30, 800_000],
      [60, 1_200_000],
    ] as const) {
      const { offer } = offerWorld();
      await expect(offer(TEACHER, { ...OFFER_INPUT, durationMinutes })).resolves.toMatchObject({
        total_piasters: total,
      });
    }
  });

  it('answers NOT_FOUND to anyone but the enrollment’s teacher, an unknown id included, with no lock', async () => {
    for (const [caller, unknown] of [
      [OTHER_TEACHER, false],
      [STUDENT, false],
      [TEACHER, true],
    ] as const) {
      const { offer, calls, written } = offerWorld(unknown ? { enrollment: null } : {});
      await expect(offer(caller)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(calls).toEqual([`read ${ENROLLMENT}`]);
      expect(written).toEqual([]);
    }
  });

  it('refuses teacher_not_active when the account is not active or not approved, read under its lock', async () => {
    for (const standing of [
      { ...ACTIVE_TEACHER, accountStatus: 'suspended' },
      {
        accountStatus: 'active',
        teacher: { verificationStatus: 'revoked', applicationStatus: 'rejected' },
      },
      null,
    ] as Standing[]) {
      const { offer, calls } = offerWorld({ standing });
      expect(await causeOf(offer())).toBe('teacher_not_active');
      expect(calls.slice(0, 3)).toEqual([
        `read ${ENROLLMENT}`,
        `lock users ${TEACHER}`,
        `standing ${TEACHER}`,
      ]);
    }
  });

  it('refuses not_awaiting_offer past awaiting_offer, or once the enrollment is no longer confirmed', async () => {
    const base = offerWorld().world.enrollment!;
    for (const enrollment of [
      { ...base, state: 'offered' },
      { ...base, state: 'closed' },
      { ...base, status: 'cancelled' },
    ] as OfferEnrollment[]) {
      const { offer } = offerWorld({ enrollment });
      expect(await causeOf(offer())).toBe('not_awaiting_offer');
    }
  });

  it('refuses assessment_not_delivered before session 1 or its make-up is settled done or student_no_show', async () => {
    // 006:T008 (rule d): waiting for its make-up, or ended with no make-up pending (N-2).
    for (const outcome of [WAITING, { kind: 'ended', endsAt: MONDAY_END } as const]) {
      const { offer } = offerWorld({ outcome });
      expect(await causeOf(offer())).toBe('assessment_not_delivered');
    }
  });

  it('writes the derived deadline with the offer, never a refusal’s (006:T008, Q-3 (a) amended)', async () => {
    const { offer, dues } = offerWorld();
    await offer();
    expect(dues).toStrictEqual([new Date('2026-11-24T16:00:00Z')]);
    const refused = offerWorld({ outcome: WAITING });
    await causeOf(refused.offer());
    expect(refused.dues).toEqual([]);
  });

  it('accepts the offer past the delivered deadline within an administrator’s extension (006:T008, I-2 (a))', async () => {
    // Extended Wednesday 10:00 Cairo (08:00Z): 24 hours more, to Thursday 08:00Z.
    const extendedAt = new Date('2026-11-25T08:00:00Z');
    const within = offerWorld({ extendedAt, now: new Date('2026-11-26T07:59:00Z') });
    await expect(within.offer()).resolves.toMatchObject({ monthCount: 10 });
    expect(within.dues).toStrictEqual([new Date('2026-11-26T08:00:00Z')]);
    const past = offerWorld({ extendedAt, now: new Date('2026-11-26T08:00:01Z') });
    expect(await causeOf(past.offer())).toBe('offer_due_passed');
  });

  it('accepts the offer after a student_no_show, the fee kept and the window open', async () => {
    const { offer } = offerWorld({ outcome: delivered(MONDAY_END) });
    await expect(offer()).resolves.toMatchObject({ monthCount: 10 });
  });

  it('refuses offer_due_passed after the delivered end + programme_offer_hours', async () => {
    const { offer } = offerWorld({ now: new Date('2026-11-24T16:00:01Z') });
    expect(await causeOf(offer())).toBe('offer_due_passed');
  });

  it('accepts the offer at the deadline itself', async () => {
    const { offer } = offerWorld({ now: new Date('2026-11-24T16:00:00Z') });
    await expect(offer()).resolves.toMatchObject({ monthCount: 10 });
  });

  it('follows the make-up: re-resolved a teacher’s no-show, the make-up delivered Thursday 18:00, the offer is due Friday (Q-3 (a) amended)', async () => {
    // 006:T008 (rule d): sessions' outcome chain answers the delivered make-up.
    const outcome = delivered(new Date('2026-11-26T16:00:00Z'));
    const late = offerWorld({ outcome, now: new Date('2026-11-27T15:59:00Z') });
    await expect(late.offer()).resolves.toMatchObject({ monthCount: 10 });
    const past = offerWorld({ outcome, now: new Date('2026-11-27T16:00:01Z') });
    expect(await causeOf(past.offer())).toBe('offer_due_passed');
  });

  it('refuses count_out_of_bounds outside 1 to 200', async () => {
    for (const sessionCount of [0, 201]) {
      const { offer, written } = offerWorld();
      expect(await causeOf(offer(TEACHER, { ...OFFER_INPUT, sessionCount }))).toBe(
        'count_out_of_bounds',
      );
      expect(written).toEqual([]);
    }
  });

  it('accepts a count of 1 and of 200', async () => {
    for (const [sessionCount, monthCount] of [
      [1, 1],
      [200, 50],
    ] as const) {
      const { offer } = offerWorld();
      await expect(offer(TEACHER, { ...OFFER_INPUT, sessionCount })).resolves.toMatchObject({
        monthCount,
      });
    }
  });

  it('refuses length_exceeds_slot for a length longer than the reserved weekly time (45 → 30 or 45)', async () => {
    const refused = offerWorld({ slotMinutes: 45 });
    expect(await causeOf(refused.offer(TEACHER, { ...OFFER_INPUT, durationMinutes: 60 }))).toBe(
      'length_exceeds_slot',
    );
    const fits = offerWorld({ slotMinutes: 45 });
    await expect(
      fits.offer(TEACHER, { ...OFFER_INPUT, durationMinutes: 45 }),
    ).resolves.toMatchObject({ monthCount: 10 });
  });

  it('writes nothing, signals no one and logs one line of ids and the reason on a refusal', async () => {
    const { offer, written, events, signals, lines } = offerWorld({ slotMinutes: 30 });
    expect(await causeOf(offer())).toBe('length_exceeds_slot');
    expect(written).toEqual([]);
    expect(events).toEqual([]);
    expect(signals).toEqual([]);
    expect(lines).toEqual([
      [
        { teacherUserId: TEACHER, enrollmentId: ENROLLMENT, reason: 'length_exceeds_slot' },
        'A programme offer was refused',
      ],
    ]);
  });

  it('refuses not_awaiting_offer when the programme did not move from awaiting_offer', async () => {
    const { offer, signals, events } = offerWorld({ moved: false });
    expect(await causeOf(offer())).toBe('not_awaiting_offer');
    expect(signals).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe('offerWindowOf (006:T008, the seam replaced; R-505, Q-3 (a) amended)', () => {
  it('opens at the delivered end and closes programme_offer_hours later', () => {
    expect(offerWindowOf(delivered(MONDAY_END), null, 24)).toStrictEqual({
      delivered: true,
      offerDueAt: new Date('2026-11-24T16:00:00Z'),
    });
  });

  it('has no window while session 1 waits for its make-up, or ended with none pending', () => {
    expect(offerWindowOf(WAITING, null, 24)).toStrictEqual({ delivered: false });
    expect(offerWindowOf({ kind: 'ended', endsAt: MONDAY_END }, null, 24)).toStrictEqual({
      delivered: false,
    });
  });

  it('closes at the later of the delivered end’s and an extension’s deadline', () => {
    expect(
      offerWindowOf(delivered(MONDAY_END), new Date('2026-11-25T08:00:00Z'), 24),
    ).toStrictEqual({ delivered: true, offerDueAt: new Date('2026-11-26T08:00:00Z') });
  });
});
