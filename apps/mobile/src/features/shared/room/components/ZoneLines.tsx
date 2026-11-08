// T018 of specs/004-sessions (FR-494, ADR 0009 D5): an instant of a session as both participants
// read it: in the session's own zone, then in the viewer's when that is another one, each line
// named by its city (never an IANA id).
import { cityOf } from '@ijazah/time/cities';
import { View } from 'react-native';

import { Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';

/** The zones an instant is shown in: the session's, and the viewer's when it differs. */
export function zonesShown(sessionZone: string, viewerZone: string): readonly string[] {
  return sessionZone === viewerZone ? [sessionZone] : [sessionZone, viewerZone];
}

export function ZoneLines({
  instant,
  sessionZone,
  viewerZone,
}: {
  readonly instant: string;
  readonly sessionZone: string;
  readonly viewerZone: string;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  return (
    <View style={{ gap: tokens.space['1'] }}>
      {zonesShown(sessionZone, viewerZone).map((zone, index) => (
        <Text key={zone} variant={index === 0 ? 'callout' : 'caption'} tone="muted">
          {t('session.pre.timeIn', {
            date: format.weekdayDate(instant, zone),
            time: format.time(instant, zone),
            city: cityOf(zone, locale) ?? zone,
          })}
        </Text>
      ))}
    </View>
  );
}
