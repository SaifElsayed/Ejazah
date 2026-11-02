// T021 (FR-311): the packages tab with no package yet (screens.md §13, PackagesEmpty): the empty
// state with no button of its own, the header's «باقة جديدة» being the one primary action.
import { EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';
import { PackagesFrame } from '../components/PackagesFrame';

export function PackagesEmptyState() {
  const t = useT();
  return (
    <EmptyState
      icon={{ name: 'layers' }}
      title={t('teacher.packages.empty.title')}
      text={t('teacher.packages.empty.text')}
    />
  );
}

export function PackagesEmpty({ onRetry }: { readonly onRetry?: () => void }) {
  return (
    <PackagesFrame published {...(onRetry === undefined ? {} : { onRetry })}>
      <PackagesEmptyState />
    </PackagesFrame>
  );
}
