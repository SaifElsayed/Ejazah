// T029 (FR-332 to FR-335): `discovery.browse` and `discovery.filters` (T024, T026) as the discovery
// tab calls them. One browse is one input without its cursor: its pages are an infinite query whose
// next page is asked with the cursor the last page answered, handed back unread (R-204). The tabs
// come on the first page only. A new input keeps the last answer on screen until its own arrives, so
// the tabs and the search field stay while a tab, a filter or a search loads.
import type {
  DiscoveryBrowseInput,
  DiscoveryBrowseOutput,
  DiscoveryCursor,
  DiscoveryFiltersOutput,
} from '@ijazah/contracts';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../lib/api';

/** What one browse asks: everything but the cursor, which the pages carry. */
export type BrowseQuery = Omit<DiscoveryBrowseInput, 'cursor'>;

/** The query key of one browse's pages. */
export function browseQueryKey(query: BrowseQuery) {
  return ['student', 'discovery', 'browse', query] as const;
}

/** The query key of a subject's riwaya filter. */
export function filtersQueryKey(subjectId: string) {
  return ['student', 'discovery', 'filters', subjectId] as const;
}

export function useDiscoveryBrowse(query: BrowseQuery) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: browseQueryKey(query),
    queryFn: ({ pageParam }): Promise<DiscoveryBrowseOutput> =>
      client.api.discovery.browse.query(
        pageParam === undefined ? query : { ...query, cursor: pageParam },
      ),
    initialPageParam: undefined as DiscoveryCursor | undefined,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });
}

/** The riwayas the filter offers for the subject; idle with no subject (FR-334). */
export function useDiscoveryFilters(subjectId: string | null) {
  const { client } = useApi();
  return useQuery<DiscoveryFiltersOutput>({
    queryKey: filtersQueryKey(subjectId ?? ''),
    queryFn: () => client.api.discovery.filters.query({ subjectId: subjectId ?? '' }),
    enabled: subjectId !== null,
  });
}
