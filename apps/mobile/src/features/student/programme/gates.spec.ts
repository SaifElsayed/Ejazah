// 006:T019 (FR-706b, FR-710, FR-713, FR-713a, FR-715, FR-716, FR-726, FR-BOOK-19): what the
// student's programme panel offers, read from `programme.get` alone. On the offer: «pay in full» and
// «pay monthly» unless the teacher's payment details are unverified (`payeePending`) or an
// administrator is deciding (`payBlocked`), each with its line, the cancellation always offered. On
// a running programme: «renew now» with no card, «pay now» and «change card» with one, only while
// `renewOpen` and never while `payeePending` or `chargePending`; the automatic renewal's off row only
// while a card is saved. The consent sends `saveCard` on «monthly» only; «change card» saves the
// new card, «pay now» and «renew now» do not.
import type { ProgrammeGetOutput } from '@ijazah/contracts';
import { describe, expect, it } from '@jest/globals';

import { payInputOf, programmeViewOf, renewInputOf } from './gates';

const OFFER = {
  level: 'حافظ لعشرة أجزاء',
  readiness: 'جاهز للإجازة بعد المراجعة',
  expectedLength: 'سنة تقريبًا',
  durationMinutes: 60,
  sessionCount: 40,
  total_piasters: 1_000_000,
  sessionPrice_piasters: 25_000,
  offeredAt: '2026-11-23T16:00:00.000Z',
} as const;

const CARD = { last4: '4242', brand: 'Visa' } as const;

function programme(of: Partial<ProgrammeGetOutput> = {}): ProgrammeGetOutput {
  return {
    state: 'active',
    offerDueAt: '2026-11-23T18:00:00.000Z',
    payBy: '2026-11-25T16:00:00.000Z',
    offer: OFFER,
    plan: 'monthly',
    monthsPaid: 2,
    monthCount: 10,
    nextDueAt: '2026-12-21T18:00:00.000Z',
    paused: null,
    renewOpen: false,
    chargePending: false,
    payeePending: false,
    payBlocked: false,
    teacherUnavailable: false,
    card: null,
    ...of,
  };
}

const offered = (of: Partial<ProgrammeGetOutput> = {}) =>
  programme({ state: 'offered', plan: null, monthsPaid: 0, nextDueAt: null, ...of });

describe('the offer (FR-706b, FR-710, FR-716)', () => {
  it('offers both payments and the cancellation, with no line', () => {
    const view = programmeViewOf(offered());
    expect(view.offer).toEqual({ pay: true, line: null, cancel: true });
    expect(view.renewal).toBeNull();
  });

  it('no pay button while payeePending: the line, the cancellation kept', () => {
    expect(programmeViewOf(offered({ payeePending: true })).offer).toEqual({
      pay: false,
      line: 'payeePending',
      cancel: true,
    });
  });

  it('no pay button while payBlocked: the administration’s line, the cancellation kept', () => {
    expect(programmeViewOf(offered({ payBlocked: true })).offer).toEqual({
      pay: false,
      line: 'payBlocked',
      cancel: true,
    });
    // An administrator deciding says so even where the payee is also unverified.
    expect(programmeViewOf(offered({ payBlocked: true, payeePending: true })).offer).toEqual({
      pay: false,
      line: 'payBlocked',
      cancel: true,
    });
  });

  it('no offer part before the offer or once it is paid', () => {
    expect(programmeViewOf(programme({ state: 'awaiting_offer', offer: null })).offer).toBeNull();
    expect(programmeViewOf(programme()).offer).toBeNull();
  });
});

describe('the renewal (FR-713a, FR-715, FR-716)', () => {
  it('«renew now» with no card saved, while renewOpen', () => {
    expect(programmeViewOf(programme({ renewOpen: true })).renewal).toEqual({
      buttons: ['renewNow'],
      payeeLine: false,
      chargeLine: false,
    });
  });

  it('«pay now» and «change card» with a card saved, while renewOpen', () => {
    expect(programmeViewOf(programme({ renewOpen: true, card: CARD })).renewal?.buttons).toEqual([
      'payNow',
      'changeCard',
    ]);
  });

  it('paused: the renewal stays, and the line says since when', () => {
    const view = programmeViewOf(
      programme({ state: 'paused', renewOpen: true, paused: { since: '2026-12-21T18:00:00.000Z' } }),
    );
    expect(view.renewal?.buttons).toEqual(['renewNow']);
    expect(view.pausedSince).toBe('2026-12-21T18:00:00.000Z');
    expect(programmeViewOf(programme()).pausedSince).toBeNull();
  });

  it('nothing to press while renewOpen is false', () => {
    expect(programmeViewOf(programme({ card: CARD })).renewal?.buttons).toEqual([]);
  });

  it('no pay now or change card while payeePending, even were renewOpen true: the line instead', () => {
    expect(
      programmeViewOf(programme({ renewOpen: true, card: CARD, payeePending: true })).renewal,
    ).toEqual({ buttons: [], payeeLine: true, chargeLine: false });
  });

  it('no renewal while chargePending: the line that the charge is under way', () => {
    expect(
      programmeViewOf(programme({ renewOpen: true, card: CARD, chargePending: true })).renewal,
    ).toEqual({ buttons: [], payeeLine: false, chargeLine: true });
  });

  it('no renewal part on the offer or once closed', () => {
    expect(programmeViewOf(offered()).renewal).toBeNull();
    expect(programmeViewOf(programme({ state: 'closed', renewOpen: true })).renewal).toBeNull();
  });
});

describe('the automatic renewal’s off row (FR-713a)', () => {
  it('shown while a card is saved on a running programme', () => {
    expect(programmeViewOf(programme({ card: CARD })).autoRenewOff).toBe(true);
    expect(programmeViewOf(programme({ state: 'paused', card: CARD })).autoRenewOff).toBe(true);
  });

  it('no off row without a card', () => {
    expect(programmeViewOf(programme({ card: null })).autoRenewOff).toBe(false);
  });

  it('no off row once closed', () => {
    expect(programmeViewOf(programme({ state: 'closed', card: CARD })).autoRenewOff).toBe(false);
  });
});

describe('the teacher unavailable (FR-BOOK-19)', () => {
  it('passes through', () => {
    expect(programmeViewOf(programme({ teacherUnavailable: true })).unavailable).toBe(true);
    expect(programmeViewOf(programme()).unavailable).toBe(false);
  });
});

describe('what the payments send (FR-713)', () => {
  it('the consent saves the card on «monthly» only; in full sends saveCard: false', () => {
    expect(payInputOf('in_full', true)).toEqual({ plan: 'in_full', saveCard: false });
    expect(payInputOf('in_full', false)).toEqual({ plan: 'in_full', saveCard: false });
    expect(payInputOf('monthly', true)).toEqual({ plan: 'monthly', saveCard: true });
    expect(payInputOf('monthly', false)).toEqual({ plan: 'monthly', saveCard: false });
  });

  it('«change card» saves the new card; «pay now» and «renew now» do not', () => {
    expect(renewInputOf('changeCard')).toEqual({ saveCard: true });
    expect(renewInputOf('payNow')).toEqual({ saveCard: false });
    expect(renewInputOf('renewNow')).toEqual({ saveCard: false });
  });
});
