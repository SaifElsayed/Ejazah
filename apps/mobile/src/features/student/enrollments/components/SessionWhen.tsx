// T050 (FR-393, ADR 0009 D5): a session's day and time as the student reads it: in the student's
// own zone, then in the teacher's when that is another one, each line named by its city (never an
// IANA id, screens.md §6).
import type { EnrollmentSession } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { View } from 'react-native';

import { Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useLocale, useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';

/** «{date} · {start} – {end} · بتوقيت {city}» for `session` in `zone`. */
export function useSessionTime(): (session: EnrollmentSession, zone: string) => string {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  return (session, zone) =>
    t('student.enrollments.sessionTime', {
      date: format.weekdayDate(session.startsAt, zone),
      start: format.time(session.startsAt, zone),
      end: format.time(session.endsAt, zone),
      city: cityOf(zone, locale) ?? zone,
    });
}

/** The zones a session is shown in: the student's, and the teacher's when it differs. */
export function zonesOf(session: EnrollmentSession, studentZone: string): readonly string[] {
  return session.timezone === studentZone ? [studentZone] : [studentZone, session.timezone];
}

export function SessionWhen({
  session,
  zone,
}: {
  readonly session: EnrollmentSession;
  /** The student's own zone. */
  readonly zone: string;
}) {
  const timeOf = useSessionTime();
  return (
    <View style={{ gap: tokens.space['1'] }}>
      {zonesOf(session, zone).map((shownIn, index) => (
        <Text key={shownIn} variant={index === 0 ? 'callout' : 'caption'} tone="muted">
          {timeOf(session, shownIn)}
        </Text>
      ))}
    </View>
  );
}
