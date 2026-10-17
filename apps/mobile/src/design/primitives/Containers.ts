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
