// T037: the page each console route of this phase shows until its page task replaces it: the drawn
// title in its frame, nothing invented. The pages are B14's (T071 the applications, T072 the
// credentials, T073 the admins, the audit and the home); T070 replaced the sign-in pages' shell.
import { Page } from '../../design/components';
import { type MessageKey, useT } from '../../i18n';

export function ConsolePageShell({ title }: { readonly title: MessageKey }) {
  const t = useT();
  return (
    <Page title={t(title)}>
      <></>
    </Page>
  );
}
