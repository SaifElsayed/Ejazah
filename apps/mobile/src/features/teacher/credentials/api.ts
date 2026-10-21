// T059 (FR-153, FR-ISNAD-5): the `teacher.credentials` procedures of T057 as the screens call them.
// The list is one query, read by the credentials page, the account tab's badge and the
// application's request for a document; a change sends its call and reads the list again.
import type { CredentialSummary } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';

export const CREDENTIALS_QUERY_KEY = ['teacher', 'credentials'] as const;

export function useCredentials() {
  const { client } = useApi();
  return useQuery<CredentialSummary[]>({
    queryKey: CREDENTIALS_QUERY_KEY,
    queryFn: () => client.api.teacher.credentials.list.query(),
  });
}

export function useCredentialActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(() => {
    const refreshed = () => queries.invalidateQueries({ queryKey: CREDENTIALS_QUERY_KEY });
    return {
      async add(subjectId: string, documentId: string): Promise<void> {
        await client.api.teacher.credentials.add.mutate({ subjectId, documentId });
        await refreshed();
      },

      async replaceDocument(credentialId: string, documentId: string): Promise<void> {
        await client.api.teacher.credentials.replaceDocument.mutate({ credentialId, documentId });
        await refreshed();
      },

      /** A signed link to the teacher's own PDF, minted on demand (NFR-SEC-3). */
      documentLink(credentialId: string): Promise<{ url: string }> {
        return client.api.teacher.credentials.documentLink.query({ credentialId });
      },
    };
  }, [client, queries]);
}
