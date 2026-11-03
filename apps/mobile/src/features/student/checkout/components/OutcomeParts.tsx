// T046: what the four outcome screens share. The enrollment named by the route's `enrollmentId`; the
// move to the screen of the outcome the server reports when it is not the screen's own (R-HONEST-1:
// no screen draws an outcome the server did not report); the package as one line and the
// enrollment as the receipts write it; and the frame while the status is read.
import type { CheckoutSummary } from '@ijazah/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useEffect } from 'react';
import { View } from 'react-native';

import { Badge, Skeleton, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useSubjectName } from '../../../../lib/subjects';
import { StackScreen } from '../../../shared/screen';
import { NotLoaded } from '../../../shared/states';
import { type CheckoutOutcome, outcomeRoute } from '../outcome';

/** The route's `enrollmentId`, or '' when the link carries none. */
export function useEnrollmentParam(): string {
  const params = useLocalSearchParams<{ enrollmentId: string }>();
  return typeof params.enrollmentId === 'string' ? params.enrollmentId : '';
}

/** Replaces the screen with the outcome's own once the server reports one that is not `own`. */
export function useLeaveFor(
  outcome: CheckoutOutcome | undefined,
  own: CheckoutOutcome,
  enrollmentId: string,
): void {
  useEffect(() => {
    if (outcome === undefined || outcome === own) return;
    router.replace(outcomeRoute(outcome, enrollmentId));
  }, [outcome, own, enrollmentId]);
}

/** «{subject} · N sessions». */
export function usePackageLine(): (summary: CheckoutSummary) => string {
  const t = useT();
  const nameOf = useSubjectName();
  return (summary) =>
    t('common.format.packageShort', {
      subject: nameOf(summary.subject),
      count: summary.sessionCount,
    });
}

const TRACK_LABEL: Readonly<Record<CheckoutSummary['track'], MessageKey>> = {
  recitation: 'common.track.recitation',
  ijazah_track: 'common.track.ijazahTrack',
};

/** «{teacher} · {package}», with the track badge where the board draws it. */
export function EnrollmentValue({
  summary,
  track = false,
}: {
  readonly summary: CheckoutSummary;
  readonly track?: boolean;
}) {
  const t = useT();
  const packageLine = usePackageLine();
  return (
    <View style={{ flexShrink: 1, alignItems: 'flex-end', gap: tokens.space['1'] }}>
      <Text weight="medium" align="end">
        {t('common.package.withTeacher', {
          teacher: summary.teacher.displayName,
          package: packageLine(summary),
        })}
      </Text>
      {track ? (
        <Badge
          label={t(TRACK_LABEL[summary.track])}
          tone={summary.track === 'ijazah_track' ? 'accent' : 'neutral'}
        />
      ) : null}
    </View>
  );
}

/** An outcome screen: no back (the order is behind it), the body, and its actions at the foot. */
export function OutcomeScreen({
  children,
  footer,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <StackScreen header={<View style={{ height: tokens.space['6'] }} />} footer={footer}>
      {children}
    </StackScreen>
  );
}

/** The status not read yet, its read failed, or the screen is leaving for another outcome. */
export function OutcomeLoading({
  failed,
  onRetry,
}: {
  readonly failed: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <OutcomeScreen>
      <NotLoaded failed={failed} onRetry={onRetry} loading={<Skeleton shape="block" />} />
    </OutcomeScreen>
  );
}

/**
 * The order's reference in a receipt's row, written left to right and wrapped inside the row: a
 * value that is not plain text gets no room to shrink from `Summary`, so a long reference ran past
 * the card's edge (B30's device run).
 */
export function OrderReference({ reference }: { readonly reference: string }) {
  return (
    <View style={{ flexShrink: 1 }}>
      <Text weight="medium" ltr>
        {reference}
      </Text>
    </View>
  );
}
