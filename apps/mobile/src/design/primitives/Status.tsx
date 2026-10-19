import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, View, type DimensionValue } from 'react-native';

import type { ColorToken } from '../tokens';
import { useTheme } from '../theme';
import { Button } from './Button';
import { IconTile } from './Containers';
import { Glyph } from './Icon';
import { border, duration, easing, media, opacity, radius, shadow, size, space } from './style';
import { Words } from './Text';
import type { Content, IconSpec, Press, StatusTone } from './types';

/**
 * Badge: a status word. `accent` is the gold tone and is reserved for ijazah and isnad surfaces;
 * `on-primary` sits on a primary card. Design: `.badge`, `.badge--*`.
 */
export interface BadgeProps {
  readonly label: string;
  readonly tone: StatusTone | 'on-primary';
  readonly icon?: IconSpec;
}

/**
 * Banner: a note with an icon. Neutral by default; `plain` has no surface; `info`, `success`,
 * `warning` and `danger` for states. Design: `.banner`, `.banner--*`.
 */
export interface BannerProps {
  readonly icon: IconSpec;
  readonly children: Content;
  readonly tone?: 'neutral' | 'plain' | 'info' | 'success' | 'warning' | 'danger';
}

/** Toast: the confirmation after an action, bottom-centred, dismissed on its own. Design: `.toast`. */
export interface ToastProps {
  readonly message: string;
  readonly icon?: IconSpec;
}

/**
 * EmptyState: what is missing, why, and the one next step. Every list has one. Design:
 * `.empty-state`, `.empty-state__title`, `.empty-state__text`.
 */
export interface EmptyStateProps {
  readonly icon: IconSpec;
  readonly title: string;
  readonly text?: string;
  readonly action?: { readonly label: string; readonly onPress: Press };
}

/**
 * Skeleton: the shape of content that is loading, shimmering, in place of a blank. Design:
 * `.skeleton`, `.skeleton--text|title|avatar|block`, `.skeleton--w-1-3|1-2|2-3`.
 */
export interface SkeletonProps {
  readonly shape: 'text' | 'title' | 'avatar' | 'block';
  readonly width?: '1/3' | '1/2' | '2/3' | 'full';
}

/** Spinner: a confirming state; animates in the app. Design: `.spinner`, `.spinner--sm`. */
export interface SpinnerProps {
  readonly size?: 'sm' | 'lg';
}

// ---------------------------------------------------------------------------------------------
// T032: the implementations.

interface Surface {
  readonly background: ColorToken | 'transparent';
  readonly border: ColorToken | 'transparent';
  readonly text: ColorToken;
  readonly icon?: ColorToken;
}

/** `.badge--*`. */
const badgeSurface: Readonly<Record<BadgeProps['tone'], Surface>> = {
  neutral: { background: 'surface', border: 'border', text: 'text-muted' },
  success: { background: 'primary-subtle', border: 'transparent', text: 'primary-strong' },
  warning: { background: 'warning-subtle', border: 'warning-border', text: 'warning-text' },
  danger: { background: 'danger-subtle', border: 'transparent', text: 'danger' },
  accent: { background: 'accent-soft', border: 'accent-border', text: 'accent-text' },
  'on-primary': { background: 'on-primary-overlay', border: 'transparent', text: 'on-primary' },
};

const paint = (colours: Readonly<Record<ColorToken, string>>, token: ColorToken | 'transparent') =>
  token === 'transparent' ? 'transparent' : colours[token];

export function Badge({ label, tone, icon }: BadgeProps) {
  const { color } = useTheme();
  const surface = badgeSurface[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: space['1'],
        paddingVertical: space.half,
        paddingHorizontal: space['2'],
        borderWidth: border.hairline,
        borderRadius: radius.full,
        borderColor: paint(color, surface.border),
        backgroundColor: paint(color, surface.background),
      }}
    >
      {icon === undefined ? null : <Glyph size="xs" {...icon} color={surface.text} />}
      <Words variant="micro" weight="medium" color={surface.text} numberOfLines={1}>
        {label}
      </Words>
    </View>
  );
}

/** `.banner--*`: the surface, the text and the icon of each tone. */
const bannerSurface: Readonly<Record<NonNullable<BannerProps['tone']>, Surface>> = {
  neutral: { background: 'surface', border: 'border', text: 'text-muted', icon: 'text-muted' },
  plain: { background: 'transparent', border: 'border', text: 'text-muted', icon: 'text-muted' },
  info: { background: 'surface', border: 'border', text: 'text', icon: 'text-muted' },
  success: {
    background: 'primary-subtle',
    border: 'primary-border',
    text: 'text',
    icon: 'primary',
  },
  warning: {
    background: 'warning-subtle',
    border: 'warning-border',
    text: 'text',
    icon: 'warning-text',
  },
  danger: { background: 'danger-subtle', border: 'danger', text: 'text', icon: 'danger' },
};

export function Banner({ icon, tone = 'neutral', children }: BannerProps) {
  const { color } = useTheme();
  const surface = bannerSurface[tone];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space['3'],
        paddingVertical: space['3'],
        paddingHorizontal: space['4'],
        borderWidth: border.hairline,
        borderRadius: radius.md,
        borderColor: paint(color, surface.border),
        backgroundColor: paint(color, surface.background),
      }}
    >
      <View style={{ marginTop: space.half }}>
        <Glyph size="sm" {...icon} color={surface.icon ?? surface.text} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof children === 'string' ? (
          <Words variant="caption" color={surface.text}>
            {children}
          </Words>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** The toast fades in at `duration.base`; with reduce-motion it appears at once. */
export function Toast({ message, icon }: ToastProps) {
  const { color } = useTheme();
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // Announced at once: the fade must not delay what a screen reader says.
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled) return;
      if (reduced) shown.setValue(1);
      else {
        Animated.timing(shown, {
          toValue: 1,
          duration: duration.base,
          easing: Easing.bezier(...easing.enter),
          useNativeDriver: true,
        }).start();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shown]);
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        bottom: space['6'],
        alignSelf: 'center',
        zIndex: 30,
        opacity: shown,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space['3'],
        paddingVertical: space['3'],
        paddingHorizontal: space['4'],
        borderRadius: radius.md,
        backgroundColor: color.text,
        boxShadow: shadow('sheet', color),
      }}
    >
      {icon === undefined ? null : <Glyph {...icon} color="bg" />}
      <Words color="bg" numberOfLines={1}>
        {message}
      </Words>
    </Animated.View>
  );
}

export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <View
      style={{
        alignItems: 'center',
        gap: space['3'],
        paddingVertical: space['10'],
        paddingHorizontal: space['6'],
      }}
    >
      <IconTile icon={{ size: 'xl', ...icon }} size="2xl" tone="neutral" />
      <Words variant="title-3" color="text" align="center">
        {title}
      </Words>
      {text === undefined ? null : (
        <View style={{ maxWidth: size['bubble-max'] }}>
          <Words color="text-muted" align="center">
            {text}
          </Words>
        </View>
      )}
      {action === undefined ? null : (
        <View style={{ marginTop: space['2'] }}>
          <Button label={action.label} variant="secondary" size="md" onPress={action.onPress} />
        </View>
      )}
    </View>
  );
}

const skeletonShape: Readonly<
  Record<SkeletonProps['shape'], { height: number; width?: number; borderRadius: number }>
> = {
  text: { height: space['3'], borderRadius: radius.sm },
  title: { height: space['5'], borderRadius: radius.sm },
  avatar: { height: media.sm, width: media.sm, borderRadius: radius.full },
  block: { height: size['control-lg'], borderRadius: radius.md },
};

const skeletonWidth: Readonly<Record<NonNullable<SkeletonProps['width']>, DimensionValue>> = {
  '1/3': '33%',
  '1/2': '50%',
  '2/3': '66%',
  full: '100%',
};

/** A shape that shimmers over five `duration.slow` periods; still with reduce-motion. */
export function Skeleton({ shape, width = 'full' }: SkeletonProps) {
  const { color } = useTheme();
  const geometry = skeletonShape[shape];
  const shimmer = useLoop();
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        backgroundColor: color.skeleton,
        height: geometry.height,
        width: geometry.width ?? skeletonWidth[width],
        borderRadius: geometry.borderRadius,
        flexShrink: geometry.width === undefined ? 1 : 0,
        opacity: shimmer.interpolate({
          inputRange: [0, HALF, 1],
          outputRange: [1, opacity.disabled, 1],
        }),
      }}
    />
  );
}

const spinnerSize: Readonly<
  Record<NonNullable<SpinnerProps['size']>, { width: number; ring: number }>
> = {
  lg: { width: media['2xl'], ring: space['1'] },
  sm: { width: media.xs, ring: border.selected },
};

/** A ring turning once per five `duration.slow` periods; still with reduce-motion. */
export function Spinner({ size: scale = 'lg' }: SpinnerProps) {
  const { color } = useTheme();
  const turn = useLoop();
  const { width, ring } = spinnerSize[scale];
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={{
        width,
        height: width,
        borderRadius: radius.full,
        borderWidth: ring,
        borderColor: color['primary-subtle'],
        borderTopColor: color.primary,
        transform: [
          { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        ],
      }}
    />
  );
}

/** The shimmer of `.skeleton` lasts five `duration.slow` periods; the spinner turns at the same pace. */
const PERIODS = 5;
const HALF = 0.5;

/** A value running from 0 to 1 and again, for as long as the component is shown; none with reduce-motion. */
function useLoop(): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: duration.slow * PERIODS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [value]);
  return value;
}
