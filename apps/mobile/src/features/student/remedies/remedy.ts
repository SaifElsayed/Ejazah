// T043 of specs/004-sessions (FR-463 to FR-466, FR-495; R-MOBILE-12; R-320): what the student's
// remedy panel offers, read from `sessions.get`'s `remedy` and nothing else, so the panel only
// draws. The proposal is accepted while the remedy is open (`awaiting_choice`, `proposed`, or
// `counter_proposed`, which withdraws the pending counter); a counter-proposal is offered while
// none is pending; never a refund (T111 of specs/003-booking, DEC-84: a make-up only, whatever
// `canChooseRefund` says). Every one of them is decided again by the server (`sessions.remedy.*`'s
// refusals), the windows being the server's. A settled or frozen remedy says where it stands; a
// status the parties never see (`lapsed`) draws nothing. The lists' `remedyStatus` is a row's line
// (FR-495).
import type { ListedSession, RemedyView } from '@ijazah/contracts';

import type { BadgeProps } from '../../../design/primitives';
import type { MessageKey } from '../../../i18n';

type Status = RemedyView['status'];

/** What the panel draws for a remedy the student sees. */
export interface StudentRemedyShown {
  /** What the remedy is waiting for, or where it stands. */
  readonly text: MessageKey;
  /** The proposal, the choice window's close and any pending counter are drawn. */
  readonly open: boolean;
  readonly counterPending: boolean;
  readonly canAccept: boolean;
  readonly canCounter: boolean;
}

const OPEN: ReadonlySet<Status> = new Set(['awaiting_choice', 'proposed', 'counter_proposed']);

/** The words of a remedy that is no longer open. */
const CLOSED: Readonly<Partial<Record<Status, MessageKey>>> = {
  frozen: 'student.remedy.frozen',
  booked: 'student.remedy.booked',
  refund_case: 'student.remedy.refundCase',
};

const NOTHING_OFFERED = {
  open: false,
  counterPending: false,
  canAccept: false,
  canCounter: false,
} as const;

/** The panel for `remedy`, or undefined for a status the parties never see. */
export function studentRemedyShown(remedy: RemedyView): StudentRemedyShown | undefined {
  if (!OPEN.has(remedy.status)) {
    const text = CLOSED[remedy.status];
    return text === undefined ? undefined : { text, ...NOTHING_OFFERED };
  }
  const counterPending = remedy.status === 'counter_proposed' && remedy.counter !== undefined;
  return {
    text: counterPending ? 'student.remedy.text.counter' : 'student.remedy.text.proposed',
    open: true,
    counterPending,
    canAccept: remedy.proposal !== undefined,
    canCounter: remedy.status !== 'counter_proposed' && remedy.counter === undefined,
  };
}

type ListedRemedyStatus = NonNullable<ListedSession['remedyStatus']>;

interface RowLine {
  readonly key: MessageKey;
  readonly tone: BadgeProps['tone'];
}

/** A session row's remedy line in the student's words: warning while the student is to act. */
const ROW: Readonly<Partial<Record<ListedRemedyStatus, RowLine>>> = {
  awaiting_choice: { key: 'student.remedy.row.awaitingChoice', tone: 'warning' },
  proposed: { key: 'student.remedy.row.proposed', tone: 'warning' },
  counter_proposed: { key: 'student.remedy.row.counterProposed', tone: 'neutral' },
  frozen: { key: 'student.remedy.row.frozen', tone: 'neutral' },
  booked: { key: 'student.remedy.row.booked', tone: 'success' },
  refund_case: { key: 'student.remedy.row.refundCase', tone: 'neutral' },
};

/** The row's line for the lists' `remedyStatus`; none without one, nor for a status never shown. */
export function remedyRowKey(status: ListedSession['remedyStatus']): RowLine | undefined {
  return status === undefined ? undefined : ROW[status];
}
