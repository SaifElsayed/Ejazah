// T021 (FR-311, FR-312, FR-315): one package on the tab (screens.md §13). A package has no name: its
// subject, its count and length, and its track. Active and published, the card shows the price, the
// price per session and the ongoing enrollments as tiles; active while the teacher is not published
// (`PackagesLocked`), one line with the price and «غير منشورة» under the track (FR-315); paused, the
// same line and «تفعيل» in place of «إيقاف».
// 006:T020 (FR-704; ADR 0024, R-503; B-P4's conflict check): a programme package has no count, length
// or total until an offer (R-506): its card says its session price goes by length and shows its three
// prices, for 30, 45 and 60 minutes, as tiles in every state, with its ongoing enrollments beside
// them while it is active and published; the teacher sees no share per order (owner, 2026-11-17).
import type { PackageTrack, TeacherPackage } from '@ijazah/contracts';
import { SESSION_LENGTHS_MINUTES } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { View } from 'react-native';

import { Badge, Button, Card, Stats, type StatsProps, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useLocale, useT } from '../../../../i18n';
import { formatPoundAmount, formatPounds, useFormatters } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';
import { UnpublishedBadge } from './Unpublished';

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
  const tiles = item.isActive && published;
  const enrollments = {
    label: t('teacher.packages.activeEnrollments'),
    value: format.number(item.activeEnrollmentCount),
  };
  let line: string;
  let stats: StatsProps['items'] | null;
  if (item.isProgramme === true) {
    const prices = {
      30: item.prices.m30_piasters,
      45: item.prices.m45_piasters,
      60: item.prices.m60_piasters,
    } as const;
    line = t('programme.teacher.package.line');
    stats = [
      ...SESSION_LENGTHS_MINUTES.map((minutes) => ({
        label: t('common.format.duration', { minutes }),
        value: formatPounds(piasters(prices[minutes]), locale),
      })),
      ...(tiles ? [enrollments] : []),
    ];
  } else {
    const price_piasters = piasters(item.price_piasters);
    line = tiles
      ? t('common.format.packageLine', {
          count: item.sessionCount,
          minutes: item.sessionDurationMinutes,
        })
      : t('common.format.packageLineWithPrice', {
          count: item.sessionCount,
          minutes: item.sessionDurationMinutes,
          amount: formatPoundAmount(price_piasters, locale),
        });
    stats = tiles
      ? [
          { label: t('teacher.packages.price'), value: formatPounds(price_piasters, locale) },
          {
            label: t('teacher.packages.perSession'),
            value: formatPounds(piasters(item.perSession_piasters), locale),
          },
          enrollments,
        ]
      : null;
  }
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
            <UnpublishedBadge label={t('status.package.unpublished')} />
          ) : null}
        </View>
      </View>
      {stats === null ? null : <Stats tile items={stats} />}
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
