// T045 (FR-358, screens.md §5): the one payment summary as the checkout screens draw it: the
// teacher, then the package as subject · sessions · minutes with its track's badge, then what each
// screen adds (the total, the amount, the time left, the status). The weekly slot and the first
// session's date on the boards are not in `checkout.current`'s summary, so they are not drawn.
import type { CheckoutSummary, PackageTrack } from '@ijazah/contracts';
import { View } from 'react-native';

import { Badge, type SummaryProps, Summary, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { type MessageKey, useT } from '../../../../i18n';
import { useSubjectName } from '../../../../lib/subjects';

const TRACK_LABEL: Readonly<Record<PackageTrack, MessageKey>> = {
  recitation: 'common.track.recitation',
  ijazah_track: 'common.track.ijazahTrack',
};

type Row = SummaryProps['rows'][number];

export function OrderSummary({
  summary,
  label,
  rows = [],
}: {
  readonly summary: CheckoutSummary;
  /** What a screen reader calls the summary: «الطلب», «الطلب السابق». */
  readonly label: string;
  readonly rows?: readonly Row[];
}) {
  const t = useT();
  return (
    <View accessibilityLabel={label}>
      <Summary
        rows={[
          { label: t('student.checkout.teacher'), value: summary.teacher.displayName },
          { label: t('student.checkout.package'), value: <PackageValue summary={summary} /> },
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
