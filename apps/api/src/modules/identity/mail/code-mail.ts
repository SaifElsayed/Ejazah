// T047 (research R-110: the identity module renders its mails): the one-time code mails. The person
// asking for a sign-up code or a password reset has no account whose language could be read, and
// the request carries the address alone, so each mail is written in both languages, Arabic first
// and English under it (owner's decision 2026-10-20, from the sample shown in the conversation).
// Plain text: a code and a number are the only values, so there is nothing to escape.
export type CodeMailPurpose = 'signup' | 'password_reset';

export interface RenderedMail {
  readonly subject: string;
  readonly text: string;
}

const COPY: Readonly<Record<CodeMailPurpose, { readonly ar: string; readonly en: string }>> = {
  signup: { ar: 'رمز التحقق', en: 'verification code' },
  password_reset: { ar: 'رمز إعادة تعيين كلمة المرور', en: 'password reset code' },
};

/** The mail carrying `code`, valid `minutes`, for `purpose`. */
export function renderCodeMail(
  purpose: CodeMailPurpose,
  code: string,
  minutes: number,
): RenderedMail {
  const copy = COPY[purpose];
  return {
    subject: `${copy.ar} من إجازة / Ijazah ${copy.en}`,
    text: [
      `${copy.ar}: ${code}`,
      `صالح لمدة ${minutes} دقائق.`,
      'إذا لم تطلب هذا الرمز فتجاهل هذه الرسالة.',
      '',
      `Your ${copy.en}: ${code}`,
      `It is valid for ${minutes} minutes.`,
      'If you did not request it, ignore this email.',
    ].join('\n'),
  };
}
