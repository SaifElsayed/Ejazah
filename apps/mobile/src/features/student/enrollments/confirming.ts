// T050 (FR-383, FR-384, SC-312; research R-217): the Confirming state's bounded schedule and the
// read that follows it. While a screen shows an enrollment awaiting its payment's confirmation, it
// reads it again every `confirmingPollSeconds` of the public configuration for at most
// `confirmingPollWindowMinutes`, then stops and says what FR-384 says; a return to the foreground
// reads it again at any time (T015's focus manager). The phone keeps no instant of the release
// (Processing, T046, hands none over), so the window counts from the moment the screen first shows
// the enrollment Confirming; a confirmation ends it.
//
// Every decision is taken on an answer read since the screen opened (`useAnsweredSinceMount`, the
// owner's decision of 2026-11-04): before one, the screen draws its loading or, when the read
// failed, its retry state, never the cached answer; with no connection it draws the cached answer
// under the offline banner (the `MainOffline` pattern) and starts no schedule.
import type { QueryKey, UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useOnline } from '../../../lib/online';
import { useAnsweredSinceMount } from '../../shared/states/fresh';
import { SECOND_MS, usePublicConfig } from '../checkout/outcome-api';

const SECONDS_PER_MINUTE = 60;

export interface ConfirmingSchedule {
  /** The read's interval: a number while the window runs, else none. */
  readonly everyMs: number | false;
  /** The window ended with the enrollment still Confirming. */
  readonly over: boolean;
  /** The schedule's numbers could not be read. */
  readonly failed: boolean;
  /** The failed read's error while `failed`, else null (T065 of specs/004-sessions). */
  readonly error: unknown;
  readonly retry: () => void;
  /** Whether the screen's last answer holds an enrollment Confirming (`useScheduledRead`). */
  readonly setConfirming: (confirming: boolean) => void;
}

/**
 * FR-383's schedule for a screen that may show an enrollment Confirming. The screen's query takes
 * `everyMs` as its interval; `useScheduledRead` tells the schedule what the query answered.
 */
export function useConfirmingSchedule(): ConfirmingSchedule {
  const [confirming, setConfirming] = useState(false);
  const config = usePublicConfig();
  const failed = confirming && config.isError;
  const numbers = config.data?.checkout;
  const windowMs =
    numbers === undefined
      ? undefined
      : numbers.confirmingPollWindowMinutes * SECONDS_PER_MINUTE * SECOND_MS;
  const [over, setOver] = useState(false);
  useEffect(() => {
    setOver(false);
    if (!confirming || windowMs === undefined) return undefined;
    const timer = setTimeout(() => setOver(true), windowMs);
    return () => clearTimeout(timer);
  }, [confirming, windowMs]);
  return {
    everyMs:
      confirming && !over && numbers !== undefined
        ? numbers.confirmingPollSeconds * SECOND_MS
        : false,
    over: confirming && over,
    failed,
    error: failed ? config.error : null,
    retry: () => void config.refetch(),
    setConfirming,
  };
}

export interface ConfirmingRead<T> {
  /** The answer read since the screen opened; with no connection, the cached one. */
  readonly data: T | undefined;
  /** Whether `data` was read since the screen opened. */
  readonly answered: boolean;
  /** The last read, or the schedule's numbers, failed: the screen draws its retry state. */
  readonly failed: boolean;
  /** The failed read's error while `failed`, the screen's own read first, else null (T065). */
  readonly error: unknown;
  /** FR-384: the window ended with an enrollment still Confirming. */
  readonly over: boolean;
  /** When the answer drawn was stored (the `MainOffline` line). */
  readonly updatedAt: number;
  /** Reads again: the retry and «تحقق مرة أخرى». */
  readonly retry: () => void;
}

/**
 * A screen's `query` (under `queryKey`) read on `schedule`: what the screen draws, and whether an
 * answer read since it opened holds an enrollment Confirming (`confirmingIn`), which runs the
 * schedule.
 */
export function useScheduledRead<T>(
  schedule: ConfirmingSchedule,
  query: UseQueryResult<T>,
  queryKey: QueryKey,
  confirmingIn: (data: T) => boolean,
): ConfirmingRead<T> {
  const answered = useAnsweredSinceMount(query, queryKey);
  const online = useOnline();
  const confirming = answered && query.data !== undefined && confirmingIn(query.data);
  const { setConfirming } = schedule;
  useEffect(() => setConfirming(confirming), [setConfirming, confirming]);
  return {
    data: answered || !online ? query.data : undefined,
    answered,
    failed: query.isError || schedule.failed,
    error: query.isError ? query.error : schedule.error,
    over: schedule.over && confirming,
    updatedAt: query.dataUpdatedAt,
    retry: () => {
      if (schedule.failed) schedule.retry();
      void query.refetch();
    },
  };
}
