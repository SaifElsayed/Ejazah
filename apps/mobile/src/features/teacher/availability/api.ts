// T022 (FR-313, FR-317, FR-318): the `teacher.slots` procedures of T019 as the screens call them.
// The slots are one query; `create` sends its call keyed (FR-106) and every save reads the slots
// again, so the week follows the server, whose `state` (free, booked, disabled) is derived there.
import type { SlotsCreateInput, SlotsListOutput, SlotsUpdateInput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';

export const SLOTS_QUERY_KEY = ['teacher', 'slots'] as const;

export function useSlots() {
  const { client } = useApi();
  return useQuery<SlotsListOutput>({
    queryKey: SLOTS_QUERY_KEY,
    queryFn: () => client.api.teacher.slots.list.query(),
  });
}

export function useSlotActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(
    () => ({
      /** A new slot, keyed so a retry after a lost answer is one slot. */
      async create(input: SlotsCreateInput): Promise<void> {
        await client.api.teacher.slots.create.mutate(input);
        await queries.invalidateQueries({ queryKey: SLOTS_QUERY_KEY });
      },
      /** A new day, start or length, or the slot disabled or enabled again. */
      async update(input: SlotsUpdateInput): Promise<void> {
        await client.api.teacher.slots.update.mutate(input);
        await queries.invalidateQueries({ queryKey: SLOTS_QUERY_KEY });
      },
    }),
    [client, queries],
  );
}
