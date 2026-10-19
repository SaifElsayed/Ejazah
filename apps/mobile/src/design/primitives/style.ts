// T032: the token readings every primitive shares (R-MOBILE-4). A primitive takes its sizes,
// spaces, radii, type and colours from here, which reads `tokens.ts`, so changing a token is one
// line in `packages/tokens/tokens.json` and one `pnpm tokens:build`.
import { type ColorToken, type TextStyle, tokens } from '../tokens';
import type { Tone } from './types';

export const { space, radius, size, media, opacity, layout, motion, duration, easing } = tokens;
export const border = tokens.borderWidth;
export const weight = tokens.font.weight;

/** A step of the type ramp: its size and its pixel line height. */
export function type(variant: TextStyle): { fontSize: number; lineHeight: number } {
  return { fontSize: tokens.text[variant].size, lineHeight: tokens.text[variant].lineHeight };
}

/** The semantic colour each text tone reads (`.tone-*` in components.css). */
export const toneColor: Readonly<Record<Tone, ColorToken>> = {
  default: 'text',
  muted: 'text-muted',
  subtle: 'text-subtle',
  primary: 'primary',
  success: 'primary-strong',
  accent: 'accent-text',
  warning: 'warning-text',
  danger: 'danger',
  'on-primary': 'on-primary',
  'on-primary-muted': 'on-primary-muted',
};

type Colours = Readonly<Record<ColorToken, string>>;

/**
 * A shadow token as React Native's `boxShadow`; a layer whose colour names a semantic colour
 * (`{color.focus-ring}`) takes it from the scheme in force.
 */
export function shadow(name: keyof typeof tokens.shadow, colours: Colours) {
  return tokens.shadow[name].map((layer) => ({
    offsetX: layer.x,
    offsetY: layer.y,
    blurRadius: layer.blur,
    spreadDistance: layer.spread,
    inset: layer.inset,
    color: resolveColour(layer.color, colours),
  }));
}

function resolveColour(value: string, colours: Colours): string {
  const named = /^\{color\.(.+)\}$/.exec(value)?.[1];
  return named === undefined ? value : colours[named as ColorToken];
}

/** The pressed state of every control: `motion.press-scale`. */
export const pressed = { transform: [{ scale: tokens.motion['press-scale'] }] };
