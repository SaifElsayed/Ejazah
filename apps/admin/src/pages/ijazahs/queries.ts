// 005:T022 (B49): the ijazahs page's reads and writes over the client, through TanStack Query
// (research R-113). Each read is audited on the server (`ijazahs.listed`, `ijazah.viewed` at every
// opening of the PDF's link, `ijazah_bars.listed`), so a page is kept a little while. Every write is
// keyed by the dialog that sends it; after one, the ijazahs and the ijazah requests are read again
// (a bar or a sign-off changes what both pages show).
import type { AdminIjazahStatus } from '@ijazah/contracts/admin';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type IjazahsPage = Awaited<ReturnType<Api['ijazahs']['list']['query']>>;
export type IjazahRow = IjazahsPage['items'][number];
export type IjazahDetail = Awaited<ReturnType<Api['ijazahs']['get']['query']>>;
export type BarredPage = Awaited<ReturnType<Api['ijazahs']['barred']['query']>>;
export type BarredRow = BarredPage['items'][number];

export const IJAZAHS = ['ijazahs'] as const;
/** The ijazah requests page's cache key, read again after a write here. */
export const IJAZAH_REQUESTS = ['ijazahRequests'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
export const FRESH_MS = 30_000;

export function useIjazahsPage(status: AdminIjazahStatus | undefined, cursor: string | undefined) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...IJAZAHS, 'list', status ?? null, cursor ?? null],
    queryFn: () =>
      client.api.ijazahs.list.query({
        ...(status === undefined ? {} : { status }),
        ...(cursor === undefined ? {} : { cursor }),
      }),
    staleTime: FRESH_MS,
  });
}

export function useIjazah(ijazahId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...IJAZAHS, 'get', ijazahId],
    queryFn: () => client.api.ijazahs.get.query({ ijazahId }),
    staleTime: FRESH_MS,
  });
}

export function useBarredPage(cursor: string | undefined) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...IJAZAHS, 'barred', cursor ?? null],
    queryFn: () => client.api.ijazahs.barred.query(cursor === undefined ? {} : { cursor }),
    staleTime: FRESH_MS,
  });
}

/** The ijazahs' writes, each with the dialog's key; the two pages read again after each. */
export function useIjazahActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  const reread = () => {
    void queries.invalidateQueries({ queryKey: IJAZAHS });
    void queries.invalidateQueries({ queryKey: IJAZAH_REQUESTS });
  };
  const then = async (write: Promise<unknown>) => {
    await write;
    reread();
  };
  const { ijazahs } = client.api;
  return {
    signOff: (ijazahId: string, idempotencyKey: string) =>
      then(ijazahs.signOff.mutate({ ijazahId, idempotencyKey })),
    rerender: (ijazahId: string, reason: string, idempotencyKey: string) =>
      then(ijazahs.rerender.mutate({ ijazahId, reason, idempotencyKey })),
    revoke: (ijazahId: string, reason: string, idempotencyKey: string) =>
      then(ijazahs.revoke.mutate({ ijazahId, reason, idempotencyKey })),
    bar: (targetUserId: string, reason: string, idempotencyKey: string) =>
      then(ijazahs.bar.mutate({ targetUserId, reason, idempotencyKey })),
    liftBar: (targetUserId: string, reason: string, idempotencyKey: string) =>
      then(ijazahs.liftBar.mutate({ targetUserId, reason, idempotencyKey })),
    /** Read both pages again (after an approval or a rejection on the requests page). */
    reread,
  };
}
