// T018 of specs/004-sessions (FR-431, FR-434; US1 acceptance 1): where the phone's clock stands
// against a session's join period, from `sessions.get`'s `join` (`opensAt`, the instant
// `JOIN_NOT_OPEN` carries, to `closesAt`). The server decides at `sessions.join`; the screen only
// says so, and draws itself again at each boundary, read through `secondsUntil` (R-TIME-1).
import { secondsUntil } from '@ijazah/time/calendar';
import { useEffect, useState } from 'react';

export type JoinWindow = 'before' | 'open' | 'closed';

export interface JoinPeriod {
  readonly opensAt: string;
  readonly closesAt: string;
}

const SECOND_MS = 1_000;
/** The longest single wait for a boundary: setTimeout overflows past 24.8 days. */
const LONGEST_WAIT_MS = 60_000;

/** The join period's state at `now`. */
export function joinWindowAt(join: JoinPeriod, now: Date): JoinWindow {
  if (secondsUntil(join.opensAt, now) > 0) return 'before';
  return secondsUntil(join.closesAt, now) > 0 ? 'open' : 'closed';
}

/** The join period's state now, drawn again when the phone's clock reaches each boundary. */
export function useJoinWindow(join: JoinPeriod): JoinWindow {
  const { opensAt, closesAt } = join;
  const [state, setState] = useState(() => joinWindowAt({ opensAt, closesAt }, new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const follow = () => {
      const now = new Date();
      const next = joinWindowAt({ opensAt, closesAt }, now);
      setState(next);
      if (next === 'closed') return;
      const boundary = next === 'before' ? opensAt : closesAt;
      const wait = Math.min(secondsUntil(boundary, now) * SECOND_MS, LONGEST_WAIT_MS);
      timer = setTimeout(follow, wait);
    };
    follow();
    return () => clearTimeout(timer);
  }, [opensAt, closesAt]);
  return state;
}
