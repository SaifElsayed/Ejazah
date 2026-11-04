// T050 (FR-390, FR-383, FR-384; screens.md §6 `Enrollments`): «اشتراكاتي», the active tab. The
// active enrollments in the server's order (by next session), each a card that opens its detail.
// One Confirming is read on FR-383's schedule and, once the window ends unconfirmed, carries FR-384's
// message under its card. With no active enrollment the ended tab's first page says which empty
// state it is: none on either tab is `EnrollmentsEmpty`, with no tabs (a student before the first
// booking); ended ones keep the tabs, so they stay reachable. Drawn only on answers read since the
// tab opened (`confirming.ts`), the cached ones under the offline banner with no connection.
import { Fragment } from 'react';

import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useOnline } from '../../../../lib/online';
import { TabScreen } from '../../../shared/screen';
import { LoadError, NotLoaded, OfflineNotice } from '../../../shared/states';
import { useAnsweredSinceMount } from '../../../shared/states/fresh';
import {
  ACTIVE_ENROLLMENTS_QUERY_KEY,
  ENDED_ENROLLMENTS_QUERY_KEY,
  isConfirming,
  useActiveEnrollments,
  useEndedEnrollments,
} from '../api';
import { ConfirmingNotice } from '../components/ConfirmingNotice';
import { EnrollmentCard } from '../components/EnrollmentCard';
import { EnrollmentTabs, openEnrollment } from '../components/EnrollmentTabs';
import { useConfirmingSchedule, useScheduledRead } from '../confirming';
import { EnrollmentsEmpty } from './EnrollmentsEmpty';

export function Enrollments() {
  const t = useT();
  const online = useOnline();
  const me = useMe();
  const schedule = useConfirmingSchedule();
  const active = useActiveEnrollments(schedule.everyMs);
  const read = useScheduledRead(schedule, active, ACTIVE_ENROLLMENTS_QUERY_KEY, (answer) =>
    answer.items.some(isConfirming),
  );
  const items = read.data?.items;
  const noneActive = items !== undefined && items.length === 0;
  const ended = useEndedEnrollments(noneActive);
  const endedAnswered = useAnsweredSinceMount(ended, ENDED_ENROLLMENTS_QUERY_KEY);
  const firstEnded = endedAnswered || !online ? ended.data?.pages[0] : undefined;
  const zone = me.data?.timezone;
  const header = <AppHeader title={t('student.enrollments.title')} />;

  // Neither empty state shows a time, so they wait only for the enrollments.
  if (noneActive && firstEnded?.items.length === 0) return <EnrollmentsEmpty />;
  if (items === undefined || zone === undefined || (noneActive && firstEnded === undefined)) {
    const retry = () => {
      if (items === undefined) read.retry();
      else void ended.refetch();
      if (me.isError) void me.refetch();
    };
    return (
      <TabScreen header={header}>
        <NotLoaded
          failed={(items === undefined ? read.failed : ended.isError) || me.isError}
          onRetry={retry}
        />
      </TabScreen>
    );
  }

  return (
    <TabScreen header={header}>
      <OfflineNotice onRetry={read.retry} />
      {read.failed && online ? <LoadError onRetry={read.retry} /> : null}
      <EnrollmentTabs value="active" />
      {noneActive ? (
        <EmptyState
          icon={{ name: 'book' }}
          title={t('student.enrollments.activeEmpty.title')}
          text={t('student.enrollments.activeEmpty.text')}
        />
      ) : (
        items.map((item) => (
          <Fragment key={item.enrollmentId}>
            <EnrollmentCard item={item} zone={zone} onPress={() => openEnrollment(item)} />
            {read.over && isConfirming(item) ? (
              <ConfirmingNotice enrollmentId={item.enrollmentId} onCheckAgain={read.retry} />
            ) : null}
          </Fragment>
        ))
      )}
    </TabScreen>
  );
}
