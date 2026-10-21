// T056: the `teacher.application` namespace of the user surface (app-surface.md "`teacher.application`
// — applying"; FR-150, FR-152, FR-155).
//
// The application collects the subjects from the admin's list, a qualification sentence, one
// identity document and one ijazah PDF per chosen subject, each a document the applicant uploaded
// first (`POST /uploads/documents`) and names here by its id. No field of any schema here names a
// payout, bank, wallet or account (FR-VERIFY-11, FR-PAYG-12): payout is set up after approval, by
// its own namespace. `submit` is keyed (`idempotent-procedures.ts`), so it carries the kernel's
// idempotency key; `reapply` is the same application from `rejected`, which a retry cannot repeat
// (the state has moved), so it is not keyed.
import { z } from 'zod';

import { identityDocumentType } from './account.js';

/** How many subjects one application may choose (app-surface.md: 1 to 10). */
export const APPLICATION_SUBJECTS_MAX = 10;

/** The longest qualification sentence the form takes, in characters. */
export const QUALIFICATION_MAX_LENGTH = 500;

/** The kernel's idempotency key (16 to 128 of `A–Z a–z 0–9 _ -`, FR-106). */
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

const subjectIds = z.array(z.uuid()).min(1).max(APPLICATION_SUBJECTS_MAX);

const application = {
  subjectIds,
  qualificationSummary: z.string().trim().min(1).max(QUALIFICATION_MAX_LENGTH),
  identityDocument: z.object({ type: identityDocumentType, documentId: z.uuid() }),
  /** One ijazah PDF per chosen subject; the service refuses a chosen subject without one. */
  credentials: z
    .array(z.object({ subjectId: z.uuid(), documentId: z.uuid() }))
    .min(1)
    .max(APPLICATION_SUBJECTS_MAX),
};

export const applicationSubmitInput = z.object({ ...application, idempotencyKey });

export const applicationReapplyInput = z.object(application);

/** What `needs_document` asked for, replaced: the identity document, ijazah PDFs, or both. */
export const applicationResubmitInput = z
  .object({
    identityDocumentId: z.uuid().optional(),
    credentials: z
      .array(z.object({ credentialId: z.uuid(), documentId: z.uuid() }))
      .min(1)
      .max(APPLICATION_SUBJECTS_MAX)
      .optional(),
  })
  .refine((input) => input.identityDocumentId !== undefined || input.credentials !== undefined, {
    message: 'Name the identity document or a credential to replace.',
  });

export const applicationStatus = z.enum([
  'not_started',
  'in_review',
  'needs_document',
  'rejected',
  'approved',
]);

/**
 * `teacher.application.get`: the status screen in every drawn state. The reviewer's note and the
 * moment of the decision that wrote it are answered while the screen shows them (`needs_document`,
 * `rejected`); `decidedAt` also dates an approval.
 */
export const applicationGetOutput = z.object({
  status: applicationStatus,
  submittedAt: z.iso.datetime().optional(),
  subjectCount: z.int().min(1).max(APPLICATION_SUBJECTS_MAX).optional(),
  note: z.string().optional(),
  callRecorded: z.boolean(),
  decidedAt: z.iso.datetime().optional(),
  approvedShown: z.boolean(),
});

export type ApplicationSubmitInput = z.infer<typeof applicationSubmitInput>;
export type ApplicationReapplyInput = z.infer<typeof applicationReapplyInput>;
export type ApplicationResubmitInput = z.infer<typeof applicationResubmitInput>;
export type ApplicationStatus = z.infer<typeof applicationStatus>;
export type ApplicationGetOutput = z.infer<typeof applicationGetOutput>;
