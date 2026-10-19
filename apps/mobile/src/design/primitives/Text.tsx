import { Text as NativeText, type TextStyle as NativeTextStyle } from 'react-native';

import { type ColorToken, type TextStyle as Ramp } from '../tokens';
import { useTheme } from '../theme';
import { toneColor, type, weight as weights } from './style';
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

/** The steps of the ramp that are bold unless a weight is given (`.text-display` to `.text-headline`). */
const BOLD_BY_DEFAULT: ReadonlySet<Ramp> = new Set([
  'display',
  'title-1',
  'title-2',
  'title-3',
  'headline',
]);

// Unicode's isolates: the run is laid out on its own, left to right, inside either direction.
const LEFT_TO_RIGHT_ISOLATE = '⁦';
const POP_DIRECTIONAL_ISOLATE = '⁩';

const alignments: Readonly<Record<NonNullable<TextProps['align']>, NativeTextStyle>> = {
  // `auto` is the start of the reading direction; `end` moves the run to the end of its row, since
  // React Native's `textAlign` has no logical end (R-MOBILE-5).
  start: { textAlign: 'auto' },
  center: { textAlign: 'center' },
  end: { alignSelf: 'flex-end' },
};

/** The text a primitive draws in a semantic colour of its own; screens use `Text`. */
export function Words({
  variant = 'body',
  weight,
  color,
  align = 'start',
  ltr = false,
  numberOfLines,
  style,
  children,
}: Omit<TextProps, 'tone'> & {
  readonly color: ColorToken;
  readonly style?: NativeTextStyle;
}) {
  const theme = useTheme();
  const chosen = weight ?? (BOLD_BY_DEFAULT.has(variant) ? 'bold' : 'regular');
  const isolated =
    ltr && (typeof children === 'string' || typeof children === 'number')
      ? `${LEFT_TO_RIGHT_ISOLATE}${children}${POP_DIRECTIONAL_ISOLATE}`
      : children;
  return (
    <NativeText
      {...(numberOfLines === undefined ? {} : { numberOfLines })}
      style={[
        type(variant),
        { fontWeight: weights[chosen], color: theme.color[color] },
        alignments[align],
        ltr ? { writingDirection: 'ltr' } : null,
        style,
      ]}
    >
      {isolated}
    </NativeText>
  );
}

/** Text in a tone of the ramp. */
export function Text({ tone = 'default', ...props }: TextProps) {
  return <Words {...props} color={toneColor[tone]} />;
}
