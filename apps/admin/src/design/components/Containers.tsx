// T036: Card, List with ListRow, Summary, Avatar, IconTile (docs/design/components.md, "Primitives";
// design `.card`, `.list`, `.summary`, `.avatar`, `.icon-tile`).
import clsx from 'clsx';

import { Icon } from './Icon';
import type { Content, IconSpec, Press, StatusTone } from './types';

export interface CardProps {
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
  /** A card that can be pressed is a button. */
  readonly onPress?: Press;
  readonly children: Content;
}

export function Card({ variant = 'default', onPress, children }: CardProps) {
  const className = clsx('card', variant !== 'default' && `card--${variant}`);
  if (onPress === undefined) return <div className={className}>{children}</div>;
  return (
    <button type="button" className={className} onClick={onPress}>
      {children}
    </button>
  );
}

export interface ListProps {
  readonly header?: string;
  readonly children: Content;
}

/** Grouped rows. */
export function List({ header, children }: ListProps) {
  return (
    <div className="list">
      {header === undefined ? null : <div className="list__header">{header}</div>}
      {children}
    </div>
  );
}

export interface ListRowProps {
  readonly label: Content;
  /** Drawn at the end of the row, muted. */
  readonly value?: Content;
  readonly leading?: Content;
  readonly trailing?: Content;
  readonly tone?: 'default' | 'selected' | 'danger';
  /** A row that can be pressed is a button. */
  readonly onPress?: Press;
}

export function ListRow({
  label,
  value,
  leading,
  trailing,
  tone = 'default',
  onPress,
}: ListRowProps) {
  const className = clsx('list__row', tone !== 'default' && `list__row--${tone}`);
  const content = (
    <>
      {leading}
      <span>{label}</span>
      {value === undefined ? null : <span className="list__value">{value}</span>}
      {trailing}
    </>
  );
  if (onPress === undefined) return <div className={className}>{content}</div>;
  return (
    <button type="button" className={className} onClick={onPress}>
      {content}
    </button>
  );
}

export interface SummaryProps {
  readonly rows: readonly {
    readonly label: string;
    readonly value: Content;
    readonly kind?: 'row' | 'total' | 'emphasis';
  }[];
}

/** Label and value rows. */
export function Summary({ rows }: SummaryProps) {
  return (
    <div className="summary">
      {rows.map((row) => (
        <div
          key={row.label}
          className={clsx(
            'summary__row',
            row.kind !== undefined && row.kind !== 'row' && `summary__row--${row.kind}`,
          )}
        >
          <span className="summary__label">{row.label}</span>
          <span className="summary__value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface AvatarProps {
  /** Shown when there is no photo. */
  readonly initials: string;
  readonly imageUri?: string;
  readonly size?: 'sm' | 'md' | 'touch' | 'lg' | 'xl' | '2xl' | '3xl';
  readonly tone?: 'default' | 'neutral' | 'primary';
  readonly speaking?: boolean;
}

/** A person, always round. Decorative: the person's name is always written beside it. */
export function Avatar({
  initials,
  imageUri,
  size = 'md',
  tone = 'default',
  speaking = false,
}: AvatarProps) {
  return (
    <span
      className={clsx(
        'avatar',
        size !== 'md' && `avatar--${size}`,
        tone !== 'default' && `avatar--${tone}`,
        speaking && 'avatar--speaking',
      )}
      aria-hidden="true"
    >
      {imageUri === undefined ? initials : <img src={imageUri} alt="" />}
    </span>
  );
}

export interface IconTileProps {
  readonly icon: IconSpec;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** The default tile is the primary tint; `success` is the same tint. */
  readonly tone?: StatusTone | 'primary' | 'outline' | 'default';
  readonly round?: boolean;
}

/** A thing: an icon in a tinted square. */
export function IconTile({ icon, size = 'md', tone = 'default', round = false }: IconTileProps) {
  return (
    <span
      className={clsx(
        'icon-tile',
        size !== 'md' && `icon-tile--${size}`,
        tone !== 'default' && tone !== 'success' && `icon-tile--${tone}`,
        round && 'icon-tile--round',
      )}
    >
      <Icon {...icon} />
    </span>
  );
}
