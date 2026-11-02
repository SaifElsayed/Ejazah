// T029 (FR-333): a search that found nobody (`DiscoverySearchEmpty`, screens.md §4): the line that
// says so for the search in every section, and «مسح البحث».
import { View } from 'react-native';

import { EmptyState, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';

export function DiscoverySearchEmpty({
  query,
  onClear,
}: {
  readonly query: string;
  readonly onClear: () => void;
}) {
  const t = useT();
  return (
    <View style={{ gap: tokens.space['2'] }}>
      <Text variant="caption" tone="muted">
        {t('student.discovery.search.resultCount', { count: 0, query })}
      </Text>
      <EmptyState
        icon={{ name: 'search' }}
        title={t('student.discovery.search.empty.title')}
        text={t('student.discovery.search.empty.text')}
        action={{ label: t('student.discovery.search.empty.clear'), onPress: onClear }}
      />
    </View>
  );
}
