// T045 (FR-358, screens.md §5): the one payment summary as the checkout screens draw it: the
// teacher, then the package as subject · sessions · minutes with its track's badge, then, where the
// screen gives them, the first and last session dates the student would get if confirmed now
// (FR-386, T085: `checkout.current`'s previews, each its local date in the slot's zone, drawn as the
// calendar date `PaymentSuccess` compares it with), then what each screen adds (the total, the
// amount, the time left, the status). The boards' weekly slot row is not drawn (T085 names the dates).
import type { CheckoutSummary, PackageTrack, SessionPreview } from '@ijazah/contracts';
import { View } from 'react-native';

import { Badge, type SummaryProps, Summary, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useFormatters } from '../../../../lib/formatters';
import { useSubjectName } from '../../../../lib/subjects';

const TRACK_LABEL: Readonly<Record<PackageTrack, MessageKey>> = {
  recitation: 'common.track.recitation',
  ijazah_track: 'common.track.ijazahTrack',
};

type Row = SummaryProps['rows'][number];

/** The first and last session a confirmation now would give (FR-386). */
export interface SessionDates {
  readonly firstSession: SessionPreview;
  readonly lastSession: SessionPreview;
}

export function OrderSummary({
  summary,
  label,
  sessions,
  rows = [],
}: {
  readonly summary: CheckoutSummary;
  /** What a screen reader calls the summary: «الطلب», «الطلب السابق». */
  readonly label: string;
  /** Drawn after the package when given: «أول جلسة», «آخر جلسة». */
  readonly sessions?: SessionDates;
  readonly rows?: readonly Row[];
}) {
  const t = useT();
  const format = useFormatters();
  const dates: readonly Row[] =
    sessions === undefined
      ? []
      : [
          {
            label: t('student.checkout.firstSession'),
            value: format.calendarDate(sessions.firstSession.localDate),
          },
          {
            label: t('student.checkout.lastSession'),
            value: format.calendarDate(sessions.lastSession.localDate),
          },
        ];
  return (
    <View accessibilityLabel={label}>
      <Summary
        rows={[
          { label: t('student.checkout.teacher'), value: summary.teacher.displayName },
          { label: t('student.checkout.package'), value: <PackageValue summary={summary} /> },
          ...dates,
          ...rows,
        ]}
      />
    </View>
  );
}

function PackageValue({ summary }: { readonly summary: CheckoutSummary }) {
  const t = useT();
  const nameOf = useSubjectName();
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: tokens.space['2'],
      }}
    >
      <Text variant="body" weight="medium" align="end">
        {t('student.checkout.packageValue', {
          subject: nameOf(summary.subject),
          sessions: t('common.sessions', { count: summary.sessionCount }),
          minutes: summary.sessionDurationMinutes,
        })}
      </Text>
      <Badge
        label={t(TRACK_LABEL[summary.track])}
        tone={summary.track === 'ijazah_track' ? 'accent' : 'neutral'}
      />
    </View>
  );
}
