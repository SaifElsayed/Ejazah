// T009 of specs/005-certification: the parties' certificates, `certificates.list` and
// `certificates.link` (FR-607, FR-609; research R-412; contracts/app-surface.md, `certificates.*`;
// D1 (a), DEC-72; R-HONEST-6).
//
// Both are for the two parties of an ijazah only, the student and the granting teacher; anyone else
// is answered as an id that never existed (R-GENDER-2's one shape). The list answers the caller's
// ijazahs: one not yet signed off is being prepared (`ready` false), a revoked one is marked
// `revoked` and is never `ready`, so no client offers its link (R-HONEST-6). The link is a signed
// link that expires (`document_link_ttl_seconds`), never a storage key (R-SEC-3); it is refused
// `not_ready` until the sign-off and `revoked` after a revocation, with no link. Additive only once
// merged (R-API-9).
import { z } from 'zod';

import { subjectSummary } from './catalog.js';

/** `certificates.link`'s refusals, CONFLICT with this code (D1 (a), DEC-72). */
export const certificateLinkRefusal = z.enum(['not_ready', 'revoked']);

/** One ijazah as a party reads it. */
export const certificateItem = z
  .object({
    ijazahId: z.uuid(),
    subject: subjectSummary,
    /** The teacher's name as the certificate prints it (ADR 0019 D1). */
    teacherName: z.string(),
    /** When it was issued (`granted_at`). */
    issuedAt: z.iso.datetime(),
    revoked: z.boolean(),
    /** Signed off by an administrator and not revoked: its link can be asked for. */
    ready: z.boolean(),
  })
  .refine((item) => !(item.revoked && item.ready), {
    message: 'A revoked ijazah is never ready (R-HONEST-6).',
    path: ['ready'],
  });

export const certificatesListOutput = z.object({ items: z.array(certificateItem) });

export const certificatesLinkInput = z.object({ ijazahId: z.uuid() });

/** A signed link to the certificate's PDF, living `document_link_ttl_seconds`. */
export const certificatesLinkOutput = z.object({ link: z.url() });

export type CertificateLinkRefusal = z.infer<typeof certificateLinkRefusal>;
export type CertificateItem = z.infer<typeof certificateItem>;
export type CertificatesListOutput = z.infer<typeof certificatesListOutput>;
export type CertificatesLinkInput = z.infer<typeof certificatesLinkInput>;
export type CertificatesLinkOutput = z.infer<typeof certificatesLinkOutput>;
