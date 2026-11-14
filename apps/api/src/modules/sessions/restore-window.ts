// T024 of specs/004-sessions/tasks.md (FR-454; research R-322, R-323 P3-25): the end of an
// enrollment's restore window, derived and never stored (R-DB-4): the closing case's `created_at`,
// written in the closing's own transaction, plus `enrollment_restore_window_days`, each day 24 hours
// of an instant (the owner's decision of 2026-11-10 on B37 lane B's Q7). `sessions.monitor.get`
// shows it as `restorableUntil`. Since T073 (DEC-69) it is only the end of the slot's hold: no restore
// is refused for its time (`window_closed` is never produced). The restore's step 1 reads the closing
// through `closingOf` below (`restore.service.ts`), and the hold's end is read through this one
// function by the hold (`booking/slot-occupancy.repository.ts`), the release
// (`booking/slot-release.service.ts`), the lift (`ban-lift.service.ts`), the monitor
// (`sessions-monitor.service.ts`), the lists (`booking/enrollment-lists.service.ts`) and the sweep
// (`booking/slot-hold-end.sweep.ts`), so they cannot disagree (T082, the follow-up under it, F2).
//
// T070 (FR-503; SRS FR-CANCEL-9, DEC-69; the note under T070, Q4 (a), N4, N10, Q3 (a)): THE ONE
// CLOSING RULE, beside it. An enrollment's closing is its status, its last cancellation's reason and
// its latest end case (the newest compensation case of an end's reason, `END_REASONS`, as R-322's
// step 1 reads it). The closing's kind is that case's reason where the status and the reason admit
// it, R-322's step 1 as T073 widens it:
//
//   - `terminated_no_show`, the case `absence_termination` (a complaint's decision (a));
//   - `cancelled` with `admin`, the case `student_fault_confirmed` (a suspended student's fault
//     confirmed), `student_banned` (a student's ban) or (T082, N8) `admin_ended` (an administrator's
//     direct end, `sessions.endEnrollment`);
//   - `cancelled` with `teacher_suspended`, the case `teacher_ended` (a teacher's ban or revocation;
//     T071 makes a suspension pause, so no suspension closes an enrollment this way any more).
//
// Never a deletion's closing (`account_deleted`, whatever its case) or a gender correction's
// (`gender_correction`), nor any other status or pairing. The kind is restorable only while its case
// is open (N10: step 1 only, never steps 3 to 6, so a ban's closing is held while the ban stands).
// T082 adds `admin_ended` (N8): the hold, the sweep (`close-slot-holds` records its hold's end), the
// monitor's `closingCaseReason` and the restore's step 1 read it with every other kind; it is never
// paused (`enrollment-lists.service.ts`' `BAN_CLOSINGS`) and never lifted (`ban-lift.service.ts`'
// `KIND_OF`). Booking's slot hold (`slotUses`) and release, the monitor's `slotHeldUntil`, and T073's
// step 1 and `closingCaseReason` read this rule, so the hold, the restore and the panel cannot
// disagree (FR-503).
//
// The window's setting follows the kind: `ban_restore_window_days` for a ban's or a revocation's
// closing, `enrollment_restore_window_days` otherwise, a direct end's included (SRS FR-CANCEL-9).
// The caller hands in how a setting is read (`windowDaysOf` over the settings), so a setting is read
// only when a closing needs it; every instant compared with the hold's end is the database's clock (`clockTimestamp`).
import { addDays } from '@ijazah/time';
import { z } from 'zod';

import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { EnrollmentCase } from '../moderation/index.js';
import { END_REASONS } from './case-queue.service.js';
import type { EnrollmentStatus } from './enrollment-side.port.js';

/** The restore window's setting (SRS §3.14 «Enrollment restore window (days)»). */
export const ENROLLMENT_RESTORE_WINDOW_SETTING = 'enrollment_restore_window_days';

/** T070: the ban restore window's setting (SRS §3.14 «Ban restore window (days)», DEC-66). */
export const BAN_RESTORE_WINDOW_SETTING = 'ban_restore_window_days';

/** T070: the two window settings, one per kind of closing. */
export type RestoreWindowSetting =
  typeof ENROLLMENT_RESTORE_WINDOW_SETTING | typeof BAN_RESTORE_WINDOW_SETTING;

/** T070: how a window setting is read, handed in by the caller. */
export type WindowDays = (setting: RestoreWindowSetting) => Promise<number>;

/** T070: a window's schema, whole days, at least one. */
export const restoreWindowDays = z.int().positive();

/** T070: each window setting read from the settings when a closing needs it. */
export function windowDaysOf(settings: Pick<SettingsReader, 'read'>): WindowDays {
  return (setting) => settings.read(setting, restoreWindowDays);
}

/** T070: the closings an administrator started and can restore, by their case's reason. */
export type ClosingKind =
  | 'absence_termination'
  | 'student_fault_confirmed'
  | 'student_banned'
  | 'teacher_ended'
  // T082 (N8): an administrator's direct end.
  | 'admin_ended';

/** T070: what the rule reads of an enrollment's closing. */
export interface ClosingFacts {
  readonly status: EnrollmentStatus;
  /** Its last cancellation's reason (`enrollments.cancellation_reason` while `cancelled`); null for none. */
  readonly lastCancellationReason: string | null;
  /** Its latest end case (`latestEndCaseOf`); null for none. */
  readonly endCase: EnrollmentCase | null;
}

/** T070: a closing the rule admits, its case, and whether that case is still open. */
export interface Closing {
  readonly kind: ClosingKind;
  readonly closingCase: EnrollmentCase;
  readonly restorable: boolean;
}

/** The kinds each status and last cancellation's reason admit (this file's head). */
function kindsOf(status: EnrollmentStatus, reason: string | null): readonly ClosingKind[] {
  if (status === 'terminated_no_show') return ['absence_termination'];
  if (status !== 'cancelled') return [];
  if (reason === 'admin') return ['student_fault_confirmed', 'student_banned', 'admin_ended'];
  if (reason === 'teacher_suspended') return ['teacher_ended'];
  return [];
}

/** T070: of an enrollment's cases, newest first, the newest of an end's reason; null for none. */
export function latestEndCaseOf(cases: readonly EnrollmentCase[]): EnrollmentCase | null {
  return cases.find(({ reason }) => END_REASONS.has(reason)) ?? null;
}

/** T070: the closing's kind and its case, or none for a closing the rule never admits. */
export function closingOf({
  status,
  lastCancellationReason,
  endCase,
}: ClosingFacts): Closing | undefined {
  if (endCase === null) return undefined;
  const kind = kindsOf(status, lastCancellationReason).find((one) => one === endCase.reason);
  if (kind === undefined) return undefined;
  return { kind, closingCase: endCase, restorable: endCase.status === 'open' };
}

/** T070: the window setting of a closing's kind. */
export function windowSettingOf(kind: ClosingKind): RestoreWindowSetting {
  return kind === 'student_banned' || kind === 'teacher_ended'
    ? BAN_RESTORE_WINDOW_SETTING
    : ENROLLMENT_RESTORE_WINDOW_SETTING;
}

/**
 * The instant the restore window closes, the hold's end since DEC-69: the closing case's opening
 * plus the window of the closing's kind (T070), only that setting read.
 */
export async function restorableUntil(
  caseOpenedAt: Date,
  kind: ClosingKind,
  windowDays: WindowDays,
): Promise<Date> {
  return new Date(addDays(caseOpenedAt, await windowDays(windowSettingOf(kind))));
}
