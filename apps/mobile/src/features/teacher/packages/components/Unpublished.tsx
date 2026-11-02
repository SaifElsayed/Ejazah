// T021, T069 (FR-315): what the teacher sees while not published, on the packages tab and on the
// availability tab alike. The warning leads to the payout, which draws the screen of its state
// (pending or rejected alike); a tappable warning is a warning card, as the application's request
// for a document is (R-MOBILE-6). The marker «غير منشورة» sits beside what students do not see.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Badge, Card, Icon, Text } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';
import { PAYOUT_ROUTE } from '../../payout';

/** The warning to the payout; `text` names what students do not see. */
export function UnpublishedBanner({ text }: { readonly text: string }) {
  return (
    <Card variant="warning" onPress={() => router.push(PAYOUT_ROUTE)}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: tokens.space['3'] }}>
        <Icon name="lock" size="sm" tone="warning" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="caption">{text}</Text>
        </View>
      </View>
    </Card>
  );
}

/** «غير منشورة», as its catalog's key says it. */
export function UnpublishedBadge({ label }: { readonly label: string }) {
  return <Badge label={label} tone="neutral" icon={{ name: 'eye-off', size: 'xs' }} />;
}
