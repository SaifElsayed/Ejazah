// T050 (FR-390, FR-383, FR-384; the owner's decision of 2026-11-04): the active enrollments' cards
// as the tab and the home draw them. One awaiting payment takes its badge from its last order
// (`PendingOrderBadge`), read on the screen's schedule; once the window ends, FR-384's message
// follows the card of a Confirming one only, never one whose order the server reports failed.
import type { StudentEnrollmentItem } from '@ijazah/contracts';
import { Fragment } from 'react';

import { isAwaitingPayment } from '../api';
import type { useOrderStates } from '../order-state';
import { ConfirmingNotice } from './ConfirmingNotice';
import { EnrollmentCard } from './EnrollmentCard';
import { openEnrollment } from './EnrollmentTabs';
import { PendingOrderBadge } from './PendingOrderBadge';

export function ActiveCards({
  items,
  zone,
  everyMs,
  over,
  orders,
  onCheckAgain,
}: {
  readonly items: readonly StudentEnrollmentItem[];
  readonly zone: string;
  /** The screen's Confirming schedule. */
  readonly everyMs: number | false;
  /** FR-383's window ended. */
  readonly over: boolean;
  readonly orders: ReturnType<typeof useOrderStates>;
  readonly onCheckAgain: () => void;
}) {
  return items.map((item) => {
    const awaiting = isAwaitingPayment(item);
    return (
      <Fragment key={item.enrollmentId}>
        <EnrollmentCard
          item={item}
          zone={zone}
          onPress={() => openEnrollment(item)}
          pendingBadge={
            awaiting ? (
              <PendingOrderBadge
                enrollmentId={item.enrollmentId}
                everyMs={everyMs}
                onReport={orders.report}
              />
            ) : undefined
          }
        />
        {over && awaiting && orders.isConfirming(item.enrollmentId) ? (
          <ConfirmingNotice enrollmentId={item.enrollmentId} onCheckAgain={onCheckAgain} />
        ) : null}
      </Fragment>
    );
  });
}
