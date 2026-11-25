// T021 (FR-311, FR-312, FR-315): the `teacher.packages` procedures of T018 as the screens call them.
// The list is one query, read by the tab and the editor; a change sends its call and reads the list
// again. `create` is keyed: the editor holds one key for the package it drafts, so a retry after a
// lost answer is the same request (FR-106).
import type {
  PackagesCreateInput,
  PackagesListOutput,
  PackagesUpdateInput,
  PackageTrack,
  SessionLengthMinutes,
} from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';

export const PACKAGES_QUERY_KEY = ['teacher', 'packages'] as const;

/** 003:T104 (Q-A3 (a)): the platform's public configuration, read for the teacher's share rate. */
export const PUBLIC_CONFIG_QUERY_KEY = ['platform', 'publicConfig'] as const;

/**
 * 003:T104 (ADR 0025 D1, Q-A3 (a)): the teacher's share rate `platform.publicConfig` answers, so the
 * editor shows the share as the price is typed. Undefined until it is read, and while it cannot be:
 * the editor then draws no share rather than one at a rate of its own.
 */
export function useTeacherShareRate(): number | undefined {
  const { client } = useApi();
  return useQuery({
    queryKey: PUBLIC_CONFIG_QUERY_KEY,
    queryFn: () => client.publicConfig(),
    select: (config) => config.teacherSharePercent,
  }).data;
}

/**
 * 003:T113 (SRS DEC-88): the other teachers' average price per session on the editor's track and
 * length, in piasters. Undefined while unread, and when fewer than three teachers have one: the
 * editor then draws no average.
 */
export function useAveragePrice(
  track: PackageTrack,
  sessionDurationMinutes: SessionLengthMinutes,
): number | undefined {
  const { client } = useApi();
  return useQuery({
    queryKey: [...PACKAGES_QUERY_KEY, 'averagePrice', track, sessionDurationMinutes],
    queryFn: () =>
      client.api.teacher.packages.averagePrice.query({ track, sessionDurationMinutes }),
    select: (answer) => answer.averagePerSession_piasters,
  }).data;
}

export function usePackages() {
  const { client } = useApi();
  return useQuery<PackagesListOutput>({
    queryKey: PACKAGES_QUERY_KEY,
    queryFn: () => client.api.teacher.packages.list.query(),
  });
}

export function usePackageActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(() => {
    const refreshed = () => queries.invalidateQueries({ queryKey: PACKAGES_QUERY_KEY });
    return {
      refreshed,

      async create(input: PackagesCreateInput): Promise<void> {
        await client.api.teacher.packages.create.mutate(input);
        await refreshed();
      },

      async update(input: PackagesUpdateInput): Promise<void> {
        await client.api.teacher.packages.update.mutate(input);
        await refreshed();
      },
    };
  }, [client, queries]);
}

/**
 * B-P4 round 2 (Q-B1 (a); SRS §3.14, DEC-94): whether the programme's switch is on, as
 * `platform.publicConfig` answers it: a new ijazah-track package is then a programme package. False
 * until it is read, and while it cannot be: the editor then draws today's fields.
 */
export function useProgrammeEnabled(): boolean {
  const { client } = useApi();
  return (
    useQuery({
      queryKey: PUBLIC_CONFIG_QUERY_KEY,
      queryFn: () => client.publicConfig(),
      select: (config) => config.programmeEnabled,
    }).data === true
  );
}
