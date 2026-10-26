// T084 (FR-AUTH-8, FR-PROFILE-1): the profile editor's two writes. The name goes through
// `account.updateProfile`; the photo through `POST /uploads/photos` (public-pages.md "The uploads
// route"), which writes it and answers the signed link. Each reads `account.me` again, so the
// account tab shows the change.
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ME_QUERY_KEY } from '../../../lib/account';
import { useApi } from '../../../lib/api';
import type { LocalPhoto } from '../../../lib/client';

export function useProfileActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(
    () => ({
      async rename(displayName: string): Promise<void> {
        await client.api.account.updateProfile.mutate({ displayName });
        await queries.invalidateQueries({ queryKey: ME_QUERY_KEY });
      },

      /** The signed link to the new photo. */
      async uploadPhoto(file: LocalPhoto): Promise<string> {
        const photoUrl = await client.uploadPhoto(file);
        await queries.invalidateQueries({ queryKey: ME_QUERY_KEY });
        return photoUrl;
      },
    }),
    [client, queries],
  );
}
