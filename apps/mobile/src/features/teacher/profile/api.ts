// T158 (FR-PROFILE-1, FR-310): the public profile's writes. The display name goes through
// `account.updateProfile`, which takes any role, and reads `account.me` again, so the account tab
// shows the change.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ME_QUERY_KEY } from '../../../lib/account';
import { useApi } from '../../../lib/api';

export function useProfileActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(
    () => ({
      async rename(displayName: string): Promise<void> {
        await client.api.account.updateProfile.mutate({ displayName });
        await queries.invalidateQueries({ queryKey: ME_QUERY_KEY });
      },
    }),
    [client, queries],
  );
}
