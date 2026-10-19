// T037: the page each route of this phase shows until its page task replaces it: the drawn title in
// its frame, nothing invented. The pages are B14's (T070 the sign-in and second-factor pages and
// `/set-password`, T071 the applications, T072 the credentials, T073 the admins, the audit and the
// home).
import { AuthCard, Page } from '../../design/components';
import { type MessageKey, useT } from '../../i18n';

export function ConsolePageShell({ title }: { readonly title: MessageKey }) {
  const t = useT();
  return (
    <Page title={t(title)}>
      <></>
    </Page>
  );
}

export function AuthPageShell({ title }: { readonly title: MessageKey }) {
  const t = useT();
  return (
    <AuthCard title={t(title)}>
      <></>
    </AuthCard>
  );
}
