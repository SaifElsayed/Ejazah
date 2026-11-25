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
