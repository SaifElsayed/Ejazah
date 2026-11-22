// 006:T005 (FR-701, R-504, R-507; U-1, N-12; Q-5 (a)) — the assessment's terms and the student's
// own programme's weekly time.
//
// A package with a count and a length is booked as today; a programme package is booked as its
// assessment: one session at `assessment_duration_minutes` on any weekly time at least that long,
// priced at the assessment's fee, or refused with the switch's or the fee's cause while the
// programme is closed. An active programme's weekly time is answered as its occurrences overlapping a
// window, each resolved on its own date by `packages/time` in the enrollment's zone, so every booking
// path can read it as occupied. Over fakes; the query is `programmes.repository.spec.ts`'s.
import { piasters } from '@ijazah/money';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../../platform/db/prisma.repository.js';
import { DomainError } from '../../platform/errors/domain-error.js';
import type {
  BookablePackage,
  PackageRow,
  ProgrammeAvailability,
  SlotRow,
} from '../catalog/index.js';
import {
  bookingTermsOf,
  fitsSlot,
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
