// 006:T021 (FR-727; admin-surface.md `programmes.*`): `/programmes`' reads and writes over the
// client, through TanStack Query (research R-113). Each read is audited on the server
// (`programmes.listed`, `programmes.viewed`), so a page is kept a little while. Every write is keyed
// by the dialog that sends it; after a decision or a reopen, every `programmes` query is read again,
// and the payments monitor too (a `charge_unknown` approval expires the month's order). An open
// item's extension says its hours from the settings page's own read (`settings.list`, audited
// `settings.listed`), only while an extensible item is open.
import type {
  ProgrammesDecision,
  ProgrammesQueueFilter,
  ProgrammesReopenOutput,
} from '@ijazah/contracts/admin';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';
import { SETTINGS } from '../settings/queries';
import type { ExtendSetting } from './words';

type Api = AdminClient['api'];
export type ProgrammesPage = Awaited<ReturnType<Api['programmes']['queue']['query']>>;
export type ProgrammeQueueRow = ProgrammesPage['items'][number];
export type ProgrammeDetail = Awaited<ReturnType<Api['programmes']['get']['query']>>;
export type ProgrammeRequest = ProgrammeDetail['requests'][number];

export const PROGRAMMES = ['programmes'] as const;
/** The payments monitor's cache key, read again after a decision. */
const PAYMENTS = ['payments'] as const;
/** How long a read stays fresh: going back to a page does not read it again at once. */
const FRESH_MS = 30_000;

export function useProgrammesPage(filter: ProgrammesQueueFilter, cursor: string | undefined) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...PROGRAMMES, 'queue', filter, cursor ?? null],
    queryFn: () =>
      client.api.programmes.queue.query({
        filter,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    staleTime: FRESH_MS,
  });
}

export function useProgramme(enrollmentId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...PROGRAMMES, 'get', enrollmentId],
    queryFn: () => client.api.programmes.get.query({ enrollmentId }),
    staleTime: FRESH_MS,
  });
}

/** The decision on an item and the reopen of a stopped programme, each with the dialog's key. */
export function useProgrammeActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  const reread = async <T>(write: Promise<T>): Promise<T> => {
    const answer = await write;
    void queries.invalidateQueries({ queryKey: PROGRAMMES });
    void queries.invalidateQueries({ queryKey: PAYMENTS });
    return answer;
  };
  const { programmes } = client.api;
  return {
    decide: (input: {
      readonly requestId: string;
      readonly decision: ProgrammesDecision;
      readonly reason: string | undefined;
      readonly note: string | undefined;
      readonly idempotencyKey: string;
    }) =>
      reread(
        programmes.decide.mutate({
          requestId: input.requestId,
          decision: input.decision,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.note === undefined ? {} : { note: input.note }),
          idempotencyKey: input.idempotencyKey,
        }),
      ),
    reopen: (enrollmentId: string, reason: string, idempotencyKey: string) =>
      reread<ProgrammesReopenOutput>(
        programmes.reopen.mutate({ enrollmentId, reason, idempotencyKey }),
      ),
  };
}

/**
 * The hours each extension gives, from the settings' current values; a setting not read (yet, or
 * at all) is absent, and the page names the setting instead of a number.
 */
export function useExtendHours(enabled: boolean): Partial<Record<ExtendSetting, number>> {
  const { client } = useAdmin();
  const read = useQuery({
    queryKey: [...SETTINGS, 'list'],
    queryFn: () => client.api.settings.list.query(),
    staleTime: FRESH_MS,
    enabled,
  });
  const hours: Partial<Record<ExtendSetting, number>> = {};
  for (const setting of read.data?.items ?? []) {
    if (
      (setting.key === 'programme_offer_hours' || setting.key === 'programme_pay_rest_hours') &&
      typeof setting.value === 'number'
    ) {
      hours[setting.key] = setting.value;
    }
  }
  return hours;
}
