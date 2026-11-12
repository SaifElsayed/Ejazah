// B42's integration (the review session's ruling on lane B's point c, recorded under T048): an
// outcome settled or corrected on one page is read again on the other. A resolution or a correction
// on `/review` marks `/sessions`' monitor stale, and an action on `/sessions` (its correction among
// them) marks `/review`'s records stale, so neither page shows the old outcome while its read is
// still fresh (each keeps a read 30 s). Display only: the server decides.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useRereadMonitor } from '../sessions/queries';
import { useRereadReview } from './queries';

const MONITORED = ['sessions', 'get', 'enrollment-1'] as const;
const TELEMETRY = ['review', 'get', 'session-1'] as const;

/** A cache holding one fresh monitor read and one fresh connection record. */
function seeded(): QueryClient {
  const queries = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  queries.setQueryData(MONITORED, { enrollment: 'before' });
  queries.setQueryData(TELEMETRY, { status: 'under_threshold' });
  return queries;
}

function wrapperOf(queries: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={queries}>{children}</QueryClientProvider>;
  };
}

describe('an outcome settled on one page is read again on the other', () => {
  it('a ruling or a correction on /review marks the monitor of /sessions stale', async () => {
    const queries = seeded();
    const { result } = renderHook(() => useRereadReview(), { wrapper: wrapperOf(queries) });
    await result.current();
    expect(queries.getQueryState(MONITORED)?.isInvalidated).toBe(true);
    expect(queries.getQueryState(TELEMETRY)?.isInvalidated).toBe(true);
  });

  it('a correction (or any action) on /sessions marks the records of /review stale', async () => {
    const queries = seeded();
    const { result } = renderHook(() => useRereadMonitor(), { wrapper: wrapperOf(queries) });
    await result.current();
    expect(queries.getQueryState(TELEMETRY)?.isInvalidated).toBe(true);
    expect(queries.getQueryState(MONITORED)?.isInvalidated).toBe(true);
  });
});
