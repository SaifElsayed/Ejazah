// T043 of specs/004-sessions: a remedy sheet's failure, in the words `useSend` chose.
import { Banner } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import type { ErrorMessage } from '../../../../lib/error-message';

export function Failure({ failure }: { readonly failure: ErrorMessage | null }) {
  const t = useT();
  if (failure === null) return null;
  return (
    <Banner icon={{ name: 'alert-circle' }} tone="danger">
      {t(failure.key, failure.values)}
    </Banner>
  );
}
