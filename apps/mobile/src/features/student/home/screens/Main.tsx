// T050 (FR-390, FR-393, FR-383, FR-384; screens.md §3 `Main`, `MainOffline`, `StudentHomeEmpty`):
// the student's home. It reads the active tab of the enrollments, which the server orders by next
// session, so the first enrollment with a next session holds the home's next session: «جلستك
// القادمة», the subject and the teacher, its day and time in the student's zone and the teacher's.
// Under it, each active enrollment's card, as the tab draws it, opening its detail; a Confirming
// one is read on FR-383's schedule and, once the window ends, carries FR-384's message. With no
// active enrollment the home is `StudentHomeEmpty`. Drawn only on an answer read since the home
// opened; with no connection the cached home under the offline banner, with the time it was read
// when that was today (`MainOffline`). The notice the route hands it (the identity request's card,
// 002:T074) is drawn first.
import type { ListedSession, StudentEnrollmentItem } from '@ijazah/contracts';
import { Fragment, type ReactNode } from 'react';
import { View } from 'react-native';

import { AppHeader, Card, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useFormatters } from '../../../../lib/formatters';
import { useOnline } from '../../../../lib/online';
import { useSubjectName } from '../../../../lib/subjects';
import { TabScreen } from '../../../shared/screen';
import { LoadError, NotLoaded, OfflineBanner } from '../../../shared/states';
import {
  ACTIVE_ENROLLMENTS_QUERY_KEY,
  isConfirming,
  useActiveEnrollments,
} from '../../enrollments/api';
import { ConfirmingNotice } from '../../enrollments/components/ConfirmingNotice';
import { EnrollmentCard } from '../../enrollments/components/EnrollmentCard';
import { openEnrollment } from '../../enrollments/components/EnrollmentTabs';
import { SessionWhen } from '../../enrollments/components/SessionWhen';
import { useConfirmingSchedule, useScheduledRead } from '../../enrollments/confirming';
import { StudentHomeEmpty } from './StudentHomeEmpty';

export function Main({ notice }: { readonly notice?: ReactNode }) {
  const online = useOnline();
  const me = useMe();
  const schedule = useConfirmingSchedule();
  const active = useActiveEnrollments(schedule.everyMs);
  const read = useScheduledRead(schedule, active, ACTIVE_ENROLLMENTS_QUERY_KEY, (answer) =>
    answer.items.some(isConfirming),
  );
  const items = read.data?.items;
  const zone = me.data?.timezone;
  const header = <AppHeader brand />;

  // The empty home shows no time, so it waits only for the enrollments, not for the account.
  if (items?.length === 0)
    return <StudentHomeEmpty {...(notice === undefined ? {} : { notice })} />;
  if (items === undefined || zone === undefined) {
    return (
      <TabScreen header={header}>
        {notice}
        <NotLoaded
          failed={read.failed || me.isError}
          onRetry={() => {
            read.retry();
            if (me.isError) void me.refetch();
          }}
        />
      </TabScreen>
    );
  }

  const nextOf = items.find((item) => item.next !== undefined);
  return (
    <TabScreen header={header}>
      {online ? null : <OfflineBanner onRetry={read.retry} />}
      {read.failed && online ? <LoadError onRetry={read.retry} /> : null}
      {notice}
      {nextOf?.next === undefined ? null : (
        <NextSession item={nextOf} session={nextOf.next} zone={zone} />
      )}
      {items.map((item) => (
        <Fragment key={item.enrollmentId}>
          <EnrollmentCard item={item} zone={zone} onPress={() => openEnrollment(item)} />
          {read.over && isConfirming(item) ? (
            <ConfirmingNotice enrollmentId={item.enrollmentId} onCheckAgain={read.retry} />
          ) : null}
        </Fragment>
      ))}
      {online ? null : <LastUpdated updatedAt={read.updatedAt} zone={zone} />}
    </TabScreen>
  );
}

/** «جلستك القادمة»: the subject and the teacher, the day and the time in both zones (FR-393). */
function NextSession({
  item,
  session,
  zone,
}: {
  readonly item: StudentEnrollmentItem;
  readonly session: ListedSession;
  readonly zone: string;
}) {
  const t = useT();
  const nameOf = useSubjectName();
  return (
    <Card variant="hero">
      <Text variant="callout" tone="muted">
        {t('student.home.nextSession')}
      </Text>
      <Text variant="title-3">
        {t('student.home.sessionTitle', {
          subject: nameOf(item.summary.subject),
          teacher: item.teacher.displayName,
        })}
      </Text>
      <SessionWhen session={session} zone={zone} />
    </Card>
  );
}

/** `MainOffline`'s «آخر تحديث اليوم {time}», when the home was last read today in `zone`. */
function LastUpdated({ updatedAt, zone }: { readonly updatedAt: number; readonly zone: string }) {
  const t = useT();
  const format = useFormatters();
  if (updatedAt === 0) return null;
  const read = new Date(updatedAt).toISOString();
  const today = format.fullDate(read, zone) === format.fullDate(new Date().toISOString(), zone);
  if (!today) return null;
  return (
    <View style={{ alignItems: 'center' }}>
      <Text variant="caption" tone="muted">
        {t('student.home.lastUpdated', { time: format.time(read, zone) })}
      </Text>
    </View>
  );
}
