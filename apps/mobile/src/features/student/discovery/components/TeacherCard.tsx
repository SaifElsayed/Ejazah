// T029 (FR-333, FR-335): one result card (`.teacher-card` on screens.md §4's boards): the name, its
// matched prefix marked while searching; the subjects; the track badges; the bio's first line, cut to
// two lines on the phone (the note under T029); the rating and its count, or «لا تقييمات بعد»; the
// first session the student would get on the nearest free slot, in the student's own zone; the
// lowest price per session. No photo and no avatar in its place (the owner's decision of 2026-11-02):
// the card never reads `photoUrl`, and the profile shows the photo (FR-336).
import type { DiscoveryCard } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { View } from 'react-native';

import { Badge, Card, Icon, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { formatPounds, useFormatters } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';
import { TRACK_LABEL } from '../tracks';

/** The name, its first `marked` characters in the primary colour (FR-333). */
function MarkedName({
  name,
  marked,
}: {
  readonly name: string;
  readonly marked: number | undefined;
}) {
  if (marked === undefined) return <Text variant="headline">{name}</Text>;
  return (
    <Text variant="headline">
      <Text variant="headline" tone="primary">
        {name.slice(0, marked)}
      </Text>
      {name.slice(marked)}
    </Text>
  );
}

export function TeacherCard({
  card,
  zone,
  onPress,
}: {
  readonly card: DiscoveryCard;
  /** The student's own zone, the nearest slot's; none while the account is not read. */
  readonly zone: string | undefined;
  readonly onPress: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const nameOf = useSubjectName();
  const slot = card.nearestSlot;
  return (
    <Card onPress={onPress}>
      <View style={{ gap: tokens.space['1'] }}>
        <MarkedName name={card.displayName} marked={card.match?.length} />
        <Text variant="caption" tone="muted">
          {card.subjects.map(nameOf).join(t('student.discovery.card.subjectsSeparator'))}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['1'] }}>
          {card.tracks.map((track) => (
            <Badge
              key={track}
              label={t(TRACK_LABEL[track])}
              tone={track === 'ijazah_track' ? 'accent' : 'neutral'}
            />
          ))}
        </View>
      </View>
      <Text tone="muted" numberOfLines={2}>
        {t('student.discovery.card.bio', { bio: card.bioExcerpt })}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: tokens.space['3'],
          rowGap: tokens.space['1'],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: tokens.space['1'] }}>
          {card.rating === undefined ? null : <Icon name="star" size="xs" fill="filled" />}
          <Text variant="caption">
            {card.rating === undefined
              ? t('student.teacherProfile.noReviews')
              : t('student.discovery.card.ratingCount', {
                  rating: card.rating,
                  count: card.reviewCount,
                })}
          </Text>
        </View>
        {slot === undefined || zone === undefined ? null : (
          <Text variant="caption" tone="muted">
            {t('student.discovery.card.nearestSlot', {
              slot: t('common.format.dateTime', {
                date: format.weekdayDate(slot.startsAt, zone),
                time: format.time(slot.startsAt, zone),
              }),
            })}
          </Text>
        )}
        <Text variant="callout" weight="bold">
          {t('student.discovery.card.from', {
            price: formatPounds(piasters(card.lowestPerSession_piasters), locale),
          })}
        </Text>
      </View>
    </Card>
  );
}
