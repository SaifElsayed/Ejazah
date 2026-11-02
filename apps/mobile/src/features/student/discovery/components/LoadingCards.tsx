// T029: the cards while they load (screens.md's states table: `.skeleton` cards). A card carries no
// photo, so its skeleton draws none: a title and two lines.
import { View } from 'react-native';

import { Card, Skeleton } from '../../../../design/primitives';
import { tokens } from '../../../../design/tokens';

export function LoadingCards({ count = 3 }: { readonly count?: number }) {
  return (
    <View style={{ gap: tokens.space['5'] }}>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index}>
          <Skeleton shape="title" width="2/3" />
          <Skeleton shape="text" width="full" />
          <Skeleton shape="text" width="1/2" />
        </Card>
      ))}
    </View>
  );
}
