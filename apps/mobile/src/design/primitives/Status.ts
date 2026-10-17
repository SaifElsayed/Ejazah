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
