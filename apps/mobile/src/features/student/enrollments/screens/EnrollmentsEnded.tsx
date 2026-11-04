// T050 (FR-390; screens.md §6 `EnrollmentsEnded`, `EnrollmentsEndedEmpty`): «اشتراكاتي» on the
// ended tab: the completed, ended and cancelled-after-confirmation enrollments, newest first, a page
// at a time as the list reaches its end, each page asked with the cursor the last one answered;
// each card opens its detail. Drawn only on answers read since the tab opened, the cached ones under
// the offline banner with no connection.
import type { StudentEnrollmentItem } from '@ijazah/contracts';
import { useMemo } from 'react';
import { FlatList, View } from 'react-native';

import { AppHeader } from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useOnline } from '../../../../lib/online';
import { LoadError, LoadingRows, NotLoaded, OfflineNotice } from '../../../shared/states';
import { useAnsweredSinceMount } from '../../../shared/states/fresh';
import { ENDED_ENROLLMENTS_QUERY_KEY, useEndedEnrollments } from '../api';
import { EnrollmentCard } from '../components/EnrollmentCard';
import { EnrollmentTabs, openEnrollment } from '../components/EnrollmentTabs';
import { EnrollmentsEndedEmpty } from './EnrollmentsEndedEmpty';

export function EnrollmentsEnded() {
  const t = useT();
  const { color } = useTheme();
  const online = useOnline();
  const zone = useMe().data?.timezone;
  const ended = useEndedEnrollments();
  const answered = useAnsweredSinceMount(ended, ENDED_ENROLLMENTS_QUERY_KEY);
  const pages = answered || !online ? ended.data?.pages : undefined;
  const items = useMemo(() => pages?.flatMap((page) => page.items), [pages]);
  const retry = () => void ended.refetch();

  function more(): void {
    if (ended.hasNextPage && !ended.isFetchingNextPage && !ended.isFetchNextPageError) {
      void ended.fetchNextPage();
    }
  }

  const header = (
    <View style={{ gap: tokens.space['4'] }}>
      {items === undefined ? null : <OfflineNotice onRetry={retry} />}
      {items !== undefined && ended.isRefetchError && online ? <LoadError onRetry={retry} /> : null}
      <EnrollmentTabs value="ended" />
    </View>
  );
  const empty =
    items === undefined || zone === undefined ? (
      <NotLoaded failed={ended.isError} onRetry={retry} />
    ) : (
      <EnrollmentsEndedEmpty />
    );
  const footer = ended.isFetchingNextPage ? (
    <LoadingRows rows={1} />
  ) : ended.isFetchNextPageError ? (
    <LoadError onRetry={() => void ended.fetchNextPage()} />
  ) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <AppHeader title={t('student.enrollments.title')} />
      <FlatList<StudentEnrollmentItem>
        testID="ended-enrollments"
        data={zone === undefined ? [] : (items ?? [])}
        keyExtractor={(item) => item.enrollmentId}
        renderItem={({ item }) =>
          zone === undefined ? null : (
            <EnrollmentCard item={item} zone={zone} onPress={() => openEnrollment(item)} />
          )
        }
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={more}
        contentContainerStyle={{
          flexGrow: 1,
          gap: tokens.space['5'],
          paddingTop: tokens.space['2'],
          paddingHorizontal: tokens.layout.gutter,
          paddingBottom: tokens.space['4'],
        }}
      />
    </View>
  );
}
