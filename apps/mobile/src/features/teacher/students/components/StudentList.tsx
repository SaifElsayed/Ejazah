// T051 (FR-391, FR-393; screens.md §14): what both tabs of «طلابي» share. The header, the search by
// the student's name, the two tabs, and the tab's rows as `teacher.students.list` answers them: the
// active tab in one page by next session, the ended one paged as the list reaches its end (R-204).
// The search goes to the server once typing pauses; the rows are its answer as it is. The tab decides
// only on what it read since it opened (`read-since-mount.ts`): before that, the shared states
// (002:T138), a failed read the retry state whatever is cached, and with no connection the cached
// rows under the offline banner. A tab with nothing and no search has no search field (the shape of
// `TeacherStudentsEmpty`); a search with nothing says so under the field.
import type { EnrollmentListTab, TeacherStudentItem } from '@ijazah/contracts';
import { router } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import {
  AppHeader,
  CategoryTabs,
  EmptyState,
  List,
  SearchRow,
  Text,
} from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useOnline } from '../../../../lib/online';
import { LoadError, LoadingRows, NotLoaded, OfflineNotice } from '../../../shared/states';
import { readSinceMount } from '../../read-since-mount';
import { type StudentsQuery, useTeacherStudents } from '../api';
import { useSettledSearch } from '../search';
import { StudentRow } from './StudentRow';

/** The enrollment's page (`TeacherEnrollment`). */
export function openEnrollment(enrollmentId: string): void {
  router.push({ pathname: '/(teacher)/students/[enrollmentId]', params: { enrollmentId } });
}

/** «جارية» is the students tab; «منتهية» the screen pushed over it (screens.md §14). */
export function StudentTabs({ tab }: { readonly tab: EnrollmentListTab }) {
  const t = useT();
  return (
    <CategoryTabs
      tabs={[
        { value: 'active', label: t('teacher.students.tabs.active') },
        { value: 'ended', label: t('teacher.students.tabs.ended') },
      ]}
      value={tab}
      onChange={(chosen) => {
        if (chosen === tab) return;
        if (chosen === 'ended') router.push('/(teacher)/students/ended');
        else router.navigate('/(teacher)/(tabs)/students');
      }}
      accessibilityLabel={t('teacher.students.tabs.a11y')}
    />
  );
}

export function StudentList({
  tab,
  whenNone,
}: {
  readonly tab: EnrollmentListTab;
  /** The tab with nothing and no search: the whole screen for the active tab, else its state. */
  readonly whenNone: { readonly screen: ReactNode } | { readonly state: ReactNode };
}) {
  const t = useT();
  const { color } = useTheme();
  const online = useOnline();
  const viewerZone = useMe().data?.timezone;
  const [typed, setTyped] = useState('');
  const search = useSettledSearch(typed);
  const query: StudentsQuery = search === '' ? { tab } : { tab, query: search };
  const list = useTeacherStudents(query);
  const read = readSinceMount({
    data: list.data,
    isError: list.isError && !list.isFetchNextPageError,
    isFetchedAfterMount: list.isFetchedAfterMount,
  });
  const offlineCached = read.state === 'waiting' && !online && read.cached !== undefined;
  const pages =
    read.state === 'read'
      ? read.data.pages
      : read.state === 'waiting' && offlineCached
        ? read.cached?.pages
        : undefined;
  const items = useMemo(() => pages?.flatMap((page) => page.items) ?? [], [pages]);
  const retry = () => void list.refetch();
  const none = pages !== undefined && items.length === 0;

  if (none && search === '' && 'screen' in whenNone) return whenNone.screen;

  function more(): void {
    if (list.hasNextPage && !list.isFetchingNextPage && !list.isFetchNextPageError) {
      void list.fetchNextPage();
    }
  }

  const header = (
    <View style={{ gap: tokens.space['4'] }}>
      {offlineCached ? <OfflineNotice onRetry={retry} /> : null}
      {none && search === '' ? null : (
        <SearchRow
          value={typed}
          onChangeText={setTyped}
          placeholder={t('teacher.students.search')}
        />
      )}
      <StudentTabs tab={tab} />
    </View>
  );

  const empty =
    pages === undefined ? (
      <NotLoaded failed={read.state === 'failed'} error={list.error} onRetry={retry} />
    ) : search !== '' ? (
      <EmptyState
        icon={{ name: 'search' }}
        title={t('teacher.students.searchEmpty.title')}
        text={t('teacher.students.searchEmpty.text')}
      />
    ) : 'state' in whenNone ? (
      whenNone.state
    ) : null;

  const footer = list.isFetchingNextPage ? (
    <LoadingRows rows={1} />
  ) : list.isFetchNextPageError ? (
    <LoadError error={list.error} onRetry={() => void list.fetchNextPage()} />
  ) : tab === 'ended' && items.length > 0 ? (
    <Text variant="caption" tone="muted">
      {t('teacher.students.endedNote')}
    </Text>
  ) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <AppHeader title={t('teacher.students.title')} />
      <FlatList<readonly TeacherStudentItem[]>
        data={items.length === 0 ? [] : [items]}
        keyExtractor={() => tab}
        renderItem={({ item: rows }) => (
          <List>
            {rows.map((row) => (
              <StudentRow
                key={row.enrollmentId}
                item={row}
                viewerZone={viewerZone}
                onPress={() => openEnrollment(row.enrollmentId)}
              />
            ))}
          </List>
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={<>{empty}</>}
        ListFooterComponent={footer}
        onEndReached={more}
        keyboardShouldPersistTaps="handled"
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
