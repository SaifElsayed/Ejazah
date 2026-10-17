// Shared vocabulary of the primitive contracts (docs/design/components.md, ADR 0020). These files
// are the CONTRACTS: the props a primitive accepts and the decisions it refuses to delegate. The
// implementations arrive with Phase 1 and must satisfy them without widening them.
import type { IconName } from '../icons';
import type { ColorToken, IconSize, MediaSize, TextStyle } from '../tokens';

/**
 * A rendered child (text, an element, a list of them). Stands for React's `ReactNode` until the
 * React types are installed with Phase 1; nothing in a contract depends on anything narrower.
 */
export type Content = unknown;

/** A press handler. Never receives the event: a primitive decides what a press means. */
export type Press = () => void;

/** The colour role of a piece of text or an icon. Every value is a semantic colour (design.md). */
export type Tone =
  | 'default'
  | 'muted'
  | 'subtle'
  | 'primary'
  | 'success'
  | 'accent'
  | 'warning'
  | 'danger'
  | 'on-primary'
  | 'on-primary-muted';

/** The status tone of a surface (Badge, Banner, IconTile). `accent` is gold: ijazah and isnad only. */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

/** An icon by its registry name, at a token size, drawn as the design draws it. */
export interface IconSpec {
  readonly name: IconName;
  readonly size?: IconSize;
  /** Stroke weight: regular (1.75) by default; medium for selected tabs and checks; heavy for small checks. */
  readonly stroke?: 'regular' | 'medium' | 'heavy';
  /** Filled drawing (rating stars) or solid brand mark (`apple`, `google`). */
  readonly fill?: 'none' | 'filled' | 'solid';
}

/** Accessibility: what a screen reader announces. Required wherever the control has no visible label. */
export interface Accessible {
  readonly accessibilityLabel?: string;
}

export type { ColorToken, IconName, IconSize, MediaSize, TextStyle };
