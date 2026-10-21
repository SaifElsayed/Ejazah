// T066 (research R-110: the identity module renders the mails): the administrator's invite. An
// administrator has no language column, so the mail is written in both languages, Arabic first and
// English under it, as the code mails are. Plain text: the name is shown as typed and the link is
// the only other value, so there is nothing to escape.
import type { RenderedMail } from './code-mail.js';

/** The invite carrying the password-set `link`, valid `hours`, for `displayName`. */
export function renderAdminInviteMail({
  displayName,
  link,
  hours,
}: {
  readonly displayName: string;
  readonly link: string;
  readonly hours: number;
}): RenderedMail {
  return {
    subject: 'دعوة إلى لوحة إدارة إجازة / Ijazah admin panel invitation',
    text: [
      `مرحبًا ${displayName}،`,
      'أُضيف حسابك إلى لوحة إدارة إجازة. اختر كلمة المرور من هذا الرابط:',
      link,
      `الرابط صالح لمدة ${hours} ساعة ولمرة واحدة. بعد كلمة المرور ستُعِدّ التحقق بخطوتين عند أول دخول.`,
      'إذا لم تتوقع هذه الرسالة فتجاهلها.',
      '',
      `Hello ${displayName},`,
      'An account was added for you on the Ijazah admin panel. Choose your password at this link:',
      link,
      `The link is valid for ${hours} hours and works once. After the password you will set up two-step verification at your first sign-in.`,
      'If you did not expect this email, ignore it.',
    ].join('\n'),
  };
}
