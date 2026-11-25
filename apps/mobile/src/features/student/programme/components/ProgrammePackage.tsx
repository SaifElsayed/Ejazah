// 006:T019 (FR-701, FR-704; DEC-93): a programme package on the teacher's profile, beside today's
// packages (`ProfilePackage`): the subject with the track's badge, the per-session range (the lowest
// to the highest of its three prices) and the assessment's fee, the server's amounts drawn in
// pounds. Chosen and pressed as today's packages are.
import type { DiscoveryProgrammePackage } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { View } from 'react-native';

import { Badge, Card, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { formatPounds } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';

export function ProgrammePackage({
  item,
  selected,
  onPress,
}: {
  readonly item: DiscoveryProgrammePackage;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const nameOf = useSubjectName();
  const pounds = (amount: number) => formatPounds(piasters(amount), locale);
  return (
    <Card variant={selected ? 'selected' : 'compact'} onPress={onPress}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: tokens.space['2'],
        }}
      >
        <Text variant="body" weight="bold">
          {nameOf(item.subject)}
        </Text>
        <Badge label={t('common.track.ijazahTrack')} tone="accent" />
      </View>
      <Text variant="body" weight="bold">
        {t('programme.student.profile.range', {
          lowest: pounds(item.priceRange.lowest_piasters),
          highest: pounds(item.priceRange.highest_piasters),
        })}
      </Text>
      <Text variant="caption" tone="muted">
        {t('programme.student.profile.fee', { fee: pounds(item.assessmentPrice_piasters) })}
      </Text>
    </Card>
  );
}
