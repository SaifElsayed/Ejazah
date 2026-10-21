// T057: the `teacher.credentials` namespace of the user surface (app-surface.md
// "`teacher.credentials` — after approval"; FR-153, FR-PROFILE-11, FR-ISNAD-5).
//
// A credential is one ijazah PDF for one subject. The chain and the transcription (holder, riwaya,
// tariq) are an administrator's, written at approval, so they are answered on an approved credential
// only and read-only. The PDF's name is not stored (it may carry the person's name): the phone shows
// it as the subject's ijazah, and the size is answered when the upload recorded it (owner's decision
// at the conflict check of B11, 2026-10-21).
import { z } from 'zod';

import { subjectSummary } from './catalog.js';

export const credentialStatus = z.enum(['pending', 'needs_document', 'approved', 'rejected']);

/** One generation of the chain, origin first, holding one or more names (ADR 0004 D3). */
export const chainGeneration = z.object({
  position: z.int().min(1),
  names: z.array(z.string().min(1)).min(1),
});

export const credentialSummary = z.object({
  credentialId: z.uuid(),
  subject: subjectSummary,
  status: credentialStatus,
  submittedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().optional(),
  riwaya: z.string().optional(),
  tariq: z.string().optional(),
  holderName: z.string().optional(),
  chain: z.array(chainGeneration).optional(),
  /** The reviewer's reason, while the credential waits on a document or after a rejection. */
  note: z.string().optional(),
  document: z.object({ sizeBytes: z.int().positive().optional() }),
});

/** `teacher.credentials.list`'s answer. */
export const credentialsListOutput = z.array(credentialSummary);

export const credentialsAddInput = z.object({ subjectId: z.uuid(), documentId: z.uuid() });

export const credentialsAddOutput = z.object({ credentialId: z.uuid() });

export const credentialsReplaceDocumentInput = z.object({
  credentialId: z.uuid(),
  documentId: z.uuid(),
});

export const credentialsDocumentLinkInput = z.object({ credentialId: z.uuid() });

/** A signed link to the teacher's own PDF that stops reading at `expiresAt` (NFR-SEC-3). */
export const credentialsDocumentLinkOutput = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});

export type CredentialStatus = z.infer<typeof credentialStatus>;
export type CredentialSummary = z.infer<typeof credentialSummary>;
export type CredentialsAddInput = z.infer<typeof credentialsAddInput>;
export type CredentialsReplaceDocumentInput = z.infer<typeof credentialsReplaceDocumentInput>;
