import type { Content, Tone } from './types';

/**
 * Text: every run of text on a screen. Picks the Arabic or Latin face from the active locale and
 * the Quranic face for `ayah`; no screen sets a font family, a size or a colour (R-MOBILE-4).
 * Design: `.text-*`, `.tone-*`, `.ltr` in components.css.
 */
export interface TextProps {
  /** The ramp: display 32, title-1 24, title-2 20, title-3 18, headline 16, body-lg 16, body 14, callout 13, caption 12, micro 11, ayah 24. */
  readonly variant?:
    | 'display'
    | 'title-1'
    | 'title-2'
    | 'title-3'
    | 'headline'
    | 'body-lg'
    | 'body'
    | 'callout'
    | 'caption'
    | 'micro'
    | 'ayah';
  readonly weight?: 'regular' | 'medium' | 'bold';
  readonly tone?: Tone;
  readonly align?: 'start' | 'center' | 'end';
  /** An LTR run inside Arabic: an email, a certificate number, an order reference. Isolated, never mirrored. */
  readonly ltr?: boolean;
  readonly numberOfLines?: number;
  readonly children: Content;
}
