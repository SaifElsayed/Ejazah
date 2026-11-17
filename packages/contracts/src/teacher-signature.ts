// T003 of specs/005-certification: the teacher's signature (FR-601, SRS FR-IJAZAH-12; research
// R-411; contracts/app-surface.md, `teacher.signature.get` and `POST /uploads/signature`).
//
// One current signature per approved teacher, a PNG or JPEG decided by its content (R-SEC-4). It is
// reached only through a signed link that expires (R-SEC-3): no answer carries its storage key.
// Additive only once merged (R-API-9).
import { z } from 'zod';

/** `POST /uploads/signature`'s 201 answer: when the signature now held was uploaded. */
export const signatureUploadOutput = z.object({ uploadedAt: z.iso.datetime() });

/**
 * `teacher.signature.get`'s answer: a signed link to the current signature living
 * `document_link_ttl_seconds`, and when it was uploaded; both null while none is held.
 */
export const teacherSignatureGetOutput = z.object({
  link: z.url().nullable(),
  uploadedAt: z.iso.datetime().nullable(),
});

export type SignatureUploadOutput = z.infer<typeof signatureUploadOutput>;
export type TeacherSignatureGetOutput = z.infer<typeof teacherSignatureGetOutput>;
