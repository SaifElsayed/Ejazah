// T072: the credentials queue's reads and decisions over the client, through TanStack Query (research
// R-113), as the applications queue reads its own (B14b-1). Every read is an audited
// `credentials.read` (`home.read` for the count), so a page is kept a little while and a search is
// sent once the typing stops. A decision, or a refusal that says the credential moved, reads the
// queue, the panel and the count again.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type CredentialsTab = Parameters<Api['credentials']['list']['query']>[0]['tab'];
export type CredentialsPage = Awaited<ReturnType<Api['credentials']['list']['query']>>;
export type CredentialRow = CredentialsPage['rows'][number];
export type CredentialDetail = Awaited<ReturnType<Api['credentials']['get']['query']>>;
export type ApproveInput = Parameters<Api['credentials']['approve']['mutate']>[0];
export type RejectInput = Parameters<Api['credentials']['reject']['mutate']>[0];
export type RequestDocumentInput = Parameters<Api['credentials']['requestDocument']['mutate']>[0];
export type CorrectInput = Parameters<Api['credentials']['correct']['mutate']>[0];

const CREDENTIALS = ['credentials'] as const;
const HOME = ['home', 'summary'] as const;
/** How long a page read stays fresh: switching back to a tab does not read it again at once. */
const FRESH_MS = 30_000;

export function useCredentialsPage(tab: CredentialsTab, search: string, page: number) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...CREDENTIALS, 'list', tab, search, page],
    queryFn: () =>
      client.api.credentials.list.query({ tab, ...(search === '' ? {} : { search }), page }),
    staleTime: FRESH_MS,
    // The last page stays while the next page of the same tab and search loads; another tab, whose
    // columns differ (the verified one's day), starts empty (B14c).
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === tab && previousQuery.queryKey[3] === search
        ? previous
        : undefined,
  });
}

export function useCredential(credentialId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: [...CREDENTIALS, 'get', credentialId],
    queryFn: () => client.api.credentials.get.query({ credentialId }),
    staleTime: FRESH_MS,
  });
}

/** The queue's count, from the home's summary (one `home.read`, shared with the applications'). */
export function useCredentialCount() {
  const { client } = useAdmin();
  return useQuery({
    queryKey: HOME,
    queryFn: () => client.api.home.summary.query(),
    staleTime: FRESH_MS,
    select: (summary) => summary.queues.credentials.open,
  });
}

/** The four decisions; each, and `reread`, reads the queue, the panel and the count again. */
export function useCredentialActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  const reread = async () => {
    await Promise.all([
      queries.invalidateQueries({ queryKey: CREDENTIALS }),
      queries.invalidateQueries({ queryKey: HOME }),
    ]);
  };
  const api = client.api.credentials;
  return {
    reread,
    approve: useMutation({
      mutationFn: (input: ApproveInput) => api.approve.mutate(input),
      onSuccess: reread,
    }),
    reject: useMutation({
      mutationFn: (input: RejectInput) => api.reject.mutate(input),
      onSuccess: reread,
    }),
    requestDocument: useMutation({
      mutationFn: (input: RequestDocumentInput) => api.requestDocument.mutate(input),
      onSuccess: reread,
    }),
    correct: useMutation({
      mutationFn: (input: CorrectInput) => api.correct.mutate(input),
      onSuccess: reread,
    }),
  };
}
