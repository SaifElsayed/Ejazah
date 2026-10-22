// T074 (FR-166): `account.identityVerification` as the screens call it (app-surface.md). The open
// request is one query; sending the document reads it again, so the screen turns to «وصلتنا
// الوثيقة» from the server's answer, never from a guess.
import type { IdentityDocumentType, IdentityVerificationGetOutput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';

export const IDENTITY_REQUEST_QUERY_KEY = ['account', 'identityVerification'] as const;

/** The account's open identity request, if any. */
export function useIdentityRequest() {
  const { client } = useApi();
  return useQuery<IdentityVerificationGetOutput>({
    queryKey: IDENTITY_REQUEST_QUERY_KEY,
    queryFn: () => client.api.account.identityVerification.get.query(),
  });
}

export function useIdentityActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(
    () => ({
      /** Sends the uploaded document to the open request, then reads the request again. */
      async submit(documentType: IdentityDocumentType, documentId: string): Promise<void> {
        await client.api.account.identityVerification.submit.mutate({ documentType, documentId });
        await queries.invalidateQueries({ queryKey: IDENTITY_REQUEST_QUERY_KEY });
      },
    }),
    [client, queries],
  );
}
