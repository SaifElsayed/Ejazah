// T046 (FR-380, FR-386, FR-PAYG-17; screens.md §5 `PaymentSuccess`): drawn only when the server
// reports the enrollment confirmed (R-HONEST-1); any other status leaves for its own screen. The
// receipt: the enrollment with its track, the order reference (the one id a student sees, written
// left to right), the amount paid (the snapshot's price, `summary.price_piasters`). The sessions in
// the student's own zone: the first two, then a line for the last. Where the confirmation came
// late and the first session is not the one the student was shown, it says so with both dates
// (the slot's local dates, FR-368). The board's date-time row and «view enrollment» wait: the
// status carries no confirmation instant, and the enrollment's page is T050's.
import type { CheckoutStatusOutput, EnrollmentSession } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { router } from 'expo-router';
import { View } from 'react-native';

import {
  ActionBar,
  Banner,
  Button,
  IconTile,
  PageIntro,
  Section,
  Summary,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { formatPounds, useFormatters, weekdayIn } from '../../../../lib/formatters';
import {
  EnrollmentValue,
  OrderReference,
  OutcomeLoading,
  OutcomeScreen,
  useEnrollmentParam,
  useLeaveFor,
} from '../components/OutcomeParts';
import { ENROLLMENTS_ROUTE, outcomeOf } from '../outcome';
import { useCheckoutStatus } from '../outcome-api';

/** The sessions the board lists by name; a line names the last of the rest. */
const LISTED_SESSIONS = 2;

export function PaymentSuccess() {
  const enrollmentId = useEnrollmentParam();
  const status = useCheckoutStatus(enrollmentId);
  const me = useMe();
  const outcome = status.data === undefined ? undefined : outcomeOf(status.data);
  useLeaveFor(outcome, 'confirmed', enrollmentId);

  const zone = me.data?.timezone;
  if (status.data === undefined || outcome !== 'confirmed' || zone === undefined) {
    return (
      <OutcomeLoading
        failed={status.isError || me.isError}
        onRetry={() => {
          void status.refetch();
          void me.refetch();
        }}
      />
    );
  }
  return <Receipt status={status.data} zone={zone} />;
}

function Receipt({
  status,
  zone,
}: {
  readonly status: CheckoutStatusOutput;
  readonly zone: string;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const sessions = status.sessions ?? [];
  const first = sessions[0];
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
      <IconTile icon={{ name: 'circle-check' }} tone="primary" size="xl" round />
      <PageIntro
        title={t('student.checkoutConfirmed.title')}
        {...(first === undefined
          ? {}
          : {
              lede: t('student.checkoutConfirmed.lede', {
                weekday: format.weekday(weekdayIn(first.startsAt, zone)),
                time: format.time(first.startsAt, zone),
                date: format.date(first.startsAt, zone),
              }),
            })}
      />
      {status.firstSessionMoved === undefined ? null : (
        <Banner icon={{ name: 'calendar' }} tone="info">
          {t('student.checkoutConfirmed.firstSessionMoved', {
            quoted: format.calendarDate(status.firstSessionMoved.quoted),
            actual: format.calendarDate(status.firstSessionMoved.actual),
          })}
        </Banner>
      )}
      <View accessibilityLabel={t('student.checkoutConfirmed.a11y.receipt')}>
        <Summary
          rows={[
            {
              label: t('student.checkout.enrollment'),
              value: <EnrollmentValue summary={status.summary} track />,
            },
            {
              label: t('student.checkout.orderNumber'),
              value: <OrderReference reference={status.lastOrder.reference} />,
            },
            {
              label: t('student.checkout.amountPaid'),
              value: formatPounds(piasters(status.summary.price_piasters), locale),
              kind: 'total',
            },
          ]}
        />
      </View>
      {sessions.length === 0 ? null : <Sessions sessions={sessions} zone={zone} />}
    </OutcomeScreen>
  );
}

function Sessions({
  sessions,
  zone,
}: {
  readonly sessions: readonly EnrollmentSession[];
  readonly zone: string;
}) {
  const t = useT();
  const format = useFormatters();
  const last = sessions[sessions.length - 1];
  return (
    <Section title={t('student.checkoutConfirmed.sessions')}>
      <Summary
        rows={sessions.slice(0, LISTED_SESSIONS).map((session) => ({
          label: t('student.checkoutConfirmed.sessionN', { n: session.sequenceNumber }),
          value: t('student.checkoutConfirmed.sessionDate', {
            date: format.date(session.startsAt, zone),
            time: format.time(session.startsAt, zone),
          }),
        }))}
      />
      {last === undefined || sessions.length <= LISTED_SESSIONS ? null : (
        <View style={{ paddingHorizontal: tokens.space['1'] }}>
          <Text variant="caption" tone="muted">
            {t('student.checkoutConfirmed.untilSession', {
              n: last.sequenceNumber,
              date: format.date(last.startsAt, zone),
            })}
          </Text>
        </View>
      )}
    </Section>
  );
}
