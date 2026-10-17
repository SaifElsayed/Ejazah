import type { Accessible, IconSpec, Tone } from './types';

/**
 * Icon: an inline Lucide drawing at a token size. Decorative by default (hidden from the screen
 * reader); a label makes it announced. A directional icon (`directionalIcons` in icons.ts)
 * mirrors through useDirection(), never by hand (R-MOBILE-14). Design: `.icon`, `.icon--*`.
 */
export interface IconProps extends IconSpec, Accessible {
  readonly tone?: Tone;
}
