// T158 (FR-PROFILE-1, FR-310): the public profile's writes. The display name goes through
// `account.updateProfile`, which takes any role, and reads `account.me` again, so the account tab
// shows the change.
//
// T023 (FR-310, R-GENDER-6): the profile as `teacher.profile.get` answers it; the bio and the
// qualification through `teacher.profile.update`, whose input names no gender; the photo through
// Phase 1's `POST /uploads/photos`, which writes it and answers the signed link. Each write reads
// the profile and the account again.
import type { TeacherProfileGetOutput, TeacherProfileUpdateInput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ME_QUERY_KEY } from '../../../lib/account';
import { useApi } from '../../../lib/api';
import type { LocalPhoto } from '../../../lib/client';

export const PROFILE_QUERY_KEY = ['teacher', 'profile'] as const;

export function useTeacherProfile() {
  const { client } = useApi();
  return useQuery<TeacherProfileGetOutput>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => client.api.teacher.profile.get.query(),
  });
}

export function useProfileActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(() => {
    const reread = () =>
      Promise.all([
        queries.invalidateQueries({ queryKey: PROFILE_QUERY_KEY }),
        queries.invalidateQueries({ queryKey: ME_QUERY_KEY }),
      ]);
    return {
      async rename(displayName: string): Promise<void> {
        await client.api.account.updateProfile.mutate({ displayName });
        await reread();
      },

      async describe(input: TeacherProfileUpdateInput): Promise<void> {
        await client.api.teacher.profile.update.mutate(input);
        await reread();
      },

      /** The signed link to the new photo. */
      async uploadPhoto(file: LocalPhoto): Promise<string> {
        const photoUrl = await client.uploadPhoto(file);
        await reread();
        return photoUrl;
      },
    };
  }, [client, queries]);
}
