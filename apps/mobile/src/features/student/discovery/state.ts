// T029 (FR-332 to FR-334): what the discovery tab asks and which of its states it draws, from what
// the student chose: a subject tab, a search, the filters. A search spans every subject, so it sends
// no subject; the riwaya filter belongs to the subject whose riwayas it offered, so it applies only
// within that subject and outside a search (screens.md §4, `DiscoveryFilter`, `DiscoverySearch`).
import { DISCOVERY_QUERY_MAX_LENGTH, type PackageTrack } from '@ijazah/contracts';

import type { BrowseQuery } from './api';

/** The filters of FR-334, each absent for «الكل». */
export interface DiscoveryFilters {
  readonly track?: PackageTrack;
  /** At least this many whole stars, 1 to 5. */
  readonly minRating?: number;
  readonly riwaya?: string;
}

export const NO_FILTERS: DiscoveryFilters = {};

/** `filters` with one filter set, or removed when `value` is absent («الكل», a chip's ×). */
export function withFilter<K extends keyof DiscoveryFilters>(
  filters: DiscoveryFilters,
  key: K,
  value: DiscoveryFilters[K] | undefined,
): DiscoveryFilters {
  const rest: { -readonly [Key in keyof DiscoveryFilters]?: DiscoveryFilters[Key] } = {
    ...filters,
  };
  delete rest[key];
  return value === undefined ? rest : { ...rest, [key]: value };
}

/** What the student chose on the tab. */
export interface DiscoveryChoice {
  /** The subject tab; null for the tab of all subjects. */
  readonly subjectId: string | null;
  /** The search as typed, once it settled; empty when not searching. */
  readonly search: string;
  readonly filters: DiscoveryFilters;
}

/** The search sent, trimmed and within the contract's bound; empty when not searching. */
export function searchOf(typed: string): string {
  return typed.trim().slice(0, DISCOVERY_QUERY_MAX_LENGTH).trim();
}

/** The filters in force: the riwaya only within a subject and outside a search. */
export function appliedFilters({ subjectId, search, filters }: DiscoveryChoice): DiscoveryFilters {
  const { riwaya, ...rest } = filters;
  return riwaya !== undefined && subjectId !== null && searchOf(search) === ''
    ? { ...rest, riwaya }
    : rest;
}

/** How many filters are in force: the filter trigger's count and the chips. */
export function filterCount(filters: DiscoveryFilters): number {
  return [filters.track, filters.minRating, filters.riwaya].filter((one) => one !== undefined)
    .length;
}

/** `discovery.browse`'s input for the choice, without the cursor. */
export function browseQueryOf(choice: DiscoveryChoice): BrowseQuery {
  const query = searchOf(choice.search);
  const { track, minRating, riwaya } = appliedFilters(choice);
  return {
    ...(query === '' ? (choice.subjectId === null ? {} : { subjectId: choice.subjectId }) : {}),
    ...(query === '' ? {} : { query }),
    ...(track === undefined ? {} : { track }),
    ...(minRating === undefined ? {} : { minRating }),
    ...(riwaya === undefined ? {} : { riwaya }),
  };
}

/**
 * The state the tab draws: not read yet; no teacher at all for the student (`DiscoveryNoTeachers`,
 * the tab of all subjects counting none, whatever the filters); the cards; a search with none
 * (`DiscoverySearchEmpty`); else none for the section and its filters (`DiscoveryEmpty`).
 */
export type DiscoveryView = 'loading' | 'noTeachers' | 'cards' | 'searchEmpty' | 'filteredEmpty';

export function discoveryView({
  loaded,
  allCount,
  cardCount,
  searching,
}: {
  readonly loaded: boolean;
  /** The count of the tab of all subjects; undefined until a first page said it. */
  readonly allCount: number | undefined;
  readonly cardCount: number;
  readonly searching: boolean;
}): DiscoveryView {
  if (!loaded) return 'loading';
  if (allCount === 0) return 'noTeachers';
  if (cardCount > 0) return 'cards';
  return searching ? 'searchEmpty' : 'filteredEmpty';
}
