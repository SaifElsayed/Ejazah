// T028 of specs/004-sessions/tasks.md (FR-463, FR-464, FR-494, FR-495; contracts/app-surface.md,
// `RemedyView`): a session's remedy as its parties read it on `sessions.get`, derived when read and
// never stored (R-DB-4). The proposal is its `proposed_date` at the enrollment's slot's local start
// in the enrollment's zone (the monitor's reading); a pending counter its own date, start and zone
// with `answerClosesAt` from D1's one function; a `frozen` remedy shows no proposal; a `lapsed` one is
// never shown; `canChooseRefund` always false, no refund being chosen any more, an `awaiting_choice`
// row offered before the change included (T111 of specs/003-booking, DEC-84); `makeupSessionId` once
// a make-up is booked. T031's procedures answer the same view. No lock, no write.
import type { RemedyView } from '@ijazah/contracts';
import { calendarDateOf, localTimeOf, resolveLocalDateTime } from '@ijazah/time';

import { answerClosesAt } from './remedy-deadlines.js';
import type { RemedyViewRow } from './remedy-offer.repository.js';

/** The seconds a `time` column's local time carries, which the contract's `HH:MM` leaves out. */
const SECONDS = ':00';

/** A local date and start in a zone as the contract shows a remedy's time. */
function remedyTimeOf(
  localDate: Date,
  startTimeLocal: string,
  timezone: string,
): NonNullable<RemedyView['proposal']> {
  const date = calendarDateOf(localDate);
  const { startsAt } = resolveLocalDateTime({
    localDate: date,
    localTime: startTimeLocal,
    timezone,
  });
  return {
    localDate: date,
    startTimeLocal: startTimeLocal.slice(0, -SECONDS.length),
    timezone,
    startsAt,
  };
}

/**
 * The remedy as `sessions.get` answers it, or undefined for a `lapsed` one. `proposalTime` is the
 * enrollment's slot's local start, `HH:MM:SS`, and the enrollment's zone.
 */
export function remedyViewOf(
  remedy: RemedyViewRow,
  proposalTime: { readonly startTimeLocal: string; readonly timezone: string },
): RemedyView | undefined {
  if (remedy.status === 'lapsed') return undefined;
  const counter =
    remedy.status === 'counter_proposed' &&
    remedy.counterDate !== null &&
    remedy.counterStartTimeLocal !== null &&
    remedy.counterTimezone !== null &&
    remedy.counterProposedAt !== null
      ? {
          ...remedyTimeOf(
            remedy.counterDate,
            localTimeOf(remedy.counterStartTimeLocal),
            remedy.counterTimezone,
          ),
          answerClosesAt: answerClosesAt({
            counterProposedAt: remedy.counterProposedAt,
            snapshotAnswerWindowHours: remedy.snapshotAnswerWindowHours,
          }).toISOString(),
        }
      : undefined;
  return {
    status: remedy.status,
    kind: remedy.kind,
    offeredAt: remedy.offeredAt.toISOString(),
    choiceClosesAt: remedy.choiceClosesAt.toISOString(),
    ...(remedy.status === 'frozen' || remedy.proposedDate === null
      ? {}
      : {
          proposal: remedyTimeOf(
            remedy.proposedDate,
            proposalTime.startTimeLocal,
            proposalTime.timezone,
          ),
        }),
    ...(counter === undefined ? {} : { counter }),
    canChooseRefund: false,
    ...(remedy.makeupSessionId === null ? {} : { makeupSessionId: remedy.makeupSessionId }),
  };
}
