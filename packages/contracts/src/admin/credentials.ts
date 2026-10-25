// T069: the administrator surface's `credentials` namespace (admin-surface.md "`credentials` — the
// credential review"; FR-163, FR-164). One ijazah PDF per subject, reviewed beside the transcription
// form: the holder's name as on the PDF, the riwaya, the tariq where there is one, and the chain
// origin first as generations of one or more names, with no limit on the generations (ADR 0017 D1,
// ADR 0019 D1). The chain is the administrator's alone; a correction needs a reason and its audit
// entry holds the transcription before and after (FR-ISNAD-4). The list's search is the teacher's
// name as typed (screens.md `AdminCredentials`: «اسم المعلم»).
import { z } from 'zod';

import { subjectSummary } from '../catalog.js';
import { chainGeneration, credentialStatus } from '../teacher-credentials.js';
import { adminPage, adminReason, adminSearch } from './admins.js';

/** A transcribed field, Arabic as typed. */
const transcribed = z.string().trim().min(1).max(200);

/** One generation as the form sends it: its names, in the chain's order (origin first). */
export const chainGenerationInput = z.object({ names: z.array(transcribed).min(1) });

/** The chain as the form sends it, origin first; the holder is not a generation of it. */
export const chainInput = z.array(chainGenerationInput).min(1);

/** Whether the credential came with the application or was added after approval (FR-PROFILE-11). */
export const credentialOrigin = z.enum(['application', 'added']);

export const adminCredentialsTab = credentialStatus;

const teacherRef = z.object({ userId: z.uuid(), displayName: z.string() });

export const adminCredentialsListInput = z.object({
  tab: adminCredentialsTab,
  search: adminSearch.optional(),
  page: adminPage,
});

export const adminCredentialsListRow = z.object({
  credentialId: z.uuid(),
  teacher: teacherRef,
  subject: subjectSummary,
  origin: credentialOrigin,
  submittedAt: z.iso.datetime(),
  status: credentialStatus,
  /** When it was decided: the decided tabs' «وُثّقت» column (B14c, owner's decision). */
  reviewedAt: z.iso.datetime().optional(),
});

export const adminCredentialsListOutput = z.object({
  rows: z.array(adminCredentialsListRow),
  total: z.int().min(0),
  /** `admin_list_page_size`, so the panel's pager counts the pages (B14c, owner's decision). */
  pageSize: z.int().min(1),
});

export const adminCredentialsGetInput = z.object({ credentialId: z.uuid() });

export const adminCredentialsGetOutput = adminCredentialsListRow.extend({
  documentId: z.uuid(),
  holderName: z.string().optional(),
  riwaya: z.string().optional(),
  tariq: z.string().optional(),
  chain: z.array(chainGeneration).optional(),
  reviewReason: z.string().optional(),
  reviewedByName: z.string().optional(),
});

export const adminCredentialsApproveInput = z.object({
  credentialId: z.uuid(),
  holderName: transcribed,
  riwaya: transcribed,
  tariq: transcribed.optional(),
  chain: chainInput,
  /** The reviewer's own note; it reaches the audit log, not the teacher. */
  note: adminReason.optional(),
});

export const adminCredentialsRejectInput = z.object({
  credentialId: z.uuid(),
  reason: adminReason,
});

export const adminCredentialsRequestDocumentInput = z.object({
  credentialId: z.uuid(),
  reason: adminReason,
});

export const adminCredentialsCorrectInput = z
  .object({
    credentialId: z.uuid(),
    holderName: transcribed.optional(),
    riwaya: transcribed.optional(),
    tariq: transcribed.optional(),
    chain: chainInput.optional(),
    reason: adminReason,
  })
  .refine(
    ({ holderName, riwaya, tariq, chain }) =>
      [holderName, riwaya, tariq, chain].some((field) => field !== undefined),
    { message: 'A correction changes at least one field.', path: ['chain'] },
  );

/**
 * A credential's transcription as an audit entry holds it: the approval's after, a correction's
 * before and after (FR-164). A chain's generations carry their positions, origin first.
 */
export const adminCredentialTranscription = z.object({
  holderName: z.string(),
  riwaya: z.string(),
  tariq: z.string().nullable(),
  chain: z.array(chainGeneration),
});

export const adminCredentialCorrection = z.object({
  before: adminCredentialTranscription,
  after: adminCredentialTranscription,
});
