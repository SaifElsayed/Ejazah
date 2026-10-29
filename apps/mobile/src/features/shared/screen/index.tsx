// T034: the frame of a tab root (`.screen`, `.screen__body`): its header, then a body that scrolls
// with the gutter and the gaps of the design. The top inset is the tab layout's; the tab bar is too.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';

import { IconButton } from '../../../design/primitives';
import { useTheme } from '../../../design/theme';
import { tokens } from '../../../design/tokens';
import { useT } from '../../../i18n';

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

/**
 * The frame of a pushed screen or a modal (`.screen` with a nav header): the header, a body that
 * scrolls with the gutter and keeps a tapped field's keyboard, and the action bar at the foot. The
 * device's insets are the route group's (`(auth)/_layout.tsx`, the modal routes).
 */
export function StackScreen({
  header,
  children,
  footer,
}: {
  readonly header: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { color } = useTheme();
  return (
    // T114: padding on Android too; under edge-to-edge the window no longer shrinks for the keyboard.
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: color.bg }}>
      {header}
      <ScrollView
        keyboardShouldPersistTaps="handled"
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
      {footer}
    </KeyboardAvoidingView>
  );
}

/**
 * The back arrow alone, for a pushed screen whose title is its page intro (`.back-btn` on the
 * sign-in boards); `NavHeader` is the bar with a title.
 */
export function BackBar({ onPress }: { readonly onPress: () => void }) {
  const t = useT();
  return (
    <View
      style={{
        height: tokens.layout.header,
        justifyContent: 'center',
        paddingHorizontal: tokens.layout.gutter,
      }}
    >
      <View style={{ alignSelf: 'flex-start', marginStart: -tokens.space['3'] }}>
        <IconButton
          icon={{ name: 'chevron-left', size: 'lg' }}
          accessibilityLabel={t('common.a11y.back')}
          onPress={onPress}
        />
      </View>
    </View>
  );
}
