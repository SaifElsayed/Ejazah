// B42, T058 (FR-481, SRS FR-ADMIN-4): the user directory's reads over the client, through TanStack
// Query (research R-113), as the payments monitor reads (`pages/payments/queries.ts`). Each read is an
// audited `users.listed` or `user.viewed` on the server, so a page is kept a little while and the last
// page stays while the next of the same search loads. A student's standing action reads both again
// (`useRereadUsers`), so the page shows the account status the server now answers.
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Users = AdminClient['api']['users'];
export type UsersFilter = Omit<Parameters<Users['list']['query']>[0], 'cursor'>;
export type UsersPage = Awaited<ReturnType<Users['list']['query']>>;
export type UserRow = UsersPage['items'][number];
export type UserRecord = Awaited<ReturnType<Users['get']['query']>>;

const USERS = ['users'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function useUsersPage(filter: UsersFilter, cursor: string | undefined) {
  const { client } = useAdmin();
  const filters = JSON.stringify(filter);
  return useQuery({
    queryKey: [...USERS, 'list', filters, cursor ?? null],
    queryFn: () =>
      client.api.users.list.query({ ...filter, ...(cursor === undefined ? {} : { cursor }) }),
    staleTime: FRESH_MS,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === filters ? previous : undefined,
  });
}

export function useUserRecord(targetUserId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...USERS, 'get', targetUserId],
    queryFn: () => client.api.users.get.query({ targetUserId }),
    staleTime: FRESH_MS,
  });
}

/** Reads the directory again, the list and the record, after a standing action the server took. */
export function useRereadUsers(): () => Promise<void> {
  const queries = useQueryClient();
  return () => queries.invalidateQueries({ queryKey: USERS });
}
