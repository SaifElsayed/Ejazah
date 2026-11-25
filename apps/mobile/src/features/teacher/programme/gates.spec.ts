// 006:T020 (FR-705, FR-706b, FR-723, FR-726; SRS DEC-112; B-P4's conflict check, Q-2 (a)): what the
// teacher's programme panel offers, from `programme.get` alone. The offer form only while awaiting the
// offer with the assessment delivered (its deadline known); the offer as sent once offered; the
// administration's line while `payBlocked`; the months while it runs; «late since» while paused. The
// stop request only from the server's `stopRequestFrom` on: never while it is null, never before it.
// The offer's texts 1 to 500 characters once trimmed; the session price for a length from the
// teacher's one programme package of the enrollment's subject.
import type { ProgrammeGetOutput, TeacherPackage } from '@ijazah/contracts';
import { describe, expect, it } from '@jest/globals';

import { offerTextOf, sessionPriceOf, stopRequestShown, teacherProgrammeViewOf } from './gates';

const OFFER = {
  level: 'حافظ لعشرة أجزاء',
  readiness: 'جاهز',
  expectedLength: 'سنة',
  durationMinutes: 60,
  sessionCount: 40,
  total_piasters: 1_000_000,
  sessionPrice_piasters: 25_000,
  offeredAt: '2026-11-23T16:00:00.000Z',
} as const;

function programme(of: Partial<ProgrammeGetOutput> = {}): ProgrammeGetOutput {
  return {
    state: 'awaiting_offer',
    offerDueAt: '2026-11-20T18:30:00.000Z',
    payBy: null,
    offer: null,
    plan: null,
    monthsPaid: 0,
    monthCount: null,
    nextDueAt: null,
    paused: null,
    renewOpen: false,
    chargePending: false,
    payeePending: false,
    payBlocked: false,
    teacherUnavailable: false,
    card: null,
    stopRequestFrom: null,
    payReminderFrom: null,
    ...of,
  };
}

const NOW = new Date('2026-12-28T18:00:00.000Z');

describe('teacherProgrammeViewOf', () => {
  it('offers the form while awaiting the offer with the assessment delivered', () => {
    expect(teacherProgrammeViewOf(programme()).offerForm).toBe(true);
  });

  it('no offer form before the assessment is delivered (no deadline yet)', () => {
    expect(teacherProgrammeViewOf(programme({ offerDueAt: null })).offerForm).toBe(false);
  });

  it('no offer form when not awaiting_offer', () => {
    for (const state of ['offered', 'active', 'paused', 'closed'] as const) {
      expect(teacherProgrammeViewOf(programme({ state, offer: OFFER })).offerForm).toBe(false);
    }
  });

  it('shows the offer as sent once offered and while it runs, never before or once closed', () => {
    for (const state of ['offered', 'active', 'paused'] as const) {
      expect(teacherProgrammeViewOf(programme({ state, offer: OFFER })).sentOffer).toBe(true);
    }
    expect(teacherProgrammeViewOf(programme()).sentOffer).toBe(false);
    expect(teacherProgrammeViewOf(programme({ state: 'closed', offer: OFFER })).sentOffer).toBe(
      false,
    );
  });

  it('the administration’s line while payBlocked', () => {
    expect(
      teacherProgrammeViewOf(programme({ state: 'offered', offer: OFFER, payBlocked: true }))
        .payBlocked,
    ).toBe(true);
    expect(teacherProgrammeViewOf(programme({ state: 'offered', offer: OFFER })).payBlocked).toBe(
      false,
    );
  });

  it('the months while it runs, and «late since» while paused', () => {
    const since = '2026-12-21T18:00:00.000Z';
    const paused = teacherProgrammeViewOf(
      programme({ state: 'paused', offer: OFFER, monthCount: 10, paused: { since } }),
    );
    expect(paused.running).toBe(true);
    expect(paused.lateSince).toBe(since);
    const active = teacherProgrammeViewOf(programme({ state: 'active', offer: OFFER }));
    expect(active.running).toBe(true);
    expect(active.lateSince).toBeNull();
    expect(teacherProgrammeViewOf(programme({ state: 'offered', offer: OFFER })).running).toBe(
      false,
    );
  });
});

describe('stopRequestShown (SRS DEC-112, FR-723; Q-2 (a))', () => {
  it('shows the stop request from stopRequestFrom on', () => {
    expect(stopRequestShown({ stopRequestFrom: '2026-12-28T18:00:00.000Z' }, NOW)).toBe(true);
    expect(stopRequestShown({ stopRequestFrom: '2026-12-01T00:00:00.000Z' }, NOW)).toBe(true);
  });

  it('no stop button before stopRequestFrom', () => {
    expect(stopRequestShown({ stopRequestFrom: '2026-12-28T18:00:01.000Z' }, NOW)).toBe(false);
  });

  it('no stop button when stopRequestFrom is null', () => {
    expect(stopRequestShown({ stopRequestFrom: null }, NOW)).toBe(false);
  });
});

describe('offerTextOf (FR-705; 1 to 500 characters)', () => {
  it('takes a text of 1 to 500 characters once trimmed', () => {
    expect(offerTextOf('  حافظ  ')).toBe('حافظ');
    expect(offerTextOf('ا'.repeat(500))).toBe('ا'.repeat(500));
  });

  it('refuses a blank text and one longer than 500', () => {
    expect(offerTextOf('   ')).toBeNull();
    expect(offerTextOf('ا'.repeat(501))).toBeNull();
  });
});

describe('sessionPriceOf (FR-705)', () => {
  const QURAN = {
    id: '0193a6f0-0000-7000-8000-0000000000a1',
    nameAr: 'حفظ القرآن',
    nameEn: 'Quran',
  };
  const TAJWEED = {
    id: '0193a6f0-0000-7000-8000-0000000000a2',
    nameAr: 'التجويد',
    nameEn: 'Tajweed',
  };
  const programmePackage = (subject: typeof QURAN, id: string): TeacherPackage => ({
    id,
    subject,
    track: 'ijazah_track',
    isProgramme: true,
    prices: { m30_piasters: 15_000, m45_piasters: 20_000, m60_piasters: 25_000 },
    isActive: true,
    activeEnrollmentCount: 1,
    frozen: true,
  });
  const fixed: TeacherPackage = {
    id: '0193a6f0-0000-7000-8000-0000000000b9',
    subject: QURAN,
    track: 'recitation',
    sessionCount: 8,
    sessionDurationMinutes: 60,
    price_piasters: 99_900,
    perSession_piasters: 12_487,
    isActive: true,
    activeEnrollmentCount: 0,
    frozen: false,
  };

  it('reads the price for the length from the one programme package of the subject', () => {
    const packages = [fixed, programmePackage(QURAN, '0193a6f0-0000-7000-8000-0000000000b1')];
    expect(sessionPriceOf(packages, QURAN.id, 30)).toBe(15_000);
    expect(sessionPriceOf(packages, QURAN.id, 45)).toBe(20_000);
    expect(sessionPriceOf(packages, QURAN.id, 60)).toBe(25_000);
  });

  it('none without one, or with two of the subject (the server prices the offer)', () => {
    expect(sessionPriceOf([fixed], QURAN.id, 60)).toBeUndefined();
    expect(
      sessionPriceOf(
        [programmePackage(TAJWEED, '0193a6f0-0000-7000-8000-0000000000b2')],
        QURAN.id,
        60,
      ),
    ).toBeUndefined();
    expect(
      sessionPriceOf(
        [
          programmePackage(QURAN, '0193a6f0-0000-7000-8000-0000000000b1'),
          programmePackage(QURAN, '0193a6f0-0000-7000-8000-0000000000b3'),
        ],
        QURAN.id,
        60,
      ),
    ).toBeUndefined();
  });
});
