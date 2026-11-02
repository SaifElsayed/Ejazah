// T029 (FR-334): the filters applied (`DiscoveryFiltered`, screens.md §4): one chip for each filter
// in force, each removing its own filter, and «مسح الكل» removing them all.
import { FilterChips } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { type DiscoveryFilters, NO_FILTERS, withFilter } from '../state';
import { TRACK_LABEL } from '../tracks';

export function DiscoveryFiltered({
  filters,
  onChange,
}: {
  /** The filters in force, one chip each. */
  readonly filters: DiscoveryFilters;
  readonly onChange: (filters: DiscoveryFilters) => void;
}) {
  const t = useT();
  const { minRating, riwaya, track } = filters;
  const chips = [
    ...(minRating === undefined
      ? []
      : [
          {
            key: 'rating',
            content: t('student.discovery.filter.starsAndUp', { count: minRating }),
            onRemove: () => onChange(withFilter(filters, 'minRating', undefined)),
          },
        ]),
    ...(riwaya === undefined
      ? []
      : [
          {
            key: 'riwaya',
            content: riwaya,
            onRemove: () => onChange(withFilter(filters, 'riwaya', undefined)),
          },
        ]),
    ...(track === undefined
      ? []
      : [
          {
            key: 'track',
            content: t(TRACK_LABEL[track]),
            onRemove: () => onChange(withFilter(filters, 'track', undefined)),
          },
        ]),
  ];
  return <FilterChips chips={chips} onClearAll={() => onChange(NO_FILTERS)} />;
}
