// T020 of specs/005-certification (FR-607; R-HONEST-6; contracts/app-surface.md, `certificates.*`):
// what the student's certificates read. `certificates.list` answers the student's ijazahs, each
// ready (signed off), being prepared, or revoked; a ready one opens through `certificates.link`, a
// signed link that expires, in the browser (`expo-web-browser`, as a chat document opens). A link
// refused `revoked` or `not_ready` says so in its own words and reads the list again; the server
// decides, this asks.
import type { CertificateItem, CertificatesListOutput } from '@ijazah/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';

import { useApi } from '../../../lib/api';
import { errorCodeOf, errorDetailsOf } from '../../../lib/client';
import { type ErrorMessage, genericErrorKey } from '../../../lib/error-message';

export const CERTIFICATES_QUERY_KEY = ['student', 'certificates', 'list'] as const;

/** The list read again where an enrollment shows its ijazah, so its live event reaches it. */
export const certificatesOfEnrollmentQueryKey = (enrollmentId: string) =>
  [...CERTIFICATES_QUERY_KEY, enrollmentId] as const;

/** What a certificate shows: its link, being prepared, or revoked (never opened). */
export type CertificateState = 'ready' | 'preparing' | 'revoked';

export function certificateStateOf(
  item: Pick<CertificateItem, 'revoked' | 'ready'>,
): CertificateState {
  if (item.revoked) return 'revoked';
  return item.ready ? 'ready' : 'preparing';
}

/** `certificates.list`, under `queryKey`; idle until `enabled`. */
export function useCertificates(
  queryKey: readonly unknown[] = CERTIFICATES_QUERY_KEY,
  enabled = true,
) {
  const { client } = useApi();
  return useQuery<CertificatesListOutput>({
    queryKey,
    queryFn: () => client.api.certificates.list.query(),
    enabled,
  });
}

/** A refused link's words: `revoked` and `not_ready` their own, every other failure T065's. */
export function certificateLinkRefusal(error: unknown): ErrorMessage {
  if (errorCodeOf(error) === 'CONFLICT') {
    const code = errorDetailsOf(error)[0]?.code;
    if (code === 'revoked') return { key: 'student.certificate.revoked.title' };
    if (code === 'not_ready') return { key: 'student.credentials.refused.notReady' };
  }
  return genericErrorKey(error, 'common.state.actionError');
}

export interface OpenCertificate {
  readonly busy: boolean;
  readonly failure: ErrorMessage | null;
  open(ijazahId: string): Promise<void>;
}

/** Opens a ready certificate through its signed link; a refusal reads the certificates again. */
export function useOpenCertificate(): OpenCertificate {
  const { client } = useApi();
  const queries = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorMessage | null>(null);
  return {
    busy,
    failure,
    async open(ijazahId) {
      setBusy(true);
      setFailure(null);
      try {
        const { link } = await client.api.certificates.link.query({ ijazahId });
        await openBrowserAsync(link);
      } catch (caught: unknown) {
        setFailure(certificateLinkRefusal(caught));
        if (errorCodeOf(caught) === 'CONFLICT') {
          await queries.invalidateQueries({ queryKey: CERTIFICATES_QUERY_KEY });
        }
      } finally {
        setBusy(false);
      }
    },
  };
}
