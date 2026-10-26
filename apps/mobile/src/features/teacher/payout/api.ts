// T078 (FR-190 to FR-194): the `teacher.payout` procedures of T077 as the screens call them. The
// state is one query, read by the payout route to pick its screen; `register` sends its call keyed
// (FR-106) and reads the state and `account.me` again, so the screens and the account's row follow
// the server. The support address is the public configuration's, read once per launch
// (lib/client.ts).
import type { PayoutDetailsInput, PayoutGetOutput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ME_QUERY_KEY } from '../../../lib/account';
import { useApi } from '../../../lib/api';

export const PAYOUT_QUERY_KEY = ['teacher', 'payout'] as const;

export function usePayout() {
  const { client } = useApi();
  return useQuery<PayoutGetOutput>({
    queryKey: PAYOUT_QUERY_KEY,
    queryFn: () => client.api.teacher.payout.get.query(),
  });
}

export function usePayoutActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(
    () => ({
      /** The first setup or a replacement, keyed so a retry after a lost answer is one. */
      async register(details: PayoutDetailsInput, idempotencyKey: string): Promise<void> {
        await client.api.teacher.payout.register.mutate({ details, idempotencyKey });
        await Promise.all([
          queries.invalidateQueries({ queryKey: PAYOUT_QUERY_KEY }),
          queries.invalidateQueries({ queryKey: ME_QUERY_KEY }),
        ]);
      },
    }),
    [client, queries],
  );
}

/** The support address `platform.publicConfig` serves; undefined until it is read. */
export function useSupportEmail(): string | undefined {
  const { client } = useApi();
  const config = useQuery({
    queryKey: ['platform', 'publicConfig'],
    queryFn: () => client.publicConfig(),
  });
  return config.data?.supportEmail;
}
