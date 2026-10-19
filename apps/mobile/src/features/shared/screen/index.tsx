// T034: the frame of a tab root (`.screen`, `.screen__body`): its header, then a body that scrolls
// with the gutter and the gaps of the design. The top inset is the tab layout's; the tab bar is too.
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { useTheme } from '../../../design/theme';
import { tokens } from '../../../design/tokens';

export function TabScreen({
  header,
  children,
}: {
  readonly header: ReactNode;
  readonly children: ReactNode;
}) {
  const { color } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {header}
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          gap: tokens.space['5'],
          paddingTop: tokens.space['2'],
          paddingHorizontal: tokens.layout.gutter,
          paddingBottom: tokens.space['4'],
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}
