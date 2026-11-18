// 005:T019 (FR-601; contracts/app-surface.md, `teacher.signature.get` and `POST /uploads/signature`):
// the teacher's current signature as a signed link with when it was uploaded, or the null pair while
// none is held; an upload replaces it and reads it again.
import type { TeacherSignatureGetOutput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useApi } from '../../../lib/api';
import type { LocalPhoto } from '../../../lib/client';

export const SIGNATURE_QUERY_KEY = ['teacher', 'signature'] as const;

export function useTeacherSignature() {
  const { client } = useApi();
  return useQuery<TeacherSignatureGetOutput>({
    queryKey: SIGNATURE_QUERY_KEY,
    queryFn: () => client.api.teacher.signature.get.query(),
    refetchOnMount: 'always',
  });
}

export function useSignatureActions() {
  const { client } = useApi();
  const queries = useQueryClient();
  return useMemo(
    () => ({
      /** Uploads `file` as the signature, then reads the signature again. */
      async upload(file: LocalPhoto): Promise<void> {
        await client.uploadSignature(file);
        await queries.invalidateQueries({ queryKey: SIGNATURE_QUERY_KEY });
      },
    }),
    [client, queries],
  );
}
