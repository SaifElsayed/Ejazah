// T050 (FR-383; the owner's decision of 2026-11-04, the lesson of T086): whether a screen's read
// has answered since the screen opened. React Query's `isFetchedAfterMount` turns true after a
// failed read too, so a screen that decides on it decides on the cached answer; this counts the
// answers the cache stored instead (`dataUpdateCount`), which only a read that succeeded raises.
// A screen draws its data once this is true, and its retry state when the read failed before it.
import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/** True once the query under `queryKey` has stored an answer since the calling screen mounted. */
export function useAnsweredSinceMount(
  result: { readonly dataUpdatedAt: number },
  queryKey: QueryKey,
): boolean {
  const queries = useQueryClient();
  const answers = () => queries.getQueryState(queryKey)?.dataUpdateCount ?? 0;
  const [atMount] = useState(answers);
  // `dataUpdatedAt` is read so that an answer equal to the cached one still draws the screen
  // again (the result's tracked properties).
  return result.dataUpdatedAt > 0 && answers() > atMount;
}
