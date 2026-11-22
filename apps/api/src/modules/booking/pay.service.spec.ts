// T036 — booking's part of `checkout.pay` (FR-354, FR-358, FR-386, R-209; T005's lock rules; the
// owner's decisions of 2026-11-03), over fakes standing for booking's rows and catalog's and
// identity's entries. What the fakes show plainly: the locks' order, that a package no longer as the
// student saw it is refused `SUMMARY_CHANGED` with the package as it now is and nothing written,
// before the gateway and again under the locks, and that the enrollment is written with the id the
// caller drew and the hold linked to it only by the conditional update.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { FixedTerms, PackageRow, ProgrammeAvailability, SlotRow } from '../catalog/index.js';
import type { NewEnrollment, PayHoldRow } from './pay.repository.js';
import {
  enrollOnHold,
  type PayStore,
  type PayTarget,
  payTargetOf,
  payTermsOf,
  type QuotedSummary,
  summaryChanges,
} from './pay.service.js';

const tx = {} as Transaction;
const female = 'female' as RequesterGender;
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const STUDENT = id(10);
const TEACHER = id(90);
const PACKAGE = id(30);
const SLOT = id(40);
const HOLD = id(50);
const ENROLLMENT = id(60);

/** Tuesday 2026-11-03, 10:00 in Cairo. */
const NOW = new Date('2026-11-03T08:00:00Z');
const LATER = new Date('2026-11-03T08:15:00Z');

const pkg: PackageRow = {
  id: PACKAGE,
  subject: { id: id(5), nameAr: 'تجويد', nameEn: 'Tajweed' },
  track: 'recitation',
  sessionCount: 4,
  sessionDurationMinutes: 60,
  price_piasters: piasters(100_000),
  isActive: true,
  // 006:T002 (rule d): `PackageRow` names whether it is a programme package.
  isProgramme: false,
};
const slot = {
  id: SLOT,
  dayOfWeek: 4,
  startTimeLocal: '09:00:00',
  durationMinutes: 60,
  timezone: 'Africa/Cairo',
  isActive: true,
  createdAt: NOW,
} as unknown as SlotRow;
const openHold: PayHoldRow = {
  id: HOLD,
  slotId: SLOT,
  studentUserId: STUDENT,
  packageId: PACKAGE,
  sessionCount: 4,
  enrollmentId: null,
  expiresAt: LATER,
  releasedAt: null,
};
/** What the student saw: the package as it was when the hold was placed. */
const seen: QuotedSummary = {
  price_piasters: piasters(100_000),
  sessionCount: 4,
  sessionDurationMinutes: 60,
  track: 'recitation',
};
/** The hold's count and the slot's length. */
const held = { sessionCount: 4, slotLengthMinutes: 60 };

interface World {
  readonly hold?: PayHoldRow | null;
  readonly pkg?: PackageRow | null;
  readonly linked?: boolean;
  readonly visible?: boolean;
  readonly bookable?: boolean;
  readonly studentActive?: boolean;
}

function setUp(world: World = {}) {
  const log: unknown[][] = [];
  const written: NewEnrollment[] = [];
  const current = world.pkg === undefined ? pkg : world.pkg;
  const store: PayStore = {
    lockRows: async (_tx, table, ids) => void log.push(['lock', table, [...ids]]),
    studentHold: async () => (world.hold === undefined ? openHold : world.hold),
    packageTeacher: async () => (current?.isActive === true ? TEACHER : null),
    teacherPackageOf: async () => current,
    slotById: async () => slot,
    visible: async (_tx, _requester, _teacher, purpose) =>
      purpose === 'discover' ? (world.visible ?? true) : (world.bookable ?? true),
    studentActive: async () => world.studentActive ?? true,
    insertEnrollment: async (_tx, enrollment) => {
      log.push(['insert enrollment', enrollment.id]);
      written.push(enrollment);
    },
    linkActiveHold: async (_tx, hold, enrollmentId) => {
      log.push(['link', hold.id, enrollmentId]);
      return world.linked ?? true;
    },
  };
  return { log, written, store };
}

const target: PayTarget = {
  hold: openHold,
  packageId: PACKAGE,
  teacherUserId: TEACHER,
  // 006:T005 (rule d): the order's kind beside the package's price.
  kind: 'package',
  price_piasters: piasters(100_000),
};

const enrol = (
  store: PayStore,
  quoted: QuotedSummary = seen,
  programme?: () => Promise<ProgrammeAvailability>,
  payTarget: PayTarget = target,
) =>
  enrollOnHold(
    tx,
    payTarget,
    {
      student: { userId: STUDENT, gender: female },
      enrollmentId: ENROLLMENT,
      at: NOW,
      leadHours: 24,
      quoted,
      ...(programme === undefined ? {} : { programme }),
    },
    store,
  );

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

// 006:T005 (rule d): the fields a package with a count and a length shows.
const asNow = (values: Partial<FixedTerms>) => [
  { path: 'summary.price_piasters', code: String(values.price_piasters ?? 100_000) },
  { path: 'summary.sessionCount', code: String(values.sessionCount ?? 4) },
  { path: 'summary.sessionDurationMinutes', code: String(values.sessionDurationMinutes ?? 60) },
  { path: 'summary.track', code: values.track ?? 'recitation' },
];

describe('SUMMARY_CHANGED: the package no longer as the student saw it (the owner’s decisions of 2026-11-03)', () => {
  it('passes the package as the student saw it and as the hold checked it', () => {
    expect(summaryChanges(pkg, seen, held)).toEqual([]);
  });

  it('the price changed: refused, the package as it now is in details', () => {
    expect(summaryChanges({ ...pkg, price_piasters: piasters(120_000) }, seen, held)).toEqual(
      asNow({ price_piasters: piasters(120_000) }),
    );
  });

  it('the session count changed: refused against the count the student saw', () => {
    expect(summaryChanges({ ...pkg, sessionCount: 8 }, seen, held)).toEqual(
      asNow({ sessionCount: 8 }),
    );
  });

  it('the teacher changed the count and the student sends the new summary (read again after a restart): refused against the count the hold checked', () => {
    const changed = { ...pkg, sessionCount: 8 };
    const readAgain = { ...seen, sessionCount: 8 };
    expect(summaryChanges(changed, readAgain, held)).toEqual(asNow({ sessionCount: 8 }));
  });

  it('the package deactivated: refused as inactive', () => {
    expect(summaryChanges({ ...pkg, isActive: false }, seen, held)).toEqual([
      { path: 'package', code: 'inactive' },
    ]);
    expect(summaryChanges(null, seen, held)).toEqual([{ path: 'package', code: 'inactive' }]);
  });

  it('the length changed: refused against the length the student saw and the held slot’s', () => {
    const shorter = { ...pkg, sessionDurationMinutes: 45 as const };
    expect(summaryChanges(shorter, seen, held)).toEqual(asNow({ sessionDurationMinutes: 45 }));
    expect(
      summaryChanges(shorter, { ...seen, sessionDurationMinutes: 45 }, held),
      'the new length sent still differs from the held slot’s',
    ).toEqual(asNow({ sessionDurationMinutes: 45 }));
  });

  it('the track changed: refused against the track the student saw', () => {
    const changed = { ...pkg, track: 'ijazah_track' as const };
    expect(summaryChanges(changed, seen, held)).toEqual(asNow({ track: 'ijazah_track' }));
  });

  it('a summary the student sent that differs from an unchanged package is refused too', () => {
    expect(summaryChanges(pkg, { ...seen, price_piasters: piasters(90_000) }, held)).toEqual(
      asNow({}),
    );
  });
});

describe('payTargetOf: before the gateway, no lock', () => {
  it('answers the hold, its package, teacher and price', async () => {
    const { store, log } = setUp();
    await expect(
      payTargetOf(tx, { studentUserId: STUDENT, holdId: HOLD, at: NOW }, seen, store),
    ).resolves.toEqual(target);
    expect(log).toEqual([]);
  });

  it('answers NOT_FOUND for another student’s hold and an unknown one (M3)', async () => {
    const { store } = setUp({ hold: null });
    const error = await refusal(
      payTargetOf(tx, { studentUserId: STUDENT, holdId: HOLD, at: NOW }, seen, store),
    );
    expect(error.code).toBe('NOT_FOUND');
  });

  it.each([
    ['released', { ...openHold, releasedAt: NOW }],
    ['expired', { ...openHold, expiresAt: NOW }],
    ['already paid on', { ...openHold, enrollmentId: ENROLLMENT }],
  ])('answers HOLD_EXPIRED for a hold %s', async (_name, hold) => {
    const { store } = setUp({ hold });
    const error = await refusal(
      payTargetOf(tx, { studentUserId: STUDENT, holdId: HOLD, at: NOW }, seen, store),
    );
    expect(error.code).toBe('HOLD_EXPIRED');
  });

  it.each([
    ['the price changed', { pkg: { ...pkg, price_piasters: piasters(90_000) } }],
    ['the package deactivated', { pkg: { ...pkg, isActive: false } }],
  ])('refuses SUMMARY_CHANGED when %s, before any order', async (_name, world) => {
    const { store } = setUp(world);
    const error = await refusal(
      payTargetOf(tx, { studentUserId: STUDENT, holdId: HOLD, at: NOW }, seen, store),
    );
    expect(error.code).toBe('SUMMARY_CHANGED');
  });
});

describe('enrollOnHold: under the locks (FR-354, T005)', () => {
  it('locks both accounts in one call, the slot, the hold; writes the enrollment with the drawn id and its snapshot; links the hold', async () => {
    const { store, log, written } = setUp();
    await enrol(store);
    expect(log).toEqual([
      ['lock', 'users', [STUDENT, TEACHER]],
      ['lock', 'availability_slots', [SLOT]],
      ['lock', 'slot_holds', [HOLD]],
      ['insert enrollment', ENROLLMENT],
      ['link', HOLD, ENROLLMENT],
    ]);
    expect(written).toEqual([
      {
        id: ENROLLMENT,
        studentUserId: STUDENT,
        teacherUserId: TEACHER,
        packageId: PACKAGE,
        slotId: SLOT,
        price_piasters: 100_000,
        sessionCount: 4,
        sessionDurationMinutes: 60,
        subjectId: id(5),
        track: 'recitation',
        slotTimezone: 'Africa/Cairo',
        purchasedAt: NOW,
        // Thursday 09:00 in Cairo at least 24 hours after Tuesday 10:00 (FR-368, R-209).
        quotedFirstSessionLocalDate: '2026-11-05',
      },
    ]);
  });

  it.each([
    ['the price changed', { pkg: { ...pkg, price_piasters: piasters(120_000) } }, seen],
    ['the session count changed', { pkg: { ...pkg, sessionCount: 8 } }, seen],
    [
      'the count changed and the new summary was sent',
      { pkg: { ...pkg, sessionCount: 8 } },
      { ...seen, sessionCount: 8 },
    ],
    ['the package deactivated', { pkg: { ...pkg, isActive: false } }, seen],
    ['the length changed', { pkg: { ...pkg, sessionDurationMinutes: 45 as const } }, seen],
    ['the track changed', { pkg: { ...pkg, track: 'ijazah_track' as const } }, seen],
  ])('refuses SUMMARY_CHANGED when %s, writing nothing', async (_name, world, quoted) => {
    const { store, written, log } = setUp(world);
    const error = await refusal(enrol(store, quoted));
    expect(error.code).toBe('SUMMARY_CHANGED');
    expect(error.details?.length).toBeGreaterThan(0);
    expect(written).toEqual([]);
    expect(log.some(([kind]) => kind === 'link')).toBe(false);
  });

  it.each([
    ['NOT_FOUND', { visible: false }],
    ['NOT_BOOKABLE', { bookable: false }],
    ['ACCOUNT_NOT_ACTIVE', { studentActive: false }],
  ])('refuses %s read again under the locks, writing nothing (FR-353)', async (code, world) => {
    const { store, written } = setUp(world);
    const error = await refusal(enrol(store));
    expect(error.code).toBe(code);
    expect(written).toEqual([]);
  });

  it('refuses HOLD_EXPIRED when the conditional update finds the hold no longer open', async () => {
    const { store } = setUp({ linked: false });
    const error = await refusal(enrol(store));
    expect(error.code).toBe('HOLD_EXPIRED');
  });
});

describe('a programme package’s assessment (006:T005; FR-701, FR-702, R-504)', () => {
  const programmePackage: PackageRow = {
    id: PACKAGE,
    subject: { id: id(5), nameAr: 'تجويد', nameEn: 'Tajweed' },
    track: 'ijazah_track',
    isProgramme: true,
    isActive: true,
    prices: {
      m30_piasters: piasters(20_000),
      m45_piasters: piasters(28_000),
      m60_piasters: piasters(35_000),
    },
  };
  /** The fee 200 EGP = 20,000 piasters, the assessment 30 minutes. */
  const OPEN: ProgrammeAvailability = {
    open: true,
    assessmentPrice_piasters: piasters(20_000),
    assessmentDurationMinutes: 30,
  };
  const assessment = {
    kind: 'assessment',
    sessionCount: 1,
    sessionDurationMinutes: 30,
    price_piasters: piasters(20_000),
  } as const;
  const seenAssessment: QuotedSummary = {
    price_piasters: piasters(20_000),
    sessionCount: 1,
    sessionDurationMinutes: 30,
    track: 'ijazah_track',
  };
  const heldAssessment = { sessionCount: 1, slotLengthMinutes: 60 };
  const assessmentHold: PayHoldRow = { ...openHold, sessionCount: 1 };
  const assessmentTarget: PayTarget = {
    hold: assessmentHold,
    packageId: PACKAGE,
    teacherUserId: TEACHER,
    kind: 'assessment',
    price_piasters: null,
  };

  it('passes the assessment as the student saw it, on a weekly time longer than it', () => {
    expect(summaryChanges(programmePackage, seenAssessment, heldAssessment, assessment)).toEqual(
      [],
    );
  });

  it('refuses a changed fee, a hold of another count and a weekly time shorter than the assessment', () => {
    const now = [
      { path: 'summary.price_piasters', code: '25000' },
      { path: 'summary.sessionCount', code: '1' },
      { path: 'summary.sessionDurationMinutes', code: '30' },
      { path: 'summary.track', code: 'ijazah_track' },
    ];
    expect(
      summaryChanges(programmePackage, seenAssessment, heldAssessment, {
        ...assessment,
        price_piasters: piasters(25_000),
      }),
    ).toEqual(now);
    const asNowOne = now.map((issue) =>
      issue.path === 'summary.price_piasters' ? { ...issue, code: '20000' } : issue,
    );
    expect(
      summaryChanges(
        programmePackage,
        seenAssessment,
        { ...heldAssessment, sessionCount: 4 },
        assessment,
      ),
    ).toEqual(asNowOne);
    expect(
      summaryChanges(
        programmePackage,
        { ...seenAssessment, sessionDurationMinutes: 45 },
        { ...heldAssessment, slotLengthMinutes: 30 },
        { ...assessment, sessionDurationMinutes: 45 },
      ).length,
    ).toBe(4);
  });

  it('answers the target as an assessment, priced by the fee later, before the gateway', async () => {
    const { store } = setUp({ pkg: programmePackage, hold: assessmentHold });
    await expect(
      payTargetOf(tx, { studentUserId: STUDENT, holdId: HOLD, at: NOW }, seenAssessment, store),
    ).resolves.toEqual(assessmentTarget);
  });

  it('answers the order: the package’s total, or the assessment at the fee', async () => {
    await expect(payTermsOf(target, seen, async () => OPEN)).resolves.toEqual({
      kind: 'package',
      price_piasters: piasters(100_000),
    });
    await expect(payTermsOf(assessmentTarget, seenAssessment, async () => OPEN)).resolves.toEqual({
      kind: 'assessment',
      price_piasters: piasters(20_000),
    });
  });

  it('refuses the assessment’s order before the gateway when the fee or the length is no longer as seen', async () => {
    for (const availability of [
      { ...OPEN, assessmentPrice_piasters: piasters(25_000) },
      { ...OPEN, assessmentDurationMinutes: 45 as const },
    ]) {
      const error = await refusal(
        payTermsOf(assessmentTarget, seenAssessment, async () => availability),
      );
      expect(error.code).toBe('SUMMARY_CHANGED');
    }
  });

  it('refuses the assessment’s order while the programme is closed, CONFLICT with the cause', async () => {
    await expect(
      payTermsOf(assessmentTarget, seenAssessment, async () => ({
        open: false,
        refusal: 'programme_disabled',
      })),
    ).rejects.toEqual(
      new DomainError('CONFLICT', undefined, {
        details: [{ path: 'cause', code: 'programme_disabled' }],
      }),
    );
  });

  it('writes the enrollment with the assessment’s snapshot: one session, its length, the fee (R-504)', async () => {
    const { store, written } = setUp({ pkg: programmePackage, hold: assessmentHold });
    await enrol(store, seenAssessment, async () => OPEN, assessmentTarget);
    expect(written).toEqual([
      expect.objectContaining({
        price_piasters: 20_000,
        sessionCount: 1,
        sessionDurationMinutes: 30,
        track: 'ijazah_track',
      }),
    ]);
  });

  it('refuses under the locks while the programme is closed, writing nothing', async () => {
    const { store, written, log } = setUp({ pkg: programmePackage, hold: assessmentHold });
    const error = await refusal(
      enrol(
        store,
        seenAssessment,
        async () => ({ open: false, refusal: 'assessment_fee_unset' }),
        assessmentTarget,
      ),
    );
    expect(error.code).toBe('CONFLICT');
    expect(written).toEqual([]);
    expect(log.some(([kind]) => kind === 'link')).toBe(false);
  });
});
