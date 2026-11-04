// T034 (FR-202), T051 (FR-391): the teacher's day with no session (`TeacherHomeEmpty`), leading to
// the availability. With the day read (T051), its date and «لا جلسات · بتوقيت {city}» above the empty
// state. T074: the route hands it the identity request's card, drawn first while the account is
// under one. The day's navigation and the next session's sentence are not built (board-only, B31).
import type { TeacherTodayOutput } from '@ijazah/contracts';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import { AppHeader, EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { TabScreen } from '../../../shared/screen';
import { DayHeading } from '../components/DayHeading';

export function TeacherHomeEmpty({
  notice,
  day,
}: {
  readonly notice?: ReactNode;
  /** The day read by `teacher.today`, whose date and line it draws. */
  readonly day?: TeacherTodayOutput;
}) {
  const t = useT();
  return (
    <TabScreen header={<AppHeader title={t('teacher.today.title')} />}>
      {notice}
      {day === undefined ? null : <DayHeading day={day} />}
      <EmptyState
        icon={{ name: 'calendar' }}
        title={t('teacher.today.empty.title')}
        action={{
          label: t('teacher.today.empty.availability'),
          onPress: () => router.navigate('/(teacher)/(tabs)/availability'),
        }}
      />
    </TabScreen>
  );
}
