// T029 (FR-332 to FR-335): the discovery tab (screens.md §4). It reads `discovery.browse` for what the
// student chose and draws its state: not read yet, the shared states (002:T138) under the search;
// no teacher at all, `DiscoveryNoTeachers`; else the search row with its filter trigger, the subject
// tabs with their counts (hidden while searching, `DiscoverySearch`), the applied filters' chips
// (`DiscoveryFiltered`), and the cards, or the empty state of a search (`DiscoverySearchEmpty`) or of
// the section and its filters (`DiscoveryEmpty`). The cards page as the list reaches its end, each
// page asked with the cursor the last answered (R-204). The filters open in `DiscoveryFilter`.
import type { DiscoveryCard } from '@ijazah/contracts';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import { AppHeader, CategoryTabs, SearchRow } from '../../../../design/primitives';
import { useTheme } from '../../../../design/theme';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useMe } from '../../../../lib/account';
import { useSubjectName } from '../../../../lib/subjects';
import { LoadError, NotLoaded, OfflineNotice } from '../../../shared/states';
import { useDiscoveryBrowse } from '../api';
import { DiscoveryFilter } from '../components/DiscoveryFilter';
import { DiscoveryFiltered } from '../components/DiscoveryFiltered';
import { LoadingCards } from '../components/LoadingCards';
import { TeacherCard } from '../components/TeacherCard';
import { useSettledSearch } from '../search';
import {
  appliedFilters,
  browseQueryOf,
  type DiscoveryFilters,
  discoveryView,
  filterCount,
  NO_FILTERS,
  withFilter,
} from '../state';
import { DiscoveryEmpty } from './DiscoveryEmpty';
import { DiscoveryNoTeachers } from './DiscoveryNoTeachers';
import { DiscoverySearchEmpty } from './DiscoverySearchEmpty';

/** The tab of all subjects, which has no subject. */
const ALL = 'all';

/** The teacher's page (T030). */
function openTeacher(teacherId: string): void {
  router.push({ pathname: '/(student)/discovery/[teacherId]', params: { teacherId } });
}

export function Discovery() {
  const t = useT();
  const { color } = useTheme();
  const nameOf = useSubjectName();
  const me = useMe();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [filters, setFilters] = useState<DiscoveryFilters>(NO_FILTERS);
  const [filtering, setFiltering] = useState(false);
  const search = useSettledSearch(typed);
  const choice = { subjectId, search, filters };
  const applied = appliedFilters(choice);
  const browse = useDiscoveryBrowse(browseQueryOf(choice));
  const pages = browse.data?.pages;
  const tabs = pages?.[0]?.tabs;
  const cards = useMemo(() => pages?.flatMap((page) => page.cards) ?? [], [pages]);
  const searching = search !== '';
  const view = discoveryView({
    loaded: browse.data !== undefined,
    allCount: tabs?.find((tab) => tab.subjectId === null)?.count,
    cardCount: cards.length,
    searching,
  });
  const retry = () => void browse.refetch();

  if (view === 'noTeachers') return <DiscoveryNoTeachers onRefresh={retry} />;

  const selected = tabs?.find((tab) => tab.subjectId !== null && tab.subjectId === subjectId);
  const subject =
    selected === undefined || selected.subjectId === null || searching
      ? null
      : { id: selected.subjectId, name: nameOf(selected) };

  function chooseTab(value: string): void {
    setSubjectId(value === ALL ? null : value);
    // A riwaya is offered within one subject (FR-334).
    setFilters((before) => withFilter(before, 'riwaya', undefined));
  }

  function more(): void {
    if (browse.hasNextPage && !browse.isFetchingNextPage && !browse.isFetchNextPageError) {
      void browse.fetchNextPage();
    }
  }

  const header = (
    <View style={{ gap: tokens.space['4'] }}>
      {browse.data === undefined ? null : <OfflineNotice onRetry={retry} />}
      <SearchRow
        value={typed}
        onChangeText={setTyped}
        placeholder={t('student.discovery.searchPlaceholder')}
        filters={{ count: filterCount(applied), onPress: () => setFiltering(true) }}
      />
      {searching || tabs === undefined ? null : (
        <CategoryTabs
          tabs={tabs.map((tab) =>
            tab.subjectId === null
              ? { value: ALL, label: t('student.discovery.all'), count: tab.count }
              : { value: tab.subjectId, label: nameOf(tab), count: tab.count },
          )}
          value={subjectId ?? ALL}
          onChange={chooseTab}
          accessibilityLabel={t('student.discovery.filter.a11y.section')}
        />
      )}
      <DiscoveryFiltered filters={applied} onChange={setFilters} />
    </View>
  );

  const empty =
    view === 'loading' ? (
      <NotLoaded failed={browse.isError} onRetry={retry} loading={<LoadingCards />} />
    ) : view === 'searchEmpty' ? (
      <DiscoverySearchEmpty query={search} onClear={() => setTyped('')} />
    ) : (
      <DiscoveryEmpty
        {...(filterCount(applied) === 0 ? {} : { onClearFilters: () => setFilters(NO_FILTERS) })}
      />
    );

  const footer = browse.isFetchingNextPage ? (
    <LoadingCards count={1} />
  ) : browse.isFetchNextPageError ? (
    <LoadError onRetry={() => void browse.fetchNextPage()} />
  ) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <AppHeader title={t('student.discovery.title')} />
      <FlatList<DiscoveryCard>
        data={view === 'cards' ? cards : []}
        keyExtractor={(card) => card.teacherId}
        renderItem={({ item }) => (
          <TeacherCard
            card={item}
            zone={me.data?.timezone}
            onPress={() => openTeacher(item.teacherId)}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
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
      {filtering ? (
        <DiscoveryFilter
          applied={applied}
          subject={subject}
          onApply={(chosen) => {
            setFilters(chosen);
            setFiltering(false);
          }}
          onClose={() => setFiltering(false)}
        />
      ) : null}
    </View>
  );
}
