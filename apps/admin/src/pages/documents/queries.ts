// B14b-2 (FR-160, FR-166): a document's signed link and the identity request's three actions, over
// the client through TanStack Query (research R-113). A link is read once per opening of the viewer
// (`documents.link` is an audited view, `document.view`) and forgotten when it closes; it expires
// in minutes. An action reads every open query again but the link, which would be another view: it
// changes the account's standing, which any page may show.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAdmin } from '../../lib/admin-context';
import type { AdminClient } from '../../lib/client';

type Api = AdminClient['api'];
export type AcceptInput = Parameters<Api['documents']['accept']['mutate']>[0];
export type RequestAnotherInput = Parameters<Api['documents']['requestAnother']['mutate']>[0];
export type RequireIdentityInput = Parameters<Api['users']['requireIdentity']['mutate']>[0];

export function useDocumentLink(documentId: string) {
  const { client } = useAdmin();
  return useQuery({
    queryKey: ['documents', 'link', documentId],
    queryFn: () => client.api.documents.link.mutate({ documentId }),
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useIdentityActions() {
  const { client } = useAdmin();
  const queries = useQueryClient();
  const settle = () =>
    queries.invalidateQueries({ predicate: (cached) => cached.queryKey[0] !== 'documents' });
  return {
    accept: useMutation({
      mutationFn: (input: AcceptInput) => client.api.documents.accept.mutate(input),
      onSuccess: settle,
    }),
    requestAnother: useMutation({
      mutationFn: (input: RequestAnotherInput) => client.api.documents.requestAnother.mutate(input),
      onSuccess: settle,
    }),
    requireIdentity: useMutation({
      mutationFn: (input: RequireIdentityInput) => client.api.users.requireIdentity.mutate(input),
      onSuccess: settle,
    }),
  };
}
