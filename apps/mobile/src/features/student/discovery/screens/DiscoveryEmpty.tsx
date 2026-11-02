// T029 (FR-334): no teacher in the section with its filters (`DiscoveryEmpty`, screens.md §4), with
// «مسح الفلاتر» while a filter is in force. The applied chips stay above it, on the tab.
import { EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';

export function DiscoveryEmpty({ onClearFilters }: { readonly onClearFilters?: () => void }) {
  const t = useT();
  return (
    <EmptyState
      icon={{ name: 'search' }}
      title={t('student.discovery.empty.title')}
      text={t('student.discovery.empty.text')}
      {...(onClearFilters === undefined
        ? {}
        : {
            action: { label: t('student.discovery.empty.clearFilters'), onPress: onClearFilters },
          })}
    />
  );
}
