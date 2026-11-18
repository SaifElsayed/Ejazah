// T011 of specs/005-certification: `reports.create`, a signed-in user's report of another user
// (FR-611, FR-613; research R-408; contracts/app-surface.md, `reports.create`; the note under T011).
//
// The caller names the person reported, where the report comes from and why: a session they are a
// party of (`sessionId`), a chat of theirs (`enrollmentId`), or a profile they can see (neither). Who
// reports is the session's account, never the input's (R-GENDER-4); the enrollment a session report
// is stored with is the server's read, never the client's. The reason is free text (Q-R8 (a); T021
// composes a category into it). The answer says only that the report was received (spec.md:305):
// nothing of the report, its id or its outcome. Keyed by the kernel's idempotency
// (`idempotent-procedures.ts`). Additive only once merged (R-API-9).
import { z } from 'zod';

import { idempotencyKey } from './idempotency-key.js';
import { PARTICIPANT_REASON_MAX_LENGTH } from './sessions.js';

/** Where a report comes from (`user_report_context`, ERD §10). */
export const reportContext = z.enum(['session', 'chat', 'profile']);

/** `reports.create`'s refusals, CONFLICT with this code (FR-611). */
export const reportCreateRefusal = z.enum(['self', 'open_exists']);

/** What each context names: a session its session, a chat its enrollment, a profile neither. */
function namesItsContext(input: {
  readonly context: z.infer<typeof reportContext>;
  readonly sessionId?: string | undefined;
  readonly enrollmentId?: string | undefined;
}): boolean {
  const session = input.sessionId !== undefined;
  const enrollment = input.enrollmentId !== undefined;
  switch (input.context) {
    case 'session':
      return session && !enrollment;
    case 'chat':
      return enrollment && !session;
    case 'profile':
      return !session && !enrollment;
  }
}

export const reportsCreateInput = z
  .object({
    reportedUserId: z.uuid(),
    context: reportContext,
    sessionId: z.uuid().optional(),
    enrollmentId: z.uuid().optional(),
    reason: z.string().trim().min(1).max(PARTICIPANT_REASON_MAX_LENGTH),
    idempotencyKey,
  })
  .refine(namesItsContext, {
    message: 'A session report names its session, a chat report its enrollment, a profile neither.',
    path: ['context'],
  });

/** Received, and nothing else (spec.md:305). */
export const reportsCreateOutput = z.object({ received: z.literal(true) });

export type ReportContext = z.infer<typeof reportContext>;
export type ReportCreateRefusal = z.infer<typeof reportCreateRefusal>;
export type ReportsCreateInput = z.infer<typeof reportsCreateInput>;
export type ReportsCreateOutput = z.infer<typeof reportsCreateOutput>;
