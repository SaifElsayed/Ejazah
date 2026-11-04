// T051 (FR-391, FR-393; screens.md §14): the teacher's day over its agenda: its date with the weekday,
// and «{n} جلسات · {h:mm} ساعة · بتوقيت {city}», or «لا جلسات · بتوقيت {city}», in the teacher's zone
// now, the one the server took the day in. The hours sum the day's session lengths.
import type { TeacherTodayOutput } from '@ijazah/contracts';
import { cityOf } from '@ijazah/time/cities';
import { View } from 'react-native';

import { Text } from '../../../../design/primitives';
import { useLocale, useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';

export function DayHeading({ day }: { readonly day: TeacherTodayOutput }) {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  const city = cityOf(day.timezone, locale) ?? day.timezone;
  const minutes = day.sessions.reduce(
    (sum, session) => sum + session.summary.sessionDurationMinutes,
    0,
  );
  return (
    <View>
      <Text variant="title-3">{format.calendarWeekdayDate(day.localDate)}</Text>
      <Text variant="caption" tone="muted">
        {day.sessions.length === 0
          ? t('teacher.today.emptySummary', { city })
          : t('teacher.today.summary', {
              count: day.sessions.length,
              hours: format.hoursMinutes(minutes),
              city,
            })}
      </Text>
    </View>
  );
}
