import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';

import type { ColorToken } from '../tokens';
import { useTheme } from '../theme';
import { Glyph } from './Icon';
import { border, opacity, pressed, radius, size, space, weight } from './style';
import { Words } from './Text';
import type { Accessible, IconSpec, Press } from './types';

/**
 * Button: the one action control. Never accepts a colour. Height is never below the touch size:
 * `lg` is 52 (the default, the primary action of a screen), `md` is 44. `loading` keeps the label
 * width so the layout does not jump; `disabled` dims to opacity.disabled and never animates.
 * Design: `.btn`, `.btn--*`.
 */
export interface ButtonProps extends Accessible {
  readonly label: string;
  /** primary, secondary (outlined), ghost (text), danger (outlined, red label), add (dashed), inverse (on a primary surface), apple and google (each provider's brand rules). */
  readonly variant?:
    'primary' | 'secondary' | 'ghost' | 'danger' | 'add' | 'inverse' | 'apple' | 'google';
  readonly size?: 'md' | 'lg';
  /** Full width (`block`) or sharing a row with its siblings (`grow`). */
  readonly layout?: 'inline' | 'block' | 'grow';
  readonly icon?: IconSpec;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly onPress: Press;
}

/**
 * IconButton: a square control at the touch size holding one icon. Always labelled. The dot marks
 * unread or pending (the bell). Design: `.icon-btn`, `.icon-btn--*`, `.icon-btn__dot`, `.back-btn`.
 */
export interface IconButtonProps extends Required<Accessible> {
  readonly icon: IconSpec;
  readonly variant?: 'plain' | 'surface' | 'primary' | 'muted';
  readonly dot?: boolean;
  readonly disabled?: boolean;
  readonly onPress: Press;
}

/**
 * TextLink: an inline action that is still a full touch target (minimum height and width 44).
 * Design: `.link`, `.link--muted`, `.link--strong`.
 */
export interface TextLinkProps extends Accessible {
  readonly label: string;
  readonly variant?: 'default' | 'muted' | 'strong';
  readonly icon?: IconSpec;
  readonly onPress: Press;
}

interface Paint {
  readonly background: ColorToken | 'transparent';
  readonly border: ColorToken | 'transparent';
  readonly label: ColorToken;
  readonly dashed?: boolean;
}

/** `.btn--*`: the surface, the border and the label of each variant. */
const buttonPaint: Readonly<Record<NonNullable<ButtonProps['variant']>, Paint>> = {
  primary: { background: 'primary', border: 'transparent', label: 'on-primary' },
  secondary: { background: 'bg', border: 'border-strong', label: 'text' },
  ghost: { background: 'transparent', border: 'transparent', label: 'primary' },
  danger: { background: 'bg', border: 'border-strong', label: 'danger' },
  add: { background: 'transparent', border: 'border-strong', label: 'primary', dashed: true },
  inverse: { background: 'on-primary-overlay', border: 'transparent', label: 'on-primary' },
  apple: { background: 'brand-apple', border: 'transparent', label: 'on-brand-apple' },
  google: { background: 'bg', border: 'border-strong', label: 'text' },
};

const layouts: Readonly<Record<NonNullable<ButtonProps['layout']>, ViewStyle>> = {
  inline: { alignSelf: 'flex-start' },
  block: { alignSelf: 'stretch' },
  grow: { flex: 1, minWidth: 0 },
};

export function Button({
  label,
  variant = 'primary',
  size: height = 'lg',
  layout = 'inline',
  icon,
  loading = false,
  disabled = false,
  accessibilityLabel,
  onPress,
}: ButtonProps) {
  const { color } = useTheme();
  const paint = buttonPaint[variant];
  // An inverse button on a primary card does not dim: its label turns muted (`.btn--inverse[disabled]`).
  const inverseOff = disabled && variant === 'inverse';
  const labelColor: ColorToken = inverseOff ? 'on-primary-muted' : paint.label;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      cssInterop={false}
      style={({ pressed: down }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space['2'],
          height: height === 'lg' ? size['control-lg'] : size['control-md'],
          paddingHorizontal: height === 'lg' ? space['5'] : space['4'],
          borderWidth: border.hairline,
          borderStyle: paint.dashed === true ? 'dashed' : 'solid',
          borderRadius: radius.md,
          borderColor: paint.border === 'transparent' ? 'transparent' : color[paint.border],
          backgroundColor:
            paint.background === 'transparent' ? 'transparent' : color[paint.background],
        },
        layouts[layout],
        disabled && !inverseOff ? { opacity: opacity.disabled } : null,
        down ? pressed : null,
      ]}
    >
      {icon === undefined ? null : <Glyph {...icon} color={labelColor} />}
      <Words
        variant={height === 'lg' ? 'headline' : 'body'}
        weight="bold"
        color={labelColor}
        numberOfLines={1}
        style={loading ? { opacity: 0 } : {}}
      >
        {label}
      </Words>
      {loading ? (
        <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={color[labelColor]} />
        </View>
      ) : null}
    </Pressable>
  );
}

const iconPaint: Readonly<Record<NonNullable<IconButtonProps['variant']>, Paint>> = {
  plain: { background: 'transparent', border: 'transparent', label: 'text' },
  surface: { background: 'surface', border: 'border', label: 'text' },
  primary: { background: 'primary', border: 'transparent', label: 'on-primary' },
  muted: { background: 'transparent', border: 'transparent', label: 'text-muted' },
};

/** An icon button with a layout adjustment of its own (the back button's start margin). */
export function PressableIcon({
  icon,
  variant = 'plain',
  dot = false,
  disabled = false,
  accessibilityLabel,
  onPress,
  style,
}: IconButtonProps & { readonly style?: ViewStyle }) {
  const { color } = useTheme();
  const paint = iconPaint[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      cssInterop={false}
      style={({ pressed: down }) => [
        {
          width: size.touch,
          height: size.touch,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: border.hairline,
          borderRadius: radius.md,
          borderColor: paint.border === 'transparent' ? 'transparent' : color[paint.border],
          backgroundColor:
            paint.background === 'transparent' ? 'transparent' : color[paint.background],
        },
        style,
        disabled ? { opacity: opacity.disabled } : null,
        down ? pressed : null,
      ]}
    >
      <Glyph {...icon} color={paint.label} />
      {dot ? (
        <View
          style={{
            position: 'absolute',
            top: space['2'],
            start: space['2'],
            width: size.dot,
            height: size.dot,
            borderRadius: radius.full,
            backgroundColor: color.primary,
          }}
        />
      ) : null}
    </Pressable>
  );
}

export function IconButton(props: IconButtonProps) {
  return <PressableIcon {...props} />;
}

const linkPaint: Readonly<
  Record<NonNullable<TextLinkProps['variant']>, { color: ColorToken; weight: keyof typeof weight }>
> = {
  default: { color: 'primary', weight: 'medium' },
  muted: { color: 'text-muted', weight: 'regular' },
  strong: { color: 'primary', weight: 'bold' },
};

export function TextLink({
  label,
  variant = 'default',
  icon,
  accessibilityLabel,
  onPress,
}: TextLinkProps) {
  const paint = linkPaint[variant];
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      cssInterop={false}
      style={({ pressed: down }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'flex-start',
          gap: space['1'],
          minHeight: size.touch,
          minWidth: size.touch,
          paddingHorizontal: space['2'],
        },
        down ? pressed : null,
      ]}
    >
      <Words weight={paint.weight} color={paint.color}>
        {label}
      </Words>
      {icon === undefined ? null : <Glyph size="sm" {...icon} color={paint.color} />}
    </Pressable>
  );
}
