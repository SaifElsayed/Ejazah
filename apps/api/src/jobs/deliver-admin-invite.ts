// T066 (FR-174, research R-110): `deliver-admin-invite { adminId }`, queued by `admins.add`. The
// payload is the id alone (R-SEC-2): the admin module prepares the mail at send time, the link minted
// then, and this job hands it to the email port, so a handler of the administrator surface never
// awaits a provider (kernel.md).
//
// IDEMPOTENT (R-API-14). A mark named by the token's hash is read before the mail and placed once it
// is handed over, lapsing with the link, so a retry or a redelivery after a restart sends nothing
// more. A run that stops between the hand-over and the mark repeats the same mail with the same link
// (one invitation always yields one link), which is the one duplicate left, and a harmless one.
//
// What it is handed comes from `worker.ts`, as the re-encryption job's columns do, since a job may
// not import `modules/admin` (`boundaries/no-upward-admin-import`). An administrator who needs no
// link gets nothing; one not there yet (the job ran before `admins.add` committed) throws, and the
// queue's retries (T171) try again.
import { z } from 'zod';

import type { EmailPort } from '../platform/ports/email/email.port.js';
import type { SingleUseMarks } from '../platform/redis/single-use-marks.js';
import { defineJob, type Job } from './job.js';

/** The invite the admin module prepares: the address, the mail, and what names its delivery. */
export interface PreparedInvite {
  readonly to: string;
  readonly mail: { readonly subject: string; readonly text: string };
  /** A value without `:` naming this link's delivery (the SHA-256 of the token). */
  readonly mark: string;
  readonly expiresAt: Date;
}

export interface AdminInviteSource {
  /** The invite to send, null when none is needed; throws when the administrator is not there. */
  prepare(adminId: string): Promise<PreparedInvite | null>;
}

export interface DeliverAdminInviteOptions {
  readonly invites: AdminInviteSource;
  readonly email: Pick<EmailPort, 'deliver'>;
  readonly marks: Pick<SingleUseMarks, 'has' | 'place'>;
}

export const DELIVER_ADMIN_INVITE = 'deliver-admin-invite';

export function deliverAdminInvite({ invites, email, marks }: DeliverAdminInviteOptions): Job {
  return defineJob({
    name: DELIVER_ADMIN_INVITE,
    payload: z.object({ adminId: z.uuid() }),
    run: async ({ adminId }) => {
      const invite = await invites.prepare(adminId);
      if (invite === null) return;
      if (await marks.has('admin-invite', invite.mark)) return;
      await email.deliver({ to: invite.to, ...invite.mail });
      await marks.place('admin-invite', invite.mark, invite.expiresAt);
    },
  });
}
