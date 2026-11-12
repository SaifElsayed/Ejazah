// T044 of specs/004-sessions (FR-495; the note under T041, Q3 (a)): a session row's remedy on the
// teacher's enrollment screen, from the lists' `remedyStatus`, in the teacher's words: warning
// while a counter-proposal awaits the teacher's answer; nothing for a session without one, nor for
// a status the parties never see.
import type { ListedSession } from '@ijazah/contracts';

import type { BadgeProps } from '../../../design/primitives';
import type { MessageKey } from '../../../i18n';

type ListedRemedyStatus = NonNullable<ListedSession['remedyStatus']>;

interface RowLine {
  readonly key: MessageKey;
  readonly tone: BadgeProps['tone'];
}

const ROW: Readonly<Partial<Record<ListedRemedyStatus, RowLine>>> = {
  awaiting_choice: { key: 'teacher.counter.row.awaitingChoice', tone: 'neutral' },
  proposed: { key: 'teacher.counter.row.proposed', tone: 'neutral' },
  counter_proposed: { key: 'teacher.counter.row.counterProposed', tone: 'warning' },
  frozen: { key: 'teacher.counter.row.frozen', tone: 'neutral' },
  booked: { key: 'teacher.counter.row.booked', tone: 'success' },
  refund_case: { key: 'teacher.counter.row.refundCase', tone: 'neutral' },
};

/** The row's line for the lists' `remedyStatus`; none without one. */
export function teacherRemedyRowKey(status: ListedSession['remedyStatus']): RowLine | undefined {
  return status === undefined ? undefined : ROW[status];
}
