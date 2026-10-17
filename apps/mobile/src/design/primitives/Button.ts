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
