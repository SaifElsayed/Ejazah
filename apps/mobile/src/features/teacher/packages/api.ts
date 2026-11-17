// T021 (FR-311, FR-312, FR-315): the `teacher.packages` procedures of T018 as the screens call them.
// The list is one query, read by the tab and the editor; a change sends its call and reads the list
// again. `create` is keyed: the editor holds one key for the package it drafts, so a retry after a
// lost answer is the same request (FR-106).
import type {
  PackagesCreateInput,
  PackagesListOutput,
  PackagesUpdateInput,
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
