// T036: Badge, Banner, Toast, Skeleton, EmptyState (docs/design/components.md, "Primitives";
// design `.badge`, `.banner`, `.toast`, `.skeleton`, `.empty-state`).
import clsx from 'clsx';

import { Button } from './Button';
import { IconTile } from './Containers';
import { Icon } from './Icon';
import type { Content, IconSpec, Press, StatusTone } from './types';

export interface BadgeProps {
  readonly label: string;
  /** `accent` is gold: ijazah and isnad only. */
  readonly tone: StatusTone | 'on-primary';
  readonly icon?: IconSpec;
}

export function Badge({ label, tone, icon }: BadgeProps) {
  return (
    <span className={clsx('badge', `badge--${tone}`)}>
      {icon === undefined ? null : <Icon {...icon} size={icon.size ?? 'xs'} />}
      {label}
    </span>
  );
}

export interface BannerProps {
  readonly icon: IconSpec;
  readonly children: Content;
  /** Neutral by default; `danger` is announced at once (an error after an action). */
  readonly tone?: 'neutral' | 'plain' | 'info' | 'success' | 'warning' | 'danger';
}

export function Banner({ icon, children, tone = 'neutral' }: BannerProps) {
  return (
    <div
      className={clsx('banner', tone !== 'neutral' && `banner--${tone}`)}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <Icon {...icon} size={icon.size ?? 'sm'} />
      <span>{children}</span>
    </div>
  );
}

export interface ToastProps {
  readonly message: string;
  readonly icon?: IconSpec;
}

/** A confirmation after an action, announced politely; the screen decides how long it stays. */
export function Toast({ message, icon }: ToastProps) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {icon === undefined ? null : <Icon {...icon} size={icon.size ?? 'sm'} />}
      {message}
    </div>
  );
}

export interface SkeletonProps {
  readonly shape: 'text' | 'title' | 'avatar' | 'block';
  readonly width?: '1/3' | '1/2' | '2/3' | 'full';
}

/** A loading shape instead of a blank. */
export function Skeleton({ shape, width = 'full' }: SkeletonProps) {
  return (
    <span
      className={clsx(
        'skeleton',
        `skeleton--${shape}`,
        width !== 'full' && `skeleton--w-${width.replace('/', '-')}`,
      )}
      aria-hidden="true"
    />
  );
}

export interface EmptyStateProps {
  readonly icon: IconSpec;
  readonly title: string;
  readonly text?: string;
  readonly action?: { readonly label: string; readonly onPress: Press };
}

/** What is missing, why, and the one next step. */
export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <IconTile icon={icon} size="lg" tone="neutral" />
      <span className="empty-state__title">{title}</span>
      {text === undefined ? null : <span className="empty-state__text">{text}</span>}
      {action === undefined ? null : (
        <Button label={action.label} variant="secondary" onPress={action.onPress} />
      )}
    </div>
  );
}
