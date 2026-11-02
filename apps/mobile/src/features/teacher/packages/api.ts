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
