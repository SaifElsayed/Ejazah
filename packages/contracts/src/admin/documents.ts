// T068: the administrator surface's `documents` and `users` namespaces (admin-surface.md "`documents`
// — the viewer and the verification requests"; FR-160, FR-166). A document is viewed through a
// signed link that expires (NFR-SEC-3), never modified or replaced; an identity request is opened on
// a person with a reason, then accepted or answered with a request for another document, whose note
// the person reads.
import { z } from 'zod';

import { adminReason } from './admins.js';

export const documentsLinkInput = z.object({ documentId: z.uuid() });

export const documentsLinkOutput = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
  pageCount: z.int().positive().optional(),
});

/** `targetUserId`: the person the request is for (a field named `userId` is refused in an input, R-GENDER-4). */
export const usersRequireIdentityInput = z.object({ targetUserId: z.uuid(), reason: adminReason });

export const documentsAcceptInput = z.object({
  requestId: z.uuid(),
  /** The reviewer's own note; it reaches the audit log. */
  note: adminReason.optional(),
});

export const documentsRequestAnotherInput = z.object({
  requestId: z.uuid(),
  /** What the person must send instead; it becomes the request's reason they read. */
  note: adminReason,
});
