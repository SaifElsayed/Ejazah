// T045 (FR-358, R-217): the seconds left until an instant the server gave, read every second from
// the phone's own clock by `secondsUntil` (`@ijazah/time/calendar`, R-TIME-1), so the countdown
// keeps running with no connection and is right again the moment the app comes back to the front.
import { secondsUntil } from '@ijazah/time/calendar';
import { useEffect, useState } from 'react';

const TICK_MS = 1_000;

/** The whole seconds until `instant`, zero once it has come; the timer stops at zero. */
export function useSecondsLeft(instant: string): number {
  const [left, setLeft] = useState(() => secondsUntil(instant, new Date()));
  useEffect(() => {
    const read = () => secondsUntil(instant, new Date());
    const first = read();
    setLeft(first);
    if (first === 0) return undefined;
    const timer = setInterval(() => {
      const next = read();
      setLeft(next);
      if (next === 0) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [instant]);
  return left;
}
