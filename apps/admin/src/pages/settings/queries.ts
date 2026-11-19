// 005:T024 (B49; FR-624; R-410): the settings page's read and write over the client, through TanStack
// Query (research R-113). Each read is audited on the server (`settings.listed`), so the list is kept
// a little while. A change is keyed by the dialog that sends it; after one, the list is read again.
import type { AdminSettingsUpdateInput } from '@ijazah/contracts/admin';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type SettingRow = Awaited<ReturnType<Api['settings']['list']['query']>>['items'][number];

export const SETTINGS = ['settings'] as const;
/** How long a read stays fresh: going back to the page does not read it again at once. */
const FRESH_MS = 30_000;

export function useSettings() {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...SETTINGS, 'list'],
    queryFn: () => client.api.settings.list.query(),
    staleTime: FRESH_MS,
  });
}

/** Sends one change (`settings.update`), then reads the list again. */
export function useSettingChange() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  return async (input: AdminSettingsUpdateInput) => {
    const answer = await client.api.settings.update.mutate(input);
    void queries.invalidateQueries({ queryKey: SETTINGS });
    return answer;
  };
}
