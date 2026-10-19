import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  View,
} from 'react-native';

import { useT } from '../../i18n';
import { useTheme } from '../theme';
import { Button, PressableIcon } from './Button';
import { duration, easing, layout, motion, radius, shadow, size, space } from './style';
import { Words } from './Text';
import type { Content, Press } from './types';

/**
 * Sheet: every modal flow on the phone. Slides up over a scrim at duration.slow and dims what is
 * behind it to opacity.behind-sheet. A raw `Modal` in a feature is a review blocker. Design:
 * `.scrim`, `.sheet`, `.sheet__handle`, `.sheet__header`, `.sheet__title`, `.behind-sheet`.
 */
export interface SheetProps {
  readonly open: boolean;
  readonly onClose: Press;
  readonly title?: string;
  /** Fractions of the screen height; one value for a fixed sheet. */
  readonly snapPoints?: readonly number[];
  readonly children: Content;
}

/**
 * Dialog: a centred card over the dimmed screen for a decision the user cannot swipe away (add
 * your signature first; confirming the payment). Scales in at duration.base. Design: `.dialog`,
 * `.dialog__title`, `.dialog__actions`.
 */
export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly children?: Content;
  readonly actions: readonly {
    readonly label: string;
    readonly variant?: 'primary' | 'secondary' | 'danger';
    readonly onPress: Press;
  }[];
}

// ---------------------------------------------------------------------------------------------
// T032: the implementations. Both are built on React Native's Modal, here and nowhere else; a raw
// Modal in a feature is refused by `mobile/no-raw-control` (R-MOBILE-6).

/** 0 to 1 over `ms` with the entering curve while `open`; 1 at once with reduce-motion. */
function useEntrance(open: boolean, ms: number): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!open) {
      value.setValue(0);
      return;
    }
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) value.setValue(1);
      else {
        Animated.timing(value, {
          toValue: 1,
          duration: ms,
          easing: Easing.bezier(...easing.enter),
          useNativeDriver: true,
        }).start();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, ms, value]);
  return value;
}

const FILL = { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 } as const;

export function Sheet({ open, onClose, title, snapPoints, children }: SheetProps) {
  const { color } = useTheme();
  const t = useT();
  const entrance = useEntrance(open, duration.slow);
  const screen = Dimensions.get('window').height;
  const tallest =
    snapPoints === undefined || snapPoints.length === 0 ? undefined : Math.max(...snapPoints);
  if (!open) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* The scrim closes the sheet for a touch; a screen reader closes it from the header. */}
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={[FILL, { backgroundColor: color.scrim }]}
        />
        <Animated.View
          accessibilityViewIsModal
          style={{
            gap: space['4'],
            paddingTop: space['2'],
            paddingHorizontal: layout.gutter,
            paddingBottom: layout['inset-bottom'],
            borderTopStartRadius: radius.xl,
            borderTopEndRadius: radius.xl,
            backgroundColor: color.bg,
            boxShadow: shadow('sheet', color),
            ...(tallest === undefined ? {} : { maxHeight: tallest * screen }),
            transform: [
              {
                translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [screen, 0] }),
              },
            ],
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: size['handle-width'],
              height: size['handle-height'],
              borderRadius: radius.full,
              backgroundColor: color['border-strong'],
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space['3'],
            }}
          >
            <View accessible accessibilityRole="header" style={{ flex: 1, minWidth: 0 }}>
              {title === undefined ? null : (
                <Words variant="title-2" color="text">
                  {title}
                </Words>
              )}
            </View>
            <PressableIcon
              icon={{ name: 'x' }}
              accessibilityLabel={t('common.a11y.close')}
              onPress={onClose}
            />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const actionVariant = { primary: 'primary', secondary: 'secondary', danger: 'danger' } as const;

/** A decision the person cannot swipe away: the scrim does not close it, an action does. */
export function Dialog({ open, title, children, actions }: DialogProps) {
  const { color } = useTheme();
  const entrance = useEntrance(open, duration.base);
  if (!open) return null;
  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={() => undefined}
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: layout.gutter,
          backgroundColor: color.scrim,
        }}
      >
        <Animated.View
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: layout.dialog,
            gap: space['4'],
            padding: space['6'],
            borderRadius: radius.xl,
            backgroundColor: color.bg,
            boxShadow: shadow('sheet', color),
            // Scales in from `motion.dialog-scale`; never transparent, so a screen reader reaches it at once.
            transform: [
              {
                scale: entrance.interpolate({
                  inputRange: [0, 1],
                  outputRange: [motion['dialog-scale'], 1],
                }),
              },
            ],
          }}
        >
          <View accessible accessibilityRole="header" accessibilityLabel={title}>
            <Words variant="title-2" color="text">
              {title}
            </Words>
          </View>
          {typeof children === 'string' ? <Words color="text-muted">{children}</Words> : children}
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              gap: space['2'],
            }}
          >
            {actions.map((action) => (
              <Button
                key={action.label}
                label={action.label}
                variant={actionVariant[action.variant ?? 'primary']}
                size="md"
                onPress={action.onPress}
              />
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
