// T066 (FR-174, research R-110): the `deliver-admin-invite` job. Its payload is the administrator's
// id alone; the admin module prepares the mail at send time (the link is minted then, so nothing
// secret waits in Redis), and the job hands it to the email port. A delivery repeated, as a retry or a
// redelivery after a restart is, sends nothing more: the invite's mark is placed once the mail is
// handed over and read before it (R-API-14). An administrator who no longer needs the link (the
// password set, the account disabled, the link's lifetime gone) gets nothing; one not yet visible,
// as when the job runs before the adding transaction commits, fails the delivery so the queue tries
// it again. The double-run assertion (T112's pattern) calls the handler directly.
import { describe, expect, it } from 'vitest';

import type { Mail } from '../platform/ports/email/email.port.js';
import { MemorySingleUseMarks } from '../platform/redis/single-use-marks.fixtures.js';
import { deliverAdminInvite, type PreparedInvite } from './deliver-admin-invite.js';
import { runOnceAndTwice } from './double-run.js';

const NOW = new Date('2026-10-20T08:00:00Z');
const ADMIN_ID = '0199f6a0-0000-7000-8000-000000000001';

const invite: PreparedInvite = {
  to: 'hala@example.com',
  mail: { subject: 'Invite', text: 'https://admin.ijazah.test/set-password#token=v1.x.y.z' },
  mark: 'f'.repeat(64),
  expiresAt: new Date('2026-10-22T08:00:00Z'),
};

function worldOf(prepared: PreparedInvite | null | 'missing') {
  const mails: Mail[] = [];
  return {
    mails,
    job: deliverAdminInvite({
      invites: {
        async prepare(adminId) {
          expect(adminId).toBe(ADMIN_ID);
          if (prepared === 'missing') throw new Error('no administrator yet');
          return prepared;
        },
      },
      email: { deliver: async (mail) => void mails.push(mail) },
      marks: new MemorySingleUseMarks(() => NOW),
    }),
  };
}

describe('deliver-admin-invite', () => {
  it('hands the prepared mail to the email port', async () => {
    const { job, mails } = worldOf(invite);
    await job.handle({ adminId: ADMIN_ID });
    expect(mails).toEqual([{ to: invite.to, ...invite.mail }]);
  });

  it('sends one mail however many times it runs (R-API-14)', async () => {
    const { once, twice } = await runOnceAndTwice({
      world: () => worldOf(invite),
      run: ({ job }) => job.handle({ adminId: ADMIN_ID }),
      observe: ({ mails }) => mails,
    });
    expect(once).toHaveLength(1);
    expect(twice).toEqual(once);
  });

  it('sends nothing when the administrator needs no link', async () => {
    const { job, mails } = worldOf(null);
    await job.handle({ adminId: ADMIN_ID });
    expect(mails).toEqual([]);
  });

  it('fails the delivery, for the queue to retry, while the administrator is not there to read', async () => {
    const { job, mails } = worldOf('missing');
    await expect(job.handle({ adminId: ADMIN_ID })).rejects.toThrow('no administrator yet');
    expect(mails).toEqual([]);
  });

  it('carries the id alone, and refuses anything that is not one', async () => {
    const { job } = worldOf(invite);
    expect(job.name).toBe('deliver-admin-invite');
    expect(job.schedule).toBeUndefined();
    await expect(job.handle({ adminId: 'hala@example.com' })).rejects.toThrow();
    await expect(job.handle({})).rejects.toThrow();
  });
});
