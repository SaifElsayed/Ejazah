// T030 (FR-336, FR-337, ADR 0018 D1/D2): one active package on the teacher's profile (screens.md
// §4): the subject and count with the track's badge, the session length, the track's remedy line,
// then the total and the price per session, both computed by the server in `packages/money` and
// drawn here in pounds. The remedy line is the phone's copy by track; the answer carries none.
import type { DiscoveryTeacherPackage, PackageTrack } from '@ijazah/contracts';
import { piasters } from '@ijazah/money';
import { View } from 'react-native';

import { Badge, Card, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useLocale, useT } from '../../../../i18n';
import { formatPounds } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';
import { TRACK_LABEL } from '../tracks';

/** What a session that is not consumed becomes, by track (ADR 0018 D2). */
const REMEDY_LINE: Readonly<Record<PackageTrack, MessageKey>> = {
  recitation: 'student.teacherProfile.remedy.recitation',
  ijazah_track: 'student.teacherProfile.remedy.ijazahTrack',
};

export function ProfilePackage({ item }: { readonly item: DiscoveryTeacherPackage }) {
  const t = useT();
  const locale = useLocale();
  const nameOf = useSubjectName();
  return (
    <Card variant="compact">
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: tokens.space['3'],
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: tokens.space['1'] }}>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: tokens.space['2'],
            }}
          >
            <Text variant="body" weight="bold">
              {t('common.format.packageShort', {
                subject: nameOf(item.subject),
                count: item.sessionCount,
              })}
            </Text>
            <Badge
              label={t(TRACK_LABEL[item.track])}
              tone={item.track === 'ijazah_track' ? 'accent' : 'neutral'}
            />
          </View>
          <Text variant="caption" tone="muted">
            {t('student.teacherProfile.minutesPerSession', {
              minutes: item.sessionDurationMinutes,
            })}
          </Text>
          <Text variant="caption" tone="muted">
            {t(REMEDY_LINE[item.track])}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: tokens.space['1'] }}>
          <Text variant="body" weight="bold">
            {formatPounds(piasters(item.price_piasters), locale)}
          </Text>
          <Text variant="caption" tone="muted">
            {t('student.teacherProfile.pricePerSession', {
              price: formatPounds(piasters(item.perSession_piasters), locale),
            })}
          </Text>
        </View>
      </View>
    </Card>
  );
}
