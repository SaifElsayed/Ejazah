// T051 (FR-391): the name as typed, sent once the teacher pauses, so each letter typed is not a
// call; clearing the field applies at once. Trimmed, as the contract reads it; empty is no search.
// The same pause as the student's discovery search (T029), which the teacher's tree cannot import.
import { useEffect, useState } from 'react';

/** How long the typing pauses before the search is sent. */
const SETTLE_MS = 300;

/** `typed` trimmed once it has not changed for a moment; empty at once when cleared. */
export function useSettledSearch(typed: string): string {
  const [settled, setSettled] = useState(typed.trim());
  useEffect(() => {
    const timer = setTimeout(() => setSettled(typed.trim()), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  return typed.trim() === '' ? '' : settled;
}
