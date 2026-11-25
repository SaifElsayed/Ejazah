// 006:T019, T020 (B-P4's conflict check, the owner, 2026-11-25; Q-2 (a), Q-5 (b), SRS DEC-114;
// contracts/app-surface.md's B-P4 note): `programme.get` gains two instants the server derives, so
// the phone reads no setting. `stopRequestFrom`: the teacher's stop button shows from it (`paused_at`
// + `programme_stop_request_days`), null unless paused and to the student. `payReminderFrom`: the
// «pay before» line shows from it (`payBy` − `programme_pay_reminder_hours`), null unless `offered`.
// Both required and nullable, like the read's other instants. Additive (R-API-9); written before the
// fields and run red first.
import { describe, expect, it } from 'vitest';

import { programmeGetOutput } from './programme.js';

/** An offered programme: offer Mon 18:00 Cairo, `payBy` Wed 18:00, the line from Wed 06:00. */
const OFFERED = {
  state: 'offered',
  offerDueAt: null,
  payBy: '2026-11-25T16:00:00.000Z',
  offer: {
    level: 'جزء عم',
    readiness: 'جاهز',
    expectedLength: 'سنة',
    durationMinutes: 45,
    sessionCount: 60,
    total_piasters: 1_500_000,
    sessionPrice_piasters: 25_000,
    offeredAt: '2026-11-23T16:00:00.000Z',
  },
  plan: null,
  monthsPaid: 0,
  monthCount: 15,
  nextDueAt: null,
  paused: null,
  renewOpen: false,
  chargePending: false,
  payeePending: false,
  payBlocked: false,
  teacherUnavailable: false,
  card: null,
  stopRequestFrom: null,
  payReminderFrom: '2026-11-25T04:00:00.000Z',
  // B-P4 round 2 (Q-B2 (a), Q-B3 (a)): the teacher's alone; none on an offered programme.
  offerTerms: null,
  stopRequestOpen: false,
} as const;

describe('programme.get’s two instants (006:T019, T020; Q-2 (a), Q-5 (b))', () => {
  it('answers payReminderFrom on an offered programme', () => {
    expect(programmeGetOutput.parse(OFFERED)).toEqual(OFFERED);
  });

  it('answers stopRequestFrom on a paused programme', () => {
    const paused = {
      ...OFFERED,
      state: 'paused',
      payBy: null,
      paused: { since: '2026-11-23T16:00:00.000Z' },
      stopRequestFrom: '2026-11-30T16:00:00.000Z',
      payReminderFrom: null,
    };
    expect(programmeGetOutput.parse(paused).stopRequestFrom).toBe('2026-11-30T16:00:00.000Z');
  });

  it('requires both, each an instant or null', () => {
    const { stopRequestFrom: _stop, ...noStop } = OFFERED;
    const { payReminderFrom: _reminder, ...noReminder } = OFFERED;
    expect(programmeGetOutput.safeParse(noStop).success).toBe(false);
    expect(programmeGetOutput.safeParse(noReminder).success).toBe(false);
    expect(
      programmeGetOutput.safeParse({ ...OFFERED, payReminderFrom: 'Wednesday 06:00' }).success,
    ).toBe(false);
    expect(programmeGetOutput.safeParse({ ...OFFERED, stopRequestFrom: 7 }).success).toBe(false);
  });
});

// B-P4 round 2 (the owner's delegation to the review session, 2026-11-25; Q-B2 (a), Q-B3 (a)):
// two teacher-only fields, so T020's screens read the server: `offerTerms` (the reserved weekly
// time's length and the programme package's three prices, while the offer is open to send) and
// `stopRequestOpen` (a `stop` request is open). Both required: null and false for the student.
describe('programme.get’s teacher-only fields (B-P4 round 2, Q-B2 (a), Q-B3 (a))', () => {
  const terms = {
    slotMinutes: 60,
    prices: { m30_piasters: 25_000, m45_piasters: 30_000, m60_piasters: 35_000 },
  };
  const awaiting = { ...OFFERED, state: 'awaiting_offer', payBy: null, offer: null };

  it('answers the offer terms and an open stop request', () => {
    const answer = programmeGetOutput.parse({ ...awaiting, offerTerms: terms, stopRequestOpen: true });
    expect(answer.offerTerms).toEqual(terms);
    expect(answer.stopRequestOpen).toBe(true);
  });

  it('requires both, offerTerms nullable, stopRequestOpen a boolean', () => {
    const { offerTerms: _terms, ...noTerms } = OFFERED;
    const { stopRequestOpen: _open, ...noOpen } = OFFERED;
    expect(programmeGetOutput.safeParse(noTerms).success).toBe(false);
    expect(programmeGetOutput.safeParse(noOpen).success).toBe(false);
    expect(programmeGetOutput.safeParse({ ...OFFERED, stopRequestOpen: null }).success).toBe(false);
  });

  it('refuses terms with a price missing, not whole or not above zero, or no slot length', () => {
    for (const bad of [
      { ...terms, prices: { m30_piasters: 25_000, m45_piasters: 30_000 } },
      { ...terms, prices: { ...terms.prices, m45_piasters: 300.5 } },
      { ...terms, prices: { ...terms.prices, m60_piasters: 0 } },
      { prices: terms.prices },
      { ...terms, slotMinutes: 0 },
    ]) {
      expect(programmeGetOutput.safeParse({ ...awaiting, offerTerms: bad }).success).toBe(false);
    }
  });
});
