// T046 (FR-380, FR-381, FR-383, FR-384; screens.md §5 `Processing`, `ProcessingDelayed`): after
// the hosted checkout returns, the app reads the enrollment from the server every
// `processingPollSeconds` and leaves for the outcome the server reports; it never derives one from
// the return (R-HONEST-1). With no confirmation by `confirmationTimeoutSeconds` it releases the
// student with the Confirming state (`ProcessingDelayed`) and stops the schedule; the enrollments
// read it from then on (T050). While the screen stays open, a return to the foreground reads it
// again (T015's focus manager). Only a read made since the screen opened decides an outcome: a
// status cached from an earlier order (a Retry's failure) never sends the student back.
import type { CheckoutSummary } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import {
  ActionBar,
  Button,
  IconTile,
  PageIntro,
  Spinner,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { formatPounds } from '../../../../lib/formatters';
import { OfflineNotice } from '../../../shared/states';
import {
  OutcomeLoading,
  OutcomeScreen,
  useEnrollmentParam,
  useLeaveFor,
  usePackageLine,
} from '../components/OutcomeParts';
import { ENROLLMENTS_ROUTE, outcomeOf } from '../outcome';
import { isEnrollmentId, SECOND_MS, useCheckoutStatus, usePublicConfig } from '../outcome-api';

/** True once `seconds` have passed since they were first known. */
function useTimedOut(seconds: number | undefined): boolean {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (seconds === undefined) return undefined;
    const timer = setTimeout(() => setTimedOut(true), seconds * SECOND_MS);
    return () => clearTimeout(timer);
  }, [seconds]);
  return timedOut;
}

export function Processing() {
  const enrollmentId = useEnrollmentParam();
  const config = usePublicConfig();
  const numbers = config.data?.checkout;
  const released = useTimedOut(numbers?.confirmationTimeoutSeconds);
  const status = useCheckoutStatus(
    enrollmentId,
    numbers === undefined || released ? false : numbers.processingPollSeconds * SECOND_MS,
  );
  const outcome =
    status.data !== undefined && status.isFetchedAfterMount ? outcomeOf(status.data) : undefined;
  useLeaveFor(outcome, 'pending', enrollmentId);

  const retry = () => {
    void config.refetch();
    void status.refetch();
  };
  if (!isEnrollmentId(enrollmentId) || config.isError || (status.isError && !status.data)) {
    return (
      <OutcomeLoading
        failed
        error={
          config.isError ? config.error : status.isError && !status.data ? status.error : undefined
        }
        onRetry={retry}
      />
    );
  }
  if (released) return <Released />;
  return (
    <OutcomeScreen>
      <OfflineNotice onRetry={retry} />
      <View
        accessibilityState={{ busy: true }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: tokens.space['4'] }}
      >
        <Spinner size="lg" />
        <Waiting summary={status.data?.summary} />
      </View>
    </OutcomeScreen>
  );
}

/** The title, then «{package} · {amount}» once the enrollment is read. */
function Waiting({ summary }: { readonly summary: CheckoutSummary | undefined }) {
  const t = useT();
  const locale = useLocale();
  const packageLine = usePackageLine();
  return (
    <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: tokens.space['2'] }}>
      <Text variant="title-3" align="center">
        {t('student.checkoutProcessing.title')}
      </Text>
      {summary === undefined ? null : (
        <Text variant="callout" tone="muted" align="center">
          {t('student.checkoutProcessing.summary', {
            package: packageLine(summary),
            amount: formatPounds(piasters(summary.price_piasters), locale),
          })}
        </Text>
      )}
    </View>
  );
}

/** `ProcessingDelayed`: the student is released, the enrollment Confirming (FR-381, FR-384). */
function Released() {
  const t = useT();
  return (
    <OutcomeScreen
      footer={
        <ActionBar>
          <Button
            label={t('student.checkout.toEnrollments')}
            layout="block"
            onPress={() => router.replace(ENROLLMENTS_ROUTE)}
          />
        </ActionBar>
      }
    >
      <IconTile icon={{ name: 'clock' }} tone="warning" size="xl" round />
      <PageIntro
        title={t('student.checkoutProcessing.delayed.title')}
        lede={t('student.checkoutProcessing.delayed.inApp')}
      />
    </OutcomeScreen>
  );
}
