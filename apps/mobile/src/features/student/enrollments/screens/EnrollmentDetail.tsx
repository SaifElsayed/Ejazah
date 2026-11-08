// T050 (FR-390, FR-393, FR-383, FR-384; screens.md §6 `EnrollmentDetail`, `SessionStates`): one
// enrollment and its sessions. The teacher (the name's initial in the avatar, no photo), the
// package with its track, the status, the weekly time in the student's zone and the teacher's, the
// sessions held of the package's count and the day it runs until, the upcoming, completed and
// remaining sessions (FR-392); then every session by number, its day and time in both zones and its
// status's badge. One awaiting payment says what its last order says (`PendingOrderBadge`): a
// Confirming one is read on FR-383's schedule and, once the window ends unconfirmed, says FR-384's
// message. Drawn only on an answer read since the screen opened. The
// back arrow returns where it was opened from (the tab or the home). Each session's status after
// settlement is its badge (004:T020, FR-495): a disputed session reads «محل نزاع», the outcome
// frozen beside it never answered nor drawn (R-308); the sessions are keyed by their id.
import type { EnrollmentsGetOutput, ListedSession } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { router, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import {
  Avatar,
  Badge,
  Card,
  List,
  ListRow,
  NavHeader,
  Section,
  Text,
} from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters, weekdayIn } from '../../../../lib/formatters';
import { initialsOf } from '../../../shared/account';
import { StackScreen } from '../../../shared/screen';
import { LoadError, NotLoaded, OfflineNotice } from '../../../shared/states';
import { useOnline } from '../../../../lib/online';
import { avatarNameOf, usePartyName } from '../../../../lib/party';
import { enrollmentQueryKey, isAwaitingPayment, useEnrollment } from '../api';
import { ConfirmingNotice } from '../components/ConfirmingNotice';
import { EnrollmentStatusBadge, PackageLine, SessionCounts } from '../components/EnrollmentCard';
import { PendingOrderBadge } from '../components/PendingOrderBadge';
import { SessionWhen, zonesOf } from '../components/SessionWhen';
import { useConfirmingSchedule, useScheduledRead } from '../confirming';
import { useOrderStates } from '../order-state';
import { SESSION_STATUS } from '../status';

/** The route's `id`, or '' when the link carries none. */
function useEnrollmentParam(): string {
  const params = useLocalSearchParams<{ id: string }>();
  return typeof params.id === 'string' ? params.id : '';
}

export function EnrollmentDetail() {
  const t = useT();
  const online = useOnline();
  const enrollmentId = useEnrollmentParam();
  const me = useMe();
  const schedule = useConfirmingSchedule();
  const enrollment = useEnrollment(enrollmentId, schedule.everyMs);
  const orders = useOrderStates();
  const read = useScheduledRead(
    schedule,
    enrollment,
    enrollmentQueryKey(enrollmentId),
    (answer) => isAwaitingPayment(answer) && orders.isConfirming(answer.enrollmentId),
  );
  const failed = read.failed || orders.failed([enrollmentId]);
  const retry = () => {
    read.retry();
    orders.retry();
  };
  const zone = me.data?.timezone;
  const header = (
    <NavHeader
      title={t('student.enrollmentDetail.title')}
      back={{ kind: 'back', onPress: () => router.back() }}
    />
  );
  if (read.data === undefined || zone === undefined) {
    return (
      <StackScreen header={header}>
        <NotLoaded
          failed={read.failed || me.isError || enrollmentId === ''}
          onRetry={() => {
            read.retry();
            if (me.isError) void me.refetch();
          }}
        />
      </StackScreen>
    );
  }
  const shown = read.data;
  return (
    <StackScreen header={header}>
      <OfflineNotice onRetry={retry} />
      {failed && online ? <LoadError onRetry={retry} /> : null}
      <Overview
        enrollment={shown}
        zone={zone}
        pendingBadge={
          isAwaitingPayment(shown) ? (
            <PendingOrderBadge
              enrollmentId={shown.enrollmentId}
              everyMs={schedule.everyMs}
              onReport={orders.report}
            />
          ) : undefined
        }
      />
      {read.over && isAwaitingPayment(shown) && orders.isConfirming(shown.enrollmentId) ? (
        <ConfirmingNotice enrollmentId={shown.enrollmentId} onCheckAgain={read.retry} />
      ) : null}
      {shown.sessions.length === 0 ? null : (
        <Section title={t('student.enrollmentDetail.sessions')}>
          <List>
            {shown.sessions.map((session) => (
              <SessionRow key={session.sessionId} session={session} zone={zone} />
            ))}
          </List>
        </Section>
      )}
    </StackScreen>
  );
}

function Overview({
  enrollment,
  zone,
  pendingBadge,
}: {
  readonly enrollment: EnrollmentsGetOutput;
  readonly zone: string;
  readonly pendingBadge: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const partyName = usePartyName();
  const { last } = enrollment;
  // The weekly time is the slot's, read on the next session, else the last.
  const weekly = enrollment.next ?? last;
  return (
    <Card variant="surface">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['3'] }}>
        <Avatar initials={initialsOf(avatarNameOf(enrollment.teacher))} size="lg" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="headline">{partyName(enrollment.teacher, 'teacher')}</Text>
        </View>
        <EnrollmentStatusBadge status={enrollment.status} pending={pendingBadge} />
      </View>
      <PackageLine summary={enrollment.summary} />
      {weekly === undefined ? null : (
        <View style={{ gap: tokens.space['1'] }}>
          {zonesOf(weekly, zone).map((shownIn) => (
            <Text key={shownIn} variant="callout" tone="muted">
              {t('student.enrollmentDetail.weekly', {
                weekday: format.weekday(weekdayIn(weekly.startsAt, shownIn)),
                time: format.time(weekly.startsAt, shownIn),
                city: cityOf(shownIn, locale) ?? shownIn,
              })}
            </Text>
          ))}
        </View>
      )}
      {last === undefined ? null : (
        <Text variant="callout">
          {t('student.enrollmentDetail.progressUntil', {
            done: enrollment.completed,
            total: enrollment.summary.sessionCount,
            date: format.date(last.startsAt, zone),
          })}
        </Text>
      )}
      <SessionCounts item={enrollment} />
    </Card>
  );
}

/** «الجلسة {n} · {date}», its time in both zones, and its status's badge. */
function SessionRow({ session, zone }: { readonly session: ListedSession; readonly zone: string }) {
  const t = useT();
  const format = useFormatters();
  const badge = SESSION_STATUS[session.status];
  return (
    <ListRow
      label={
        <View style={{ gap: tokens.space['1'] }}>
          <Text weight="medium">
            {t('student.enrollmentDetail.session.labelled', {
              n: session.sequenceNumber,
              date: format.date(session.startsAt, zone),
            })}
          </Text>
          <SessionWhen session={session} zone={zone} />
        </View>
      }
      trailing={<Badge label={t(badge.label)} tone={badge.tone} />}
    />
  );
}
