import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Image, Pressable, View, type ViewStyle } from 'react-native';

import type { ColorToken, MediaSize, TextStyle } from '../tokens';
import { useTheme } from '../theme';
import { TextLink } from './Button';
import { Glyph } from './Icon';
import { border, media, pressed, radius, shadow, size, space } from './style';
import { Words } from './Text';
import type { Content, IconSpec, Press, StatusTone } from './types';

/**
 * Card: a container, not a layout engine: it does not decide its own margins. Pressable when it
 * has `onPress` (a whole-card link). Design: `.card`, `.card--*`.
 */
export interface CardProps {
  /** row (icon and text side by side), compact (12 padding), surface, hero (20 padding, 20 radius), accent (gold, ijazah), warning, primary (green, white text), selected. */
  readonly variant?:
    | 'default'
    | 'row'
    | 'compact'
    | 'surface'
    | 'hero'
    | 'accent'
    | 'warning'
    | 'primary'
    | 'selected';
  readonly onPress?: Press;
  readonly children: Content;
}

/** Section: a titled group of content in a body, with one optional trailing action. Design: `.section`. */
export interface SectionProps {
  readonly title: string;
  readonly action?: { readonly label: string; readonly onPress: Press };
  readonly children: Content;
}

/**
 * List: grouped rows (settings, account, application summary) with an optional header. A row is
 * pressable when it has `onPress`; its value sits at the end. Design: `.list`, `.list__row`,
 * `.list__row--selected`, `.list__row--danger`, `.list__value`, `.list__header`.
 */
export interface ListProps {
  readonly header?: string;
  readonly children: Content;
}

export interface ListRowProps {
  readonly label: Content;
  readonly value?: Content;
  readonly leading?: Content;
  readonly trailing?: Content;
  readonly tone?: 'default' | 'selected' | 'danger';
  readonly onPress?: Press;
}

/**
 * Summary: label and value rows (an order, a receipt, a confirmation). `total` is the bold last
 * row; `emphasis` is the highlighted row (the amount the teacher receives). Design: `.summary`.
 */
export interface SummaryProps {
  readonly rows: readonly {
    readonly label: string;
    readonly value: Content;
    readonly kind?: 'row' | 'total' | 'emphasis';
  }[];
}

/** Stats: a few numbers side by side; `tile` draws each on a surface. Design: `.stats`, `.stat--tile`. */
export interface StatsProps {
  readonly items: readonly { readonly value: Content; readonly label: string }[];
  readonly tile?: boolean;
}

/**
 * Avatar: a person, always round, initials or a photo. `speaking` adds the live ring. Design:
 * `.avatar`, `.avatar--*`.
 */
export interface AvatarProps {
  readonly initials: string;
  readonly imageUri?: string;
  readonly size?: 'sm' | 'md' | 'touch' | 'lg' | 'xl' | '2xl' | '3xl';
  readonly tone?: 'default' | 'neutral' | 'primary';
  readonly speaking?: boolean;
}

/**
 * IconTile: a thing, an icon in a tinted square (round when `round`). Design: `.icon-tile`,
 * `.icon-tile--*`.
 */
export interface IconTileProps {
  readonly icon: IconSpec;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  readonly tone?: StatusTone | 'primary' | 'outline' | 'default';
  readonly round?: boolean;
}

// ---------------------------------------------------------------------------------------------
// T032: the implementations. Stats is a contract of a later phase's screens and is implemented
// with them.

type CardVariant = NonNullable<CardProps['variant']>;

/** `.card--*`: the surface, the border, the padding and the radius of each variant. */
const cardSurface: Readonly<
  Record<
    CardVariant,
    { background: ColorToken; border: ColorToken; padding: number; radius: number; gap: number }
  >
> = {
  default: {
    background: 'surface-raised',
    border: 'border',
    padding: space['4'],
    radius: radius.md,
    gap: space['3'],
  },
  row: {
    background: 'surface-raised',
    border: 'border',
    padding: space['4'],
    radius: radius.md,
    gap: space['3'],
  },
  compact: {
    background: 'surface-raised',
    border: 'border',
    padding: space['3'],
    radius: radius.md,
    gap: space['2'],
  },
  surface: {
    background: 'surface',
    border: 'border',
    padding: space['4'],
    radius: radius.md,
    gap: space['3'],
  },
  hero: {
    background: 'surface-raised',
    border: 'border',
    padding: space['5'],
    radius: radius.xl,
    gap: space['3'],
  },
  accent: {
    background: 'accent-subtle',
    border: 'accent-border',
    padding: space['4'],
    radius: radius.md,
    gap: space['3'],
  },
  warning: {
    background: 'warning-subtle',
    border: 'warning-border',
    padding: space['4'],
    radius: radius.md,
    gap: space['3'],
  },
  primary: {
    background: 'primary',
    border: 'primary',
    padding: space['4'],
    radius: radius.md,
    gap: space['3'],
  },
  selected: {
    background: 'primary-subtle',
    border: 'primary',
    padding: space['4'],
    radius: radius.md,
    gap: space['3'],
  },
};

export function Card({ variant = 'default', onPress, children }: CardProps) {
  const { color } = useTheme();
  const surface = cardSurface[variant];
  const style: ViewStyle = {
    flexDirection: variant === 'row' ? 'row' : 'column',
    alignItems: variant === 'row' ? 'center' : 'stretch',
    gap: surface.gap,
    padding: surface.padding,
    borderWidth: variant === 'selected' ? border.selected : border.hairline,
    borderColor: color[surface.border],
    borderRadius: surface.radius,
    backgroundColor: color[surface.background],
  };
  if (onPress === undefined) return <View style={style}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      cssInterop={false}
      style={({ pressed: down }) => [style, down ? pressed : null]}
    >
      {children}
    </Pressable>
  );
}

export function Section({ title, action, children }: SectionProps) {
  return (
    <View style={{ gap: space['3'] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space['3'],
        }}
      >
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={title}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Words variant="headline" color="text">
            {title}
          </Words>
        </View>
        {action === undefined ? null : <TextLink label={action.label} onPress={action.onPress} />}
      </View>
      {children}
    </View>
  );
}

export function List({ header, children }: ListProps) {
  const { color } = useTheme();
  const rows = Children.toArray(flatten(children));
  return (
    <View
      style={{
        overflow: 'hidden',
        borderWidth: border.hairline,
        borderColor: color.border,
        borderRadius: radius.md,
        backgroundColor: color['surface-raised'],
      }}
    >
      {header === undefined ? null : (
        <View
          style={{
            paddingTop: space['3'],
            paddingHorizontal: space['4'],
            paddingBottom: space['1'],
          }}
        >
          <Words variant="caption" weight="medium" color="text-muted">
            {header}
          </Words>
        </View>
      )}
      {rows.map((row, index) => (
        // A divider above every row after the first; above the first only under a header.
        <View
          key={isValidElement(row) && row.key !== null ? row.key : index}
          style={
            index > 0 || header !== undefined
              ? { borderTopWidth: border.hairline, borderTopColor: color.border }
              : null
          }
        >
          {row}
        </View>
      ))}
    </View>
  );
}

/** The rows of a List, through fragments. */
function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flatten(child.props.children)
      : [child],
  );
}

const rowText: Readonly<Record<NonNullable<ListRowProps['tone']>, ColorToken>> = {
  default: 'text',
  selected: 'primary-strong',
  danger: 'danger',
};

export function ListRow({
  label,
  value,
  leading,
  trailing,
  tone = 'default',
  onPress,
}: ListRowProps) {
  const { color } = useTheme();
  const style: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['3'],
    minHeight: size['list-row'],
    paddingVertical: space['2'],
    paddingHorizontal: space['4'],
    backgroundColor: tone === 'selected' ? color['primary-subtle'] : 'transparent',
  };
  const content = (
    <>
      {leading}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof label === 'string' ? <Words color={rowText[tone]}>{label}</Words> : label}
      </View>
      {value === undefined ? null : typeof value === 'string' ? (
        <Words variant="callout" color="text-muted" numberOfLines={1}>
          {value}
        </Words>
      ) : (
        value
      )}
      {/* Forward is the reading direction's: `chevron-right` mirrors right-to-left. */}
      {trailing ??
        (onPress === undefined ? null : (
          <Glyph name="chevron-right" size="sm" color="text-muted" />
        ))}
    </>
  );
  if (onPress === undefined) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      cssInterop={false}
      style={({ pressed: down }) => [style, down ? { backgroundColor: color.hover } : null]}
    >
      {content}
    </Pressable>
  );
}

export function Summary({ rows }: SummaryProps) {
  const { color } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: space['4'],
        borderWidth: border.hairline,
        borderColor: color.border,
        borderRadius: radius.md,
        backgroundColor: color.surface,
      }}
    >
      {rows.map((row, index) => {
        const kind = row.kind ?? 'row';
        const total = kind === 'total';
        const emphasis = kind === 'emphasis';
        const text: TextStyle = total ? 'headline' : 'body';
        return (
          <View
            key={row.label}
            style={[
              {
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: emphasis ? 'center' : 'baseline',
                gap: space['3'],
                paddingVertical: space['3'],
              },
              index > 0 ? { borderTopWidth: border.hairline, borderTopColor: color.border } : null,
              // The highlighted row runs to the summary's edges (`.summary__row--emphasis`).
              emphasis
                ? {
                    marginHorizontal: -space['4'],
                    paddingHorizontal: space['4'],
                    backgroundColor: color['surface-strong'],
                  }
                : null,
            ]}
          >
            <Words
              variant={text}
              weight={total ? 'bold' : 'regular'}
              color={total ? 'text' : 'text-muted'}
            >
              {row.label}
            </Words>
            {typeof row.value === 'string' || typeof row.value === 'number' ? (
              <Words
                variant={emphasis ? 'title-3' : text}
                weight={total || emphasis ? 'bold' : 'medium'}
                color="text"
                align="end"
              >
                {row.value}
              </Words>
            ) : (
              row.value
            )}
          </View>
        );
      })}
    </View>
  );
}

type AvatarSize = NonNullable<AvatarProps['size']>;

const avatarInitials: Readonly<Record<AvatarSize, TextStyle>> = {
  sm: 'callout',
  md: 'body',
  touch: 'headline',
  lg: 'headline',
  xl: 'title-2',
  '2xl': 'title-1',
  '3xl': 'display',
};

const avatarTone: Readonly<
  Record<NonNullable<AvatarProps['tone']>, { background: ColorToken; text: ColorToken }>
> = {
  default: { background: 'primary-subtle', text: 'primary' },
  neutral: { background: 'surface-strong', text: 'text' },
  primary: { background: 'primary', text: 'on-primary' },
};

export function Avatar({
  initials,
  imageUri,
  size: scale = 'md',
  tone = 'default',
  speaking = false,
}: AvatarProps) {
  const { color } = useTheme();
  const diameter = media[scale as MediaSize];
  const paint = avatarTone[tone];
  return (
    <View
      style={{
        width: diameter,
        height: diameter,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: radius.full,
        backgroundColor: color[paint.background],
        boxShadow: speaking ? shadow('speaking', color) : [],
      }}
    >
      {imageUri === undefined ? (
        <Words variant={avatarInitials[scale]} weight="bold" color={paint.text}>
          {initials}
        </Words>
      ) : (
        <Image source={{ uri: imageUri }} style={{ width: diameter, height: diameter }} />
      )}
    </View>
  );
}

type TileSize = NonNullable<IconTileProps['size']>;

const tileGeometry: Readonly<Record<TileSize, { side: number; radius: number }>> = {
  sm: { side: media.sm, radius: radius.sm },
  md: { side: media.md, radius: radius.md },
  lg: { side: media.lg, radius: radius.md },
  xl: { side: media.xl, radius: radius.lg },
  '2xl': { side: media['2xl'], radius: radius.full },
};

/** `.icon-tile--*`: the tint, the icon colour and the border of each tone. */
const tileTone: Readonly<
  Record<
    NonNullable<IconTileProps['tone']>,
    { background: ColorToken; icon: ColorToken; border?: ColorToken }
  >
> = {
  default: { background: 'primary-subtle', icon: 'primary' },
  primary: { background: 'primary', icon: 'on-primary' },
  neutral: { background: 'surface', icon: 'text-muted' },
  outline: { background: 'bg', icon: 'text-muted', border: 'border-strong' },
  success: { background: 'primary-subtle', icon: 'primary' },
  warning: { background: 'warning-subtle', icon: 'warning-text' },
  danger: { background: 'danger-subtle', icon: 'danger' },
  accent: { background: 'accent-subtle', icon: 'accent-text', border: 'accent-border' },
};

export function IconTile({
  icon,
  size: scale = 'md',
  tone = 'default',
  round = false,
}: IconTileProps) {
  const { color } = useTheme();
  const geometry = tileGeometry[scale];
  const paint = tileTone[tone];
  return (
    <View
      style={{
        width: geometry.side,
        height: geometry.side,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: round ? radius.full : geometry.radius,
        backgroundColor: color[paint.background],
        ...(paint.border === undefined
          ? {}
          : { borderWidth: border.hairline, borderColor: color[paint.border] }),
      }}
    >
      <Glyph {...icon} color={paint.icon} />
    </View>
  );
}
