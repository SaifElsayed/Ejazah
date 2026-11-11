// T050 (FR-383, R-HONEST-1; the owner's decision of 2026-11-04): the badge of an enrollment awaiting
// payment, by its last order read since the screen opened (`order-state.ts`): «قيد التأكيد» or
// «بانتظار الدفع», none while the order is not known. It tells the screen what it read, so the
// screen's schedule and FR-384's message follow only a Confirming enrollment.
import { useEffect } from 'react';

import { Badge } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { ORDER_BADGE, type OrderReport, usePendingOrder } from '../order-state';

export function PendingOrderBadge({
  enrollmentId,
  everyMs,
  onReport,
}: {
  readonly enrollmentId: string;
  /** The screen's Confirming schedule. */
  readonly everyMs: number | false;
  readonly onReport: (enrollmentId: string, report: OrderReport) => void;
}) {
  const t = useT();
  const { state, failed, error } = usePendingOrder(enrollmentId, everyMs);
  useEffect(
    () => onReport(enrollmentId, { state, failed, error }),
    [onReport, enrollmentId, state, failed, error],
  );
  if (state === 'unknown') return null;
  const badge = ORDER_BADGE[state];
  return <Badge label={t(badge.label)} tone={badge.tone} />;
}
