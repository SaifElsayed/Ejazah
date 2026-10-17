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
