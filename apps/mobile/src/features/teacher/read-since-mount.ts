// T051 (the owner's decision of 2026-11-04 for B31; T086's bug): what a screen decides on is only
// what it read since it opened. React Query sets `isFetchedAfterMount` after a failed read too, so
// it alone would let a screen whose read failed on opening decide on the answer an earlier visit
// cached. Here a failed read since opening is `failed`, whatever is cached; an answer read since
// opening is `read`; anything else is `waiting`, with what is cached for the offline pattern
// (002:T138), which draws the cached data under its banner while there is no connection.
import type { UseQueryResult } from '@tanstack/react-query';

export type ReadSinceMount<T> =
  | { readonly state: 'read'; readonly data: T }
  | { readonly state: 'failed' }
  | { readonly state: 'waiting'; readonly cached: T | undefined };

/** Where the read a screen made on opening stands. */
export function readSinceMount<T>(
  query: Pick<UseQueryResult<T>, 'data' | 'isError' | 'isFetchedAfterMount'>,
): ReadSinceMount<T> {
  if (!query.isFetchedAfterMount) return { state: 'waiting', cached: query.data };
  if (query.isError) return { state: 'failed' };
  if (query.data === undefined) return { state: 'waiting', cached: undefined };
  return { state: 'read', data: query.data };
}
