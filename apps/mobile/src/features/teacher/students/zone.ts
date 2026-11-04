// T051 (FR-393, ADR 0009 D5): a session is shown in its own zone, the teacher's when it was booked,
// and in the viewer's: the teacher's zone now. When the two are one, the session's line says it all;
// when the teacher has moved since, a second line says the session's date and time where the teacher
// is, with that city, so the two never silently disagree.
import { cityOf } from '@ijazah/time/cities';
import { useCallback } from 'react';

import { useLocale, useT } from '../../../i18n';
import { useFormatters } from '../../../lib/formatters';

/** The line of `instant` in `viewerZone`, or null when the session's own zone is the viewer's. */
export function useInViewerZone(): (
  instant: string,
  sessionZone: string,
  viewerZone: string | undefined,
) => string | null {
  const t = useT();
  const locale = useLocale();
  const format = useFormatters();
  return useCallback(
    (instant, sessionZone, viewerZone) =>
      viewerZone === undefined || viewerZone === sessionZone
        ? null
        : t('teacher.students.inViewerZone', {
            date: format.date(instant, viewerZone),
            time: format.time(instant, viewerZone),
            city: cityOf(viewerZone, locale) ?? viewerZone,
          }),
    [t, locale, format],
  );
}
