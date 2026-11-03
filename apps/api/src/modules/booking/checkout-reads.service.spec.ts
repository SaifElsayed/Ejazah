// T037 — booking's reads for `checkout.current` and `checkout.status` (FR-358, FR-380 to FR-386,
// FR-BOOK-12 (c), M3), over fakes standing for booking's rows and catalog's, identity's and
// sessions' entries. What they hold: the current hold is the student's own unexpired one, its
// summary the package the hold names as the package is now; the status answers only the student's
// own enrollment, its summary the snapshot, its sessions once generated, and the first session's
// move when it differs from the date the checkout showed. Over the real tables:
// `tests/db-integrity/checkout.spec.ts`.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type { RequesterGender } from '../../platform/guards/requester-gender.js';
import type { PackageRow } from '../catalog/index.js';
import type { EnrollmentSessionRow } from '../sessions/index.js';
import type { CheckoutEnrollmentRow } from './checkout-holds.repository.js';
import {
  type CheckoutReadsStore,
  currentHoldOf,
  enrollmentStatusOf,
} from './checkout-reads.service.js';

const tx = {} as Transaction;
const female = 'female' as RequesterGender;
const id = (n: number) => `0199d0a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const STUDENT = id(10);
const TEACHER = id(90);
const PACKAGE = id(30);
const SLOT = id(40);
const HOLD = id(50);
const ENROLLMENT = id(60);
const SUBJECT = id(5);

/** Tuesday 2026-11-03, 10:00 in Cairo. */
const NOW = new Date('2026-11-03T08:00:00Z');
const LATER = new Date('2026-11-03T08:15:00Z');

const subject = { id: SUBJECT, nameAr: 'تجويد', nameEn: 'Tajweed' };
const pkg: PackageRow = {
  id: PACKAGE,
  subject,
  track: 'recitation',
  sessionCount: 4,
  sessionDurationMinutes: 60,
  price_piasters: piasters(120_000),
  isActive: true,
};
const enrollment: CheckoutEnrollmentRow = {
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
  snapshotSubjectId: SUBJECT,
  snapshotSlotTimezone: 'Africa/Cairo',
  snapshotTrack: 'recitation',
  quotedFirstSessionLocalDate: new Date('2026-11-05T00:00:00Z'),
};
/** A session on `localDate`, 09:00 to 10:00 in Cairo (UTC+2), its instants written out. */
const session = (
  sequenceNumber: number,
  localDate: string,
  startsAt: string,
  endsAt: string,
): EnrollmentSessionRow => ({
  sequenceNumber,
  localDate: localDate as EnrollmentSessionRow['localDate'],
  startTimeLocal: '09:00:00' as EnrollmentSessionRow['startTimeLocal'],
  timezone: 'Africa/Cairo',
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
});

interface World {
  readonly hold?: {
    id: string;
    packageId: string;
    enrollmentId: string | null;
    expiresAt: Date;
  } | null;
  readonly visible?: boolean;
  readonly enrollment?: CheckoutEnrollmentRow | null;
  readonly sessions?: readonly EnrollmentSessionRow[];
}

function storeOf(world: World): CheckoutReadsStore {
  return {
    ownCurrentHold: async () =>
      world.hold === undefined
        ? { id: HOLD, packageId: PACKAGE, enrollmentId: null, expiresAt: LATER }
        : world.hold,
    packageOwnerOf: async () => TEACHER,
    teacherPackageOf: async () => pkg,
    visibleTeacherName: async () => (world.visible === false ? null : 'الشيخ'),
    teacherName: async () => 'الشيخ',
    studentEnrollment: async () => (world.enrollment === undefined ? enrollment : world.enrollment),
    subjectsOf: async () => new Map([[SUBJECT, subject]]),
    sessionsOf: async () => world.sessions ?? [],
  };
}

const student = { userId: STUDENT, gender: female };

describe('currentHoldOf: what CheckoutPrevious shows (FR-BOOK-12 (c), T037)', () => {
  it('answers the student’s unexpired hold with the summary of the package the hold names, as it now is', async () => {
    await expect(currentHoldOf(tx, student, NOW, storeOf({}))).resolves.toEqual({
      holdId: HOLD,
      expiresAt: LATER,
      enrollmentId: null,
      summary: {
        teacher: { teacherId: TEACHER, displayName: 'الشيخ' },
        subject,
        track: 'recitation',
        sessionCount: 4,
        sessionDurationMinutes: 60,
        price_piasters: 120_000,
      },
    });
  });

  it('answers nothing for no hold, an expired one, and one whose teacher the student may no longer see', async () => {
    for (const world of [
      { hold: null },
      { hold: { id: HOLD, packageId: PACKAGE, enrollmentId: null, expiresAt: NOW } },
      { visible: false },
    ]) {
      await expect(currentHoldOf(tx, student, NOW, storeOf(world))).resolves.toBeNull();
    }
  });
});

describe('enrollmentStatusOf: the enrollment as the server holds it (FR-380 to FR-386, T037)', () => {
  it('answers NOT_FOUND for another student’s enrollment and an unknown one (M3)', async () => {
    const refused = await enrollmentStatusOf(
      tx,
      STUDENT,
      ENROLLMENT,
      storeOf({ enrollment: null }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((refused as DomainError).code).toBe('NOT_FOUND');
  });

  it('answers its status and the snapshot’s summary, with no sessions before the confirmation', async () => {
    await expect(enrollmentStatusOf(tx, STUDENT, ENROLLMENT, storeOf({}))).resolves.toEqual({
      enrollmentId: ENROLLMENT,
      status: 'pending_payment',
      summary: {
        teacher: { teacherId: TEACHER, displayName: 'الشيخ' },
        subject,
        track: 'recitation',
        sessionCount: 4,
        sessionDurationMinutes: 60,
        price_piasters: 100_000,
      },
    });
  });

  it('answers a cancellation with its reason', async () => {
    const cancelled = {
      ...enrollment,
      status: 'cancelled' as const,
      cancellationReason: 'payment_expired' as const,
    };
    await expect(
      enrollmentStatusOf(tx, STUDENT, ENROLLMENT, storeOf({ enrollment: cancelled })),
    ).resolves.toMatchObject({ status: 'cancelled', cancellationReason: 'payment_expired' });
  });

  it('answers the sessions once generated, and the first session’s move when it is not the date shown (FR-386)', async () => {
    const confirmed = { ...enrollment, status: 'confirmed' as const };
    const moved = await enrollmentStatusOf(
      tx,
      STUDENT,
      ENROLLMENT,
      storeOf({
        enrollment: confirmed,
        sessions: [
          session(1, '2026-11-12', '2026-11-12T07:00:00Z', '2026-11-12T08:00:00Z'),
          session(2, '2026-11-19', '2026-11-19T07:00:00Z', '2026-11-19T08:00:00Z'),
        ],
      }),
    );
    expect(moved.sessions).toEqual([
      {
        sequenceNumber: 1,
        localDate: '2026-11-12',
        startTimeLocal: '09:00',
        timezone: 'Africa/Cairo',
        startsAt: '2026-11-12T07:00:00.000Z',
        endsAt: '2026-11-12T08:00:00.000Z',
      },
      {
        sequenceNumber: 2,
        localDate: '2026-11-19',
        startTimeLocal: '09:00',
        timezone: 'Africa/Cairo',
        startsAt: '2026-11-19T07:00:00.000Z',
        endsAt: '2026-11-19T08:00:00.000Z',
      },
    ]);
    expect(moved.firstSessionMoved).toEqual({ quoted: '2026-11-05', actual: '2026-11-12' });

    const kept = await enrollmentStatusOf(
      tx,
      STUDENT,
      ENROLLMENT,
      storeOf({
        enrollment: confirmed,
        sessions: [session(1, '2026-11-05', '2026-11-05T07:00:00Z', '2026-11-05T08:00:00Z')],
      }),
    );
    expect(kept.firstSessionMoved).toBeUndefined();
  });
});
