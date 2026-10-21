// T058 (FR-150, FR-152, FR-155): the `teacher.application` procedures of T056 as the screens call
// them. The status is one query; each change sends its call, forgets the draft it came from, and
// reads the status and `account.me` again, so the guard and the status screen follow the server.
import type { ApplicationGetOutput, ApplicationResubmitInput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ME_QUERY_KEY } from '../../../lib/account';
import { useApi } from '../../../lib/api';
import { type ApplicationDraft, clearApplication } from './draft';

export const APPLICATION_QUERY_KEY = ['teacher', 'application'] as const;

export function useApplicationStatus(enabled = true) {
  const { client } = useApi();
  return useQuery<ApplicationGetOutput>({
    queryKey: APPLICATION_QUERY_KEY,
    queryFn: () => client.api.teacher.application.get.query(),
    enabled,
  });
}

/** The application of a complete draft, as `submit` and `reapply` take it. */
export function applicationOf(draft: ApplicationDraft) {
  const identity = draft.identity;
  if (identity === undefined) throw new Error('applicationOf: the draft has no identity document');
  return {
    subjectIds: [...draft.subjectIds],
    qualificationSummary: draft.qualification.trim(),
    identityDocument: { type: draft.identityType, documentId: identity.documentId },
    credentials: draft.subjectIds.map((subjectId) => {
      const ijazah = draft.ijazahs[subjectId];
      if (ijazah === undefined) throw new Error('applicationOf: a subject has no ijazah');
      return { subjectId, documentId: ijazah.documentId };
    }),
  };
}

export function useApplicationActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(() => {
    async function refreshed(): Promise<void> {
      await Promise.all([
        queries.invalidateQueries({ queryKey: APPLICATION_QUERY_KEY }),
        queries.invalidateQueries({ queryKey: ME_QUERY_KEY }),
      ]);
    }
    return {
      /** Sends the draft: the first application, or a new one after a rejection. */
      async send(draft: ApplicationDraft): Promise<void> {
        const application = applicationOf(draft);
        if (draft.mode === 'reapply') {
          await client.api.teacher.application.reapply.mutate(application);
        } else {
          await client.api.teacher.application.submit.mutate({
            ...application,
            idempotencyKey: draft.idempotencyKey,
          });
        }
        clearApplication();
        await refreshed();
      },

      async resubmit(input: ApplicationResubmitInput): Promise<void> {
        await client.api.teacher.application.resubmit.mutate(input);
        await refreshed();
      },

      /** The once-only approved screen was shown (FR-152). */
      async markApprovedShown(): Promise<void> {
        await client.api.teacher.application.markApprovedShown.mutate();
        await refreshed();
      },
    };
  }, [client, queries]);
}
