// T021 of specs/005-certification (FR-611, FR-614; the note under T021, Q-T4 (a), Q-T5 (a); B47's
// Q-R8 (a)): who is reported, from where, the reasons each role is offered and the text sent.
//
// A student reports a teacher with the student's reasons (`student.report.*`), a teacher a student
// with the teacher's (`teacher.report.*`), as the existing strings hold them. «Wrong gender» is the
// one reason that files a gender flag (`genderFlags.raise`, FR-614); every other one files a report
// (`reports.create`, FR-611). The contract's reason is free text (B47's Q-R8 (a)): the category the
// person chose, in the words they read it in, then their details on the next line; the whole within
// `PARTICIPANT_REASON_MAX_LENGTH`, as the server trims and bounds it. The text is data the
// administrators read, not a sentence the phone shows (R-MOBILE-8).
import { PARTICIPANT_REASON_MAX_LENGTH } from '@ijazah/contracts';

import type { MessageKey } from '../../../i18n';
import type { PartyRole } from '../../../lib/party';

/** Where the report is made from, and the id the contract names for it (`reportsCreateInput`). */
export type ReportPlace =
  | { readonly context: 'session'; readonly sessionId: string }
  | { readonly context: 'chat'; readonly enrollmentId: string }
  | { readonly context: 'profile' };

/** The person reported, as the screen that offers the sheet read them. */
export interface ReportTarget {
  /** Their user id, as the read names it (005:T021, Q-T4 (a)); the server checks the pairing. */
  readonly userId: string;
  /** Their role: a student reports a teacher, a teacher a student. */
  readonly role: PartyRole;
  /** Their name as the screen shows it, a deleted account's stand-in included. */
  readonly name: string;
  readonly place: ReportPlace;
}

/** One reason the sheet offers; `flag` files a gender flag instead of a report (Q-T5 (a)). */
export interface ReportReason {
  readonly label: MessageKey;
  readonly flag: boolean;
}

/** The sheet's words for the role reported. */
export interface ReportWords {
  readonly reasonLabel: MessageKey;
  readonly details: MessageKey;
  readonly detailsPlaceholder: MessageKey;
  readonly submit: MessageKey;
  readonly reasons: readonly ReportReason[];
}

const report = (label: MessageKey): ReportReason => ({ label, flag: false });

/** By the role reported: the student's words on a teacher, the teacher's on a student. */
export const REPORT_WORDS: Readonly<Record<PartyRole, ReportWords>> = {
  teacher: {
    reasonLabel: 'student.report.reason',
    details: 'student.report.details',
    detailsPlaceholder: 'student.report.detailsPlaceholder',
    submit: 'student.report.submit',
    reasons: [
      report('student.report.reasons.misconduct'),
      report('student.report.reasons.fraud'),
      report('student.report.reasons.offensiveContent'),
      { label: 'student.report.reasons.wrongGender', flag: true },
      report('student.report.reasons.other'),
    ],
  },
  student: {
    reasonLabel: 'teacher.report.reasonLabel',
    details: 'teacher.report.details',
    detailsPlaceholder: 'teacher.report.detailsPlaceholder',
    submit: 'teacher.report.submit',
    reasons: [
      report('teacher.report.reasons.behaviour'),
      report('teacher.report.reasons.offPlatform'),
      report('teacher.report.reasons.offensiveContent'),
      { label: 'teacher.report.reasons.genderIncorrect', flag: true },
      report('teacher.report.reasons.other'),
    ],
  },
};

/**
 * The text sent: `category` alone, or `category` then `details` trimmed on the next line;
 * undefined when the whole would pass the contract's bound.
 */
export function reportTextOf(category: string, details: string): string | undefined {
  const written = details.trim();
  const text = written === '' ? category : `${category}\n${written}`;
  return text.length <= PARTICIPANT_REASON_MAX_LENGTH ? text : undefined;
}

/** Whether `details` alone already pass the contract's bound, before a reason is chosen. */
export function detailsTooLong(details: string): boolean {
  return details.trim().length > PARTICIPANT_REASON_MAX_LENGTH;
}
