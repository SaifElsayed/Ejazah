import { View } from 'react-native';

import { useDirection } from '../../lib/direction';
import { type ColorToken, tokens } from '../tokens';
import { useTheme } from '../theme';
import { BrandGlyph, lucideGlyphs } from './glyphs';
import { toneColor } from './style';
import type { Accessible, IconSpec, Tone } from './types';

/**
 * Icon: an inline Lucide drawing at a token size. Decorative by default (hidden from the screen
 * reader); a label makes it announced. A directional icon (`directionalIcons` in icons.ts)
 * mirrors through useDirection(), never by hand (R-MOBILE-14). Design: `.icon`, `.icon--*`.
 */
export interface IconProps extends IconSpec, Accessible {
  readonly tone?: Tone;
}

const MIRRORED = { transform: [{ scaleX: -1 }] };

/** An icon in a semantic colour of the primitive's own; screens use `Icon`. */
export function Glyph({
  name,
  size = 'md',
  stroke = 'regular',
  fill = 'none',
  color,
  accessibilityLabel,
}: IconSpec & Accessible & { readonly color: ColorToken }) {
  const theme = useTheme();
  const { mirrors } = useDirection();
  const pixels = tokens.icon.size[size];
  const drawn = theme.color[color];
  const glyph =
    name === 'apple' || name === 'google' ? (
      <BrandGlyph name={name} size={pixels} color={drawn} colours={theme.color} />
    ) : (
      (() => {
        const Drawing = lucideGlyphs[name];
        return (
          <Drawing
            size={pixels}
            color={drawn}
            strokeWidth={tokens.icon.stroke[stroke]}
            fill={fill === 'none' ? 'none' : drawn}
          />
        );
      })()
    );
  const announced = accessibilityLabel !== undefined;
  return (
    <View
      style={mirrors(name) ? MIRRORED : null}
      {...(announced
        ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
        : {
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          })}
    >
      {glyph}
    </View>
  );
}

/** An icon in a tone. */
export function Icon({ tone = 'default', ...props }: IconProps) {
  return <Glyph {...props} color={toneColor[tone]} />;
}
