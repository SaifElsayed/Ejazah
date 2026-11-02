// T029 (FR-334): the filters open (`DiscoveryFilter`, screens.md §4): the minimum rating (all, then
// 5 down to 1 stars and up), the riwaya within the selected subject when its approved credentials
// name any (`discovery.filters`), and the track. A choice is a draft until «عرض النتائج» applies it;
// «مسح» applies none. The board's dropdown is the Sheet every modal flow uses (components.md).
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, Chip, Sheet, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';
import { useDiscoveryFilters } from '../api';
import { type DiscoveryFilters, NO_FILTERS, withFilter } from '../state';
import { TRACK_LABEL, TRACKS } from '../tracks';

const RATINGS = [5, 4, 3, 2, 1] as const;
/** The sheet's tallest, a fraction of the screen; its groups scroll past it. */
const TALLEST = 0.85;

/** One group of exclusive options, «الكل» first. */
function Group<Value>({
  title,
  options,
  value,
  onChange,
}: {
  readonly title: string;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly value: Value | undefined;
  readonly onChange: (value: Value | undefined) => void;
}) {
  const t = useT();
  return (
    <View style={{ gap: tokens.space['2'] }}>
      <Text variant="callout" weight="bold">
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['2'] }}>
        <Chip
          label={t('student.discovery.all')}
          selected={value === undefined}
          onPress={() => onChange(undefined)}
        />
        {options.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            selected={option.value === value}
            onPress={() => onChange(option.value)}
          />
        ))}
      </View>
    </View>
  );
}

export function DiscoveryFilter({
  applied,
  subject,
  onApply,
  onClose,
}: {
  readonly applied: DiscoveryFilters;
  /** The selected subject tab, whose riwayas the filter offers; null on the tab of all subjects. */
  readonly subject: { readonly id: string; readonly name: string } | null;
  readonly onApply: (filters: DiscoveryFilters) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<DiscoveryFilters>(applied);
  const riwayas = useDiscoveryFilters(subject?.id ?? null).data?.riwayas ?? [];
  const choose =
    <K extends keyof DiscoveryFilters>(key: K) =>
    (value: DiscoveryFilters[K] | undefined) =>
      setDraft((before) => withFilter(before, key, value));
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('student.discovery.filter.title')}
      snapPoints={[TALLEST]}
    >
      <ScrollView
        style={{ flexGrow: 0, flexShrink: 1 }}
        contentContainerStyle={{ gap: tokens.space['5'] }}
      >
        <Group
          title={t('student.discovery.filter.rating')}
          options={RATINGS.map((count) => ({
            value: count,
            label: t('student.discovery.filter.starsAndUp', { count }),
          }))}
          value={draft.minRating}
          onChange={choose('minRating')}
        />
        {subject === null || riwayas.length === 0 ? null : (
          <Group
            title={t('student.discovery.filter.riwaya', { subject: subject.name })}
            options={riwayas.map((riwaya) => ({ value: riwaya, label: riwaya }))}
            value={draft.riwaya}
            onChange={choose('riwaya')}
          />
        )}
        <Group
          title={t('student.discovery.filter.track')}
          options={TRACKS.map((track) => ({ value: track, label: t(TRACK_LABEL[track]) }))}
          value={draft.track}
          onChange={choose('track')}
        />
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: tokens.space['2'] }}>
        <Button
          label={t('student.discovery.filter.apply')}
          size="md"
          layout="grow"
          onPress={() => onApply(draft)}
        />
        <Button
          label={t('common.action.clear')}
          variant="ghost"
          size="md"
          onPress={() => onApply(NO_FILTERS)}
        />
      </View>
    </Sheet>
  );
}
