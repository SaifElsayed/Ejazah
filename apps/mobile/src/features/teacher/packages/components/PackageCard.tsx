// T021 (FR-311, FR-312, FR-315): one package on the tab (screens.md §13). A package has no name: its
// subject, its count and length, and its track. Active and published, the card shows the price, the
// price per session and the ongoing enrollments as tiles; active while the teacher is not published
// (`PackagesLocked`), one line with the price and «غير منشورة» under the track (FR-315); paused, the
// same line and «تفعيل» in place of «إيقاف».
import type { PackageTrack, TeacherPackage } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { View } from 'react-native';

import { Badge, Button, Card, Stats, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useLocale, useT } from '../../../../i18n';
import { formatPoundAmount, formatPounds, useFormatters } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';

export const TRACK_LABEL: Readonly<Record<PackageTrack, MessageKey>> = {
  recitation: 'common.track.recitation',
  ijazah_track: 'common.track.ijazahTrack',
};

export function TrackBadge({ track }: { readonly track: PackageTrack }) {
  const t = useT();
  return (
    <Badge label={t(TRACK_LABEL[track])} tone={track === 'ijazah_track' ? 'accent' : 'neutral'} />
  );
}

export function PackageCard({
  item,
  published,
  onEdit,
  onToggle,
}: {
  readonly item: TeacherPackage;
  /** Whether students see the teacher's packages (the list's `published`). */
  readonly published: boolean;
  readonly onEdit: () => void;
  /** «إيقاف» on an active package, «تفعيل» on a paused one. */
  readonly onToggle: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const nameOf = useSubjectName();
  const price_piasters = piasters(item.price_piasters);
  const tiles = item.isActive && published;
  const line = tiles
    ? t('common.format.packageLine', {
        count: item.sessionCount,
        minutes: item.sessionDurationMinutes,
      })
    : t('common.format.packageLineWithPrice', {
        count: item.sessionCount,
        minutes: item.sessionDurationMinutes,
        amount: formatPoundAmount(price_piasters, locale),
      });
  return (
    <Card variant={item.isActive ? 'default' : 'surface'}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: tokens.space['2'],
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: tokens.space['1'] }}>
          <Text variant="headline">{nameOf(item.subject)}</Text>
          <Text variant="caption" tone="muted">
            {line}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: tokens.space['1'] }}>
          <TrackBadge track={item.track} />
          {item.isActive && !published ? (
            <Badge
              label={t('status.package.unpublished')}
              tone="neutral"
              icon={{ name: 'eye-off', size: 'xs' }}
            />
          ) : null}
        </View>
      </View>
      {tiles ? (
        <Stats
          tile
          items={[
            { label: t('teacher.packages.price'), value: formatPounds(price_piasters, locale) },
            {
              label: t('teacher.packages.perSession'),
              value: formatPounds(piasters(item.perSession_piasters), locale),
            },
            {
              label: t('teacher.packages.activeEnrollments'),
              value: format.number(item.activeEnrollmentCount),
            },
          ]}
        />
      ) : null}
      <View style={{ flexDirection: 'row', gap: tokens.space['2'] }}>
        <Button
          label={t('common.action.edit')}
          variant="secondary"
          size="md"
          layout="grow"
          icon={{ name: 'pencil' }}
          onPress={onEdit}
        />
        <Button
          label={t(item.isActive ? 'teacher.packages.deactivate' : 'teacher.packages.activate')}
          variant="secondary"
          size="md"
          layout="grow"
          onPress={onToggle}
        />
      </View>
    </Card>
  );
}
