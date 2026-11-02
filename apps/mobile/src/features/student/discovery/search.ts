// T029 (FR-333): the search as typed, sent once the student pauses, so each letter typed is not a
// call under `rate_limit_search`. Clearing the field applies at once.
import { useEffect, useState } from 'react';

import { searchOf } from './state';

/** How long the typing pauses before the search is sent. */
const SETTLE_MS = 300;

/** `typed` once it has not changed for a moment; empty at once when cleared. */
export function useSettledSearch(typed: string): string {
  const [settled, setSettled] = useState(typed);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(typed), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  return searchOf(typed) === '' ? '' : settled;
}
