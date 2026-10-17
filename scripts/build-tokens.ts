// The design-token generator (ADR 0002, ADR 0014 D1, ADR 0020). `packages/tokens/tokens.json` and
// `packages/tokens/icons.json` are the only sources; everything below is written from them and
// never edited by hand (R-PROC-9, checked by `pnpm check:generated`).
//
//   pnpm tokens:build
//
// WHAT IS WRITTEN
//
//   apps/mobile/src/design/tokens.ts           the typed token object the phone app reads
//                                               (ARCHITECTURE §6.3): resolved values, numbers in
//                                               density-independent pixels, both colour schemes
//   apps/mobile/src/design/tailwind.theme.json  the same values in Tailwind's theme shape, read
//                                               by apps/mobile/src/design/tailwind.config.js
//   apps/mobile/src/design/icons.ts             the icon names the design uses (Lucide names) and
//                                               the ones that flip with the reading direction
//   apps/admin/src/design/tokens.css            the CSS custom properties the admin panel reads
//                                               (ADR 0014): light, dark and the compact density
//   apps/admin/src/design/icons.ts              the same icon lists for the admin panel
//   docs/design/frames/ds/ijazah/tokens.json    the design canvas's copy of the source
//   docs/design/frames/ds/ijazah/tokens.css     the stylesheet the design boards load
//   docs/design/frames/ds/ijazah/icons.json     the design canvas's copy of the icon registry
//
// HOW A VALUE IS READ. A string of the form `{palette.green.600}` is an alias of another token and
// is resolved before anything is written; an alias of a missing token fails the build. The light
// and dark schemes must name the same semantic colours, in the same order, or the build fails: a
// colour that exists in one scheme only would render as nothing in the other. Lengths are `Npx`
// strings in the source; the TypeScript output carries them as numbers, the CSS output as written.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { format, resolveConfig } from 'prettier';

const repositoryRoot = join(__dirname, '..');

export const TOKENS_SOURCE = 'packages/tokens/tokens.json';
export const ICONS_SOURCE = 'packages/tokens/icons.json';

/** Every file this generator writes, relative to the repository root, in a fixed order. */
export const GENERATED_FILES = [
  'apps/mobile/src/design/tokens.ts',
  'apps/mobile/src/design/tailwind.theme.json',
  'apps/mobile/src/design/icons.ts',
  'apps/admin/src/design/tokens.css',
  'apps/admin/src/design/icons.ts',
  'docs/design/frames/ds/ijazah/tokens.json',
  'docs/design/frames/ds/ijazah/tokens.css',
  'docs/design/frames/ds/ijazah/icons.json',
] as const;

export type GeneratedPath = (typeof GENERATED_FILES)[number];

type Scalar = string;
type Group = Readonly<Record<string, Scalar>>;

/** The shape of `packages/tokens/tokens.json`. Keys beginning with `$` are documentation. */
export interface TokenSource {
  readonly palette: Readonly<Record<string, Group>>;
  readonly color: { readonly light: Group; readonly dark: Group };
  readonly space: Group;
  readonly radius: Group;
  readonly 'border-width': Group;
  readonly font: { readonly family: Group; readonly weight: Group };
  readonly text: Readonly<Record<string, { readonly size: Scalar; readonly line: Scalar }>>;
  readonly size: Group;
  readonly media: Group;
  readonly icon: { readonly size: Group; readonly stroke: Group };
  readonly shadow: Group;
  readonly opacity: Group;
  readonly duration: Group;
  readonly layout: Group;
  readonly easing: Group;
  readonly motion: Group;
  readonly density: { readonly compact: Group };
}

/** The shape of `packages/tokens/icons.json`: Lucide name → the SVG drawing. */
export type IconSource = Readonly<Record<string, string>>;

/** Icons that point along the reading direction and therefore mirror in RTL (design.md). */
export const DIRECTIONAL_ICONS = [
  'chevron-right',
  'chevron-left',
  'arrow-left',
  'log-out',
  'external-link',
  'rotate-ccw',
] as const;

const ALIAS = /^\{(.+)\}$/;

function lookup(source: TokenSource, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (typeof node !== 'object' || node === null) return undefined;
    return Reflect.get(node, key);
  }, source);
}

/** The token's final value, with every alias followed; an alias that leads nowhere is an error. */
export function resolve(source: TokenSource, value: Scalar, seen: readonly string[] = []): Scalar {
  const alias = ALIAS.exec(value);
  if (alias === null) return value;
  const path = alias[1] ?? '';
  if (seen.includes(path)) throw new Error(`tokens: alias cycle through {${path}}`);
  const target = lookup(source, path);
  if (typeof target !== 'string') throw new Error(`tokens: {${path}} names no token`);
  return resolve(source, target, [...seen, path]);
}

function entries(group: Group): [string, Scalar][] {
  return Object.entries(group).filter(([key]) => !key.startsWith('$'));
}

/** Refuses a source whose two colour schemes do not name the same semantic colours. */
export function checkSchemes(source: TokenSource): void {
  const light = entries(source.color.light).map(([key]) => key);
  const dark = entries(source.color.dark).map(([key]) => key);
  if (light.join(',') !== dark.join(',')) {
    throw new Error(
      'tokens: light and dark must define the same semantic colours, in the same order',
    );
  }
}

const PX = /^(-?\d+(?:\.\d+)?)px$/;
const MS = /^(\d+(?:\.\d+)?)ms$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const BEZIER = /^cubic-bezier\(([^)]+)\)$/;

/** `12px` → 12, `120ms` → 120, `0.6` → 0.6; anything else stays a string. */
export function toNumber(value: Scalar): number | Scalar {
  const px = PX.exec(value);
  if (px !== null) return Number(px[1]);
  const ms = MS.exec(value);
  if (ms !== null) return Number(ms[1]);
  if (NUMBER.test(value)) return Number(value);
  return value;
}

function literal(value: number | string | readonly number[]): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
  return `[${value.join(', ')}]`;
}

/** The lines of one `key: value,` block, two-space indented under `depth`. */
function block(depth: number, pairs: readonly (readonly [string, string])[]): string {
  const pad = '  '.repeat(depth);
  return pairs.map(([key, value]) => `${pad}${quoteKey(key)}: ${value},`).join('\n');
}

function quoteKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `'${key}'`;
}

interface ShadowLayer {
  readonly inset: boolean;
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
}

/**
 * A CSS `box-shadow` as layers the phone app can map onto its own shadow model. A colour written as
 * `var(--color-NAME)` is kept as the semantic colour's name, so the app looks it up in its scheme.
 */
export function parseShadow(value: Scalar): ShadowLayer[] {
  return splitTopLevel(value).map((layer) => {
    const parts = layer.trim().split(/\s+(?![^(]*\))/);
    const inset = parts.includes('inset');
    const lengths = parts
      .filter((part) => PX.test(part) || part === '0')
      .map((part) => Number(toNumber(part)));
    const color =
      parts.find((part) => !PX.test(part) && part !== '0' && part !== 'inset') ?? 'transparent';
    const variable = /^var\(--color-([a-z0-9-]+)\)$/.exec(color);
    return {
      inset,
      x: lengths[0] ?? 0,
      y: lengths[1] ?? 0,
      blur: lengths[2] ?? 0,
      spread: lengths[3] ?? 0,
      color: variable === null ? color : `{color.${variable[1] ?? ''}}`,
    };
  });
}

function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += char;
  }
  out.push(current);
  return out;
}

function shadowLiteral(layers: readonly ShadowLayer[], depth: number): string {
  const pad = '  '.repeat(depth);
  const inner = layers
    .map(
      (l) =>
        `${pad}  { inset: ${l.inset}, x: ${l.x}, y: ${l.y}, blur: ${l.blur}, spread: ${l.spread}, color: ${literal(l.color)} },`,
    )
    .join('\n');
  return `[\n${inner}\n${pad}]`;
}

/** `apps/mobile/src/design/tokens.ts`: the typed, resolved token object. */
export function renderTokensTs(source: TokenSource): string {
  checkSchemes(source);
  const r = (value: Scalar): Scalar => resolve(source, value);
  const num = (value: Scalar): string => literal(toNumber(r(value)));
  const str = (value: Scalar): string => literal(r(value));
  const groupNum = (group: Group): string =>
    block(
      2,
      entries(group).map(([key, value]) => [key, num(value)] as const),
    );
  const groupStr = (group: Group, depth = 2): string =>
    block(
      depth,
      entries(group).map(([key, value]) => [key, str(value)] as const),
    );
  const palette = Object.entries(source.palette)
    .filter(([key]) => !key.startsWith('$'))
    .map(([family, steps]) => `    ${quoteKey(family)}: {\n${groupStr(steps, 3)}\n    },`)
    .join('\n');
  const text = Object.entries(source.text)
    .filter(([key]) => !key.startsWith('$'))
    .map(([style, { size, line }]) => {
      const sizePx = Number(toNumber(r(size)));
      const ratio = Number(toNumber(r(line)));
      const lineHeight = Math.round(sizePx * ratio * 100) / 100;
      return `    ${quoteKey(style)}: { size: ${sizePx}, line: ${ratio}, lineHeight: ${lineHeight} },`;
    })
    .join('\n');
  const shadows = entries(source.shadow)
    .map(([key, value]) => `    ${quoteKey(key)}: ${shadowLiteral(parseShadow(r(value)), 2)},`)
    .join('\n');
  const easing = entries(source.easing)
    .map(([key, value]) => {
      const bezier = BEZIER.exec(r(value));
      const points = (bezier?.[1] ?? '').split(',').map((point) => Number(point.trim()));
      return `    ${quoteKey(key)}: ${literal(points)},`;
    })
    .join('\n');
  return `// GENERATED from ${TOKENS_SOURCE} by scripts/build-tokens.ts. Do not edit; run \`pnpm tokens:build\`.
//
// THE source of colour, spacing, radii, typography, sizes and motion for the phone app
// (ARCHITECTURE §6.3, ADR 0002, ADR 0020). A raw colour or spacing literal never appears in a
// feature file; lint refuses it (R-MOBILE-4). Lengths are density-independent pixels, durations
// are milliseconds, \`text.*.lineHeight\` is the pixel line height React Native needs, and a
// shadow colour written \`{color.NAME}\` is the semantic colour of the active scheme.
//
// Components consume \`color.light\` / \`color.dark\` (the semantic colours) through the theme
// provider, never \`palette\` directly (design.md).
export const tokens = {
  palette: {
${palette}
  },
  color: {
    light: {
${groupStr(source.color.light, 3)}
    },
    dark: {
${groupStr(source.color.dark, 3)}
    },
  },
  space: {
${groupNum(source.space)}
  },
  radius: {
${groupNum(source.radius)}
  },
  borderWidth: {
${groupNum(source['border-width'])}
  },
  font: {
    family: {
${groupStr(source.font.family, 3)}
    },
    weight: {
${groupStr(source.font.weight, 3)}
    },
  },
  text: {
${text}
  },
  size: {
${groupNum(source.size)}
  },
  media: {
${groupNum(source.media)}
  },
  icon: {
    size: {
${block(
  3,
  entries(source.icon.size).map(([key, value]) => [key, num(value)] as const),
)}
    },
    stroke: {
${block(
  3,
  entries(source.icon.stroke).map(([key, value]) => [key, num(value)] as const),
)}
    },
  },
  shadow: {
${shadows}
  },
  opacity: {
${groupNum(source.opacity)}
  },
  duration: {
${groupNum(source.duration)}
  },
  easing: {
${easing}
  },
  motion: {
${groupNum(source.motion)}
  },
  layout: {
${groupNum(source.layout)}
  },
  density: {
    compact: {
${block(
  3,
  entries(source.density.compact).map(([key, value]) => [key, num(value)] as const),
)}
    },
  },
} as const;

export type Tokens = typeof tokens;
export type ColorScheme = keyof Tokens['color'];
/** A semantic colour name: the only kind a component may ask the theme for. */
export type ColorToken = keyof Tokens['color']['light'];
export type SpaceToken = keyof Tokens['space'];
export type RadiusToken = keyof Tokens['radius'];
export type TextStyle = keyof Tokens['text'];
export type FontWeight = keyof Tokens['font']['weight'];
export type IconSize = keyof Tokens['icon']['size'];
export type MediaSize = keyof Tokens['media'];
`;
}

/** The CSS custom properties, in the order the design stylesheet has always declared them. */
function cssDeclarations(source: TokenSource): {
  light: string[];
  dark: string[];
  compact: string[];
} {
  checkSchemes(source);
  const r = (value: Scalar): Scalar => resolve(source, value);
  const light: string[] = [];
  const dark: string[] = [];
  const compact: string[] = [];
  const add = (into: string[], name: string, value: Scalar): void => {
    into.push(`  --${name}: ${r(value)};`);
  };
  for (const [family, steps] of Object.entries(source.palette)) {
    if (family.startsWith('$')) continue;
    for (const [key, value] of entries(steps)) add(light, `palette-${family}-${key}`, value);
  }
  for (const [key, value] of entries(source.color.light)) add(light, `color-${key}`, value);
  for (const [key, value] of entries(source.color.dark)) add(dark, `color-${key}`, value);
  for (const [key, value] of entries(source.space)) add(light, `space-${key}`, value);
  for (const [key, value] of entries(source.radius)) add(light, `radius-${key}`, value);
  for (const [key, value] of entries(source['border-width'])) add(light, `border-${key}`, value);
  for (const [key, value] of entries(source.font.family)) add(light, `font-${key}`, value);
  for (const [key, value] of entries(source.font.weight)) add(light, `weight-${key}`, value);
  for (const [key, style] of Object.entries(source.text)) {
    if (key.startsWith('$')) continue;
    add(light, `text-${key}-size`, style.size);
    add(light, `text-${key}-line`, style.line);
  }
  for (const [key, value] of entries(source.size)) add(light, `size-${key}`, value);
  for (const [key, value] of entries(source.media)) add(light, `media-${key}`, value);
  for (const [key, value] of entries(source.icon.size)) add(light, `icon-${key}`, value);
  for (const [key, value] of entries(source.icon.stroke)) add(light, `stroke-${key}`, value);
  for (const [key, value] of entries(source.shadow)) add(light, `shadow-${key}`, value);
  for (const [key, value] of entries(source.opacity)) add(light, `opacity-${key}`, value);
  for (const [key, value] of entries(source.duration)) add(light, `duration-${key}`, value);
  for (const [key, value] of entries(source.easing)) add(light, `easing-${key}`, value);
  for (const [key, value] of entries(source.motion)) add(light, `motion-${key}`, value);
  for (const [key, value] of entries(source.density.compact))
    add(compact, key.replace('.', '-'), value);
  for (const [key, value] of entries(source.layout)) add(light, `layout-${key}`, value);
  return { light, dark, compact };
}

/** `tokens.css`: `:root`/light, dark and the compact density, for the admin panel and the boards. */
export function renderTokensCss(source: TokenSource): string {
  const { light, dark, compact } = cssDeclarations(source);
  return `/* GENERATED from ${TOKENS_SOURCE} by scripts/build-tokens.ts. Do not edit; run \`pnpm tokens:build\`. */
:root,
[data-theme="light"] {
${light.join('\n')}
}

[data-theme="dark"] {
${dark.join('\n')}
}

[data-density="compact"] {
${compact.join('\n')}
}
`;
}

/** `tailwind.theme.json`: the token values in the shape `tailwind.config.js` spreads into `theme`. */
export function renderTailwindTheme(source: TokenSource): string {
  checkSchemes(source);
  const r = (value: Scalar): Scalar => resolve(source, value);
  const map = (group: Group): Record<string, string> =>
    Object.fromEntries(entries(group).map(([key, value]) => [key, r(value)]));
  const theme = {
    $generated: `from ${TOKENS_SOURCE} by scripts/build-tokens.ts; do not edit`,
    colors: { light: map(source.color.light), dark: map(source.color.dark) },
    spacing: map(source.space),
    borderRadius: map(source.radius),
    borderWidth: map(source['border-width']),
    fontFamily: map(source.font.family),
    fontWeight: map(source.font.weight),
    fontSize: Object.fromEntries(
      Object.entries(source.text)
        .filter(([key]) => !key.startsWith('$'))
        .map(([key, style]) => [key, [r(style.size), { lineHeight: r(style.line) }]]),
    ),
    size: map(source.size),
    media: map(source.media),
    iconSize: map(source.icon.size),
    strokeWidth: map(source.icon.stroke),
    boxShadow: map(source.shadow),
    opacity: map(source.opacity),
    transitionDuration: map(source.duration),
    transitionTimingFunction: map(source.easing),
    motion: map(source.motion),
    layout: map(source.layout),
    density: { compact: map(source.density.compact) },
  };
  return `${JSON.stringify(theme, null, 2)}\n`;
}

/** The icon names in registry order, documentation keys left out. */
export function iconNames(icons: IconSource): string[] {
  return Object.keys(icons).filter((key) => !key.startsWith('$'));
}

/** `icons.ts`: the icon names the design uses and the ones that mirror in RTL. */
export function renderIconsTs(icons: IconSource, consumer: 'mobile' | 'admin'): string {
  const names = iconNames(icons);
  const missing = DIRECTIONAL_ICONS.filter((name) => !names.includes(name));
  if (missing.length > 0)
    throw new Error(`icons: directional icon not in the registry: ${missing.join(', ')}`);
  const list = names.map((name) => `  '${name}',`).join('\n');
  const directional = DIRECTIONAL_ICONS.map((name) => `  '${name}',`).join('\n');
  const rule =
    consumer === 'mobile'
      ? 'Directional icons flip through useDirection() (lib/direction.ts), never by hand (R-MOBILE-5).'
      : 'Directional icons mirror under [dir="rtl"] through the stylesheet, never by hand.';
  return `// GENERATED from ${ICONS_SOURCE} by scripts/build-tokens.ts. Do not edit; run \`pnpm tokens:build\`.
//
// Every icon the design draws, by its Lucide name (lucide.dev). A screen uses an icon by one of
// these names and nothing else; a name outside this list is a design change first. \`apple\` and
// \`google\` are the two brand marks the sign-in buttons require, drawn solid.
// ${rule}
export const iconNames = [
${list}
] as const;

export type IconName = (typeof iconNames)[number];

/** Icons that point along the reading direction: mirrored when the layout is right-to-left. */
export const directionalIcons = [
${directional}
] as const satisfies readonly IconName[];
`;
}

/** Runs the repository's Prettier configuration over a generated TypeScript file. */
async function formatted(root: string, path: string, text: string): Promise<string> {
  const options = (await resolveConfig(join(root, path))) ?? {};
  return format(text, { ...options, filepath: join(root, path) });
}

/** Every generated file's text, keyed by its path, from the two sources. */
export async function generate(
  root: string,
  source: TokenSource,
  icons: IconSource,
  sourceText: string,
  iconsText: string,
): Promise<Record<GeneratedPath, string>> {
  const css = renderTokensCss(source);
  const ts = async (path: GeneratedPath, text: string): Promise<string> =>
    formatted(root, path, text);
  return {
    'apps/mobile/src/design/tokens.ts': await ts(
      'apps/mobile/src/design/tokens.ts',
      renderTokensTs(source),
    ),
    'apps/mobile/src/design/tailwind.theme.json': renderTailwindTheme(source),
    'apps/mobile/src/design/icons.ts': await ts(
      'apps/mobile/src/design/icons.ts',
      renderIconsTs(icons, 'mobile'),
    ),
    'apps/admin/src/design/tokens.css': css,
    'apps/admin/src/design/icons.ts': await ts(
      'apps/admin/src/design/icons.ts',
      renderIconsTs(icons, 'admin'),
    ),
    'docs/design/frames/ds/ijazah/tokens.json': sourceText,
    'docs/design/frames/ds/ijazah/tokens.css': css,
    'docs/design/frames/ds/ijazah/icons.json': iconsText,
  };
}

/** Reads the two sources under `root` and returns everything they generate. */
export function generateFromRepository(root: string): Promise<Record<GeneratedPath, string>> {
  const sourceText = readFileSync(join(root, TOKENS_SOURCE), 'utf8');
  const iconsText = readFileSync(join(root, ICONS_SOURCE), 'utf8');
  const source: unknown = JSON.parse(sourceText);
  const icons: unknown = JSON.parse(iconsText);
  if (typeof source !== 'object' || source === null)
    throw new Error(`${TOKENS_SOURCE} is not an object`);
  if (typeof icons !== 'object' || icons === null)
    throw new Error(`${ICONS_SOURCE} is not an object`);
  return generate(root, source as TokenSource, icons as IconSource, sourceText, iconsText);
}

async function main(): Promise<void> {
  const files = await generateFromRepository(repositoryRoot);
  for (const path of GENERATED_FILES) {
    writeFileSync(join(repositoryRoot, path), files[path]);
    process.stdout.write(`tokens: wrote ${path}\n`);
  }
}

// Run as a command (`pnpm tokens:build`, tsx), never when a test or the generated-file check imports
// this file.
if (basename(process.argv[1] ?? '') === 'build-tokens.ts') {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 2;
  });
}
