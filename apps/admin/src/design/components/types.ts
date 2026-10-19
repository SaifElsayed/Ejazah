// T036: the shared vocabulary of the admin panel's components. The panel implements the phone's
// contracts (docs/design/components.md, `apps/mobile/src/design/primitives/types.ts`; ADR 0014 D1)
// with the same prop names, so a contract reads the same on both; the web adds only what a pointer
// and an address bar need (an `href` beside `onPress`, Escape on a dialog).
import type { ReactNode } from 'react';

import type { IconName } from '../icons';

/** A rendered child (text, an element, a list of them). */
export type Content = ReactNode;

/** A press handler. Never receives the event: a component decides what a press means. */
export type Press = () => void;

/** The colour role of a piece of text or an icon: a `tone-*` class of components.css. */
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

/** An icon size token (`icon.size`), drawn by the `icon--<size>` class. */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** An icon by its registry name, at a token size, drawn as the design draws it. */
export interface IconSpec {
  readonly name: IconName;
  readonly size?: IconSize;
  /** Stroke weight: regular by default; medium for selected items and checks; heavy for small checks. */
  readonly stroke?: 'regular' | 'medium' | 'heavy';
  /** Filled drawing (rating stars) or solid brand mark (`apple`, `google`). */
  readonly fill?: 'none' | 'filled' | 'solid';
}

/** What a screen reader announces. Required wherever the control has no visible label. */
export interface Accessible {
  readonly accessibilityLabel?: string;
}

export type { IconName };
