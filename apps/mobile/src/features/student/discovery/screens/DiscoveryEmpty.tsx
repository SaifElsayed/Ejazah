// T029 (FR-334): no teacher in the section with its filters (`DiscoveryEmpty`, screens.md §4), with
// «مسح الفلاتر» while a filter is in force. The applied chips stay above it, on the tab. A section
// with no filter in force says the section is empty, not that filters match nobody (B28's device run).
import { EmptyState } from '../../../../design/primitives';
import { useT } from '../../../../i18n';

export function DiscoveryEmpty({ onClearFilters }: { readonly onClearFilters?: () => void }) {
  const t = useT();
  return (
    <EmptyState
      icon={{ name: 'search' }}
      title={t(
        onClearFilters === undefined
          ? 'student.discovery.empty.sectionTitle'
          : 'student.discovery.empty.title',
      )}
      text={t(
        onClearFilters === undefined
          ? 'student.discovery.empty.sectionText'
          : 'student.discovery.empty.text',
      )}
      {...(onClearFilters === undefined
        ? {}
        : {
            action: { label: t('student.discovery.empty.clearFilters'), onPress: onClearFilters },
          })}
    />
  );
}
