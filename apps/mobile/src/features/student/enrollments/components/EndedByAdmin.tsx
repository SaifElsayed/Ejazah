// 004:T083 (FR-514; SRS FR-CANCEL-10): an enrollment the server answers `endedByAdmin` reads
// «أنهت الإدارة هذا الاشتراك» followed by its reason, the reason drawn as plain text, never through a
// template. The internal note is never answered (T082), so it is never drawn.
import type { StudentEnrollmentItem } from '@ijazah/contracts';
import { View } from 'react-native';

import { Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { useT } from '../../../../i18n';

export function EndedByAdmin({
  endedByAdmin,
}: {
  readonly endedByAdmin: StudentEnrollmentItem['endedByAdmin'];
}) {
  const t = useT();
  if (endedByAdmin === undefined) return null;
  return (
    <View style={{ gap: tokens.space['1'] }}>
      <Text variant="callout" weight="medium">
        {t('status.enrollment.endedByAdmin')}
      </Text>
      <Text variant="callout" tone="muted">
        {endedByAdmin.reason}
      </Text>
    </View>
  );
}
