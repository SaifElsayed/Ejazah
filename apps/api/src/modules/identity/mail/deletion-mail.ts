// T082 (FR-141, FR-143, ADR 0015 D2 and D3; the note under T082): the mail confirming a deletion,
// sent to the address the account had, after the deletion's commit. Written in both languages,
// Arabic first and English under it, as the one-time code mails are (owner's decision 2026-10-20):
// the person's language went with the account. Plain text with no value at all, so nothing is
// escaped; it says only what this phase does, that the personal data is deleted and the account
// cannot be restored, and nothing of sessions, payments or certificates (decision 4, R-HONEST).
import type { RenderedMail } from './code-mail.js';

/** The confirmation of a deletion. */
export function renderDeletionMail(): RenderedMail {
  return {
    subject: 'تم حذف حسابك في إجازة / Your Ijazah account has been deleted',
    text: [
      'تم حذف حسابك في إجازة.',
      'حُذفت بياناتك الشخصية، ولا يمكن استعادة الحساب.',
      '',
      'Your Ijazah account has been deleted.',
      'Your personal data has been deleted, and the account cannot be restored.',
    ].join('\n'),
  };
}
