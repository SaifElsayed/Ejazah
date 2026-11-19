// 005:T023 (B49): the gender flags page's reads and writes over the client, through TanStack Query
// (research R-113). Each read is audited on the server (`gender_flags.listed`, `gender_flag.viewed`),
// so a page is kept a little while. Every write is keyed by the dialog that sends it; after one, the
// flags and the reports are read again (a flag raised from a report shows on both). A correction or
// a fraud ban ends enrollments and may ban an account, so after either every page is read again.
import type { GenderFlagStatus } from '@ijazah/contracts/admin';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type GenderFlagsPage = Awaited<ReturnType<Api['genderFlags']['list']['query']>>;
export type GenderFlagRow = GenderFlagsPage['items'][number];
export type GenderFlagDetail = Awaited<ReturnType<Api['genderFlags']['get']['query']>>;

export const GENDER_FLAGS = ['genderFlags'] as const;
/** The reports page's cache key, read again after a flag is raised. */
export const REPORTS = ['reports'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
export const FRESH_MS = 30_000;

export function useGenderFlagsPage(status: GenderFlagStatus, cursor: string | undefined) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...GENDER_FLAGS, 'list', status, cursor ?? null],
    queryFn: () =>
      client.api.genderFlags.list.query({
        status,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    staleTime: FRESH_MS,
  });
}

export function useGenderFlag(flagId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...GENDER_FLAGS, 'get', flagId],
    queryFn: () => client.api.genderFlags.get.query({ flagId }),
    staleTime: FRESH_MS,
  });
}

/** The flags' writes, each with the dialog's key. */
export function useGenderActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  const reread = async (write: Promise<unknown>) => {
    await write;
    void queries.invalidateQueries({ queryKey: GENDER_FLAGS });
    void queries.invalidateQueries({ queryKey: REPORTS });
  };
  const rereadAll = async (write: Promise<unknown>) => {
    await write;
    void queries.invalidateQueries();
  };
  const { genderFlags } = client.api;
  return {
    raise: (
      targetUserId: string,
      reason: string,
      reportId: string | undefined,
      idempotencyKey: string,
    ) =>
      reread(
        genderFlags.raise.mutate({
          targetUserId,
          reason,
          ...(reportId === undefined ? {} : { reportId }),
          idempotencyKey,
        }),
      ),
    dismiss: (flagId: string, reason: string, idempotencyKey: string) =>
      reread(genderFlags.dismiss.mutate({ flagId, reason, idempotencyKey })),
    correct: (flagId: string, reason: string, idempotencyKey: string) =>
      rereadAll(genderFlags.correct.mutate({ flagId, reason, idempotencyKey })),
    fraudBan: (
      flagId: string,
      reason: string,
      applicantNote: string | undefined,
      idempotencyKey: string,
    ) =>
      rereadAll(
        genderFlags.fraudBan.mutate({
          flagId,
          reason,
          ...(applicantNote === undefined ? {} : { applicantNote }),
          idempotencyKey,
        }),
      ),
  };
}
