// ADR 0020 — the design-token generator. `packages/tokens/tokens.json` and `icons.json` are the
// only sources; `scripts/build-tokens.ts` writes every token file the two apps and the design
// boards read. These cases hold the generator's rules: an alias resolves to its target, an alias
// that leads nowhere or cycles fails, the two colour schemes must match, lengths become numbers for
// the phone app and stay as written for CSS, a shadow becomes layers the app can map, and a
// directional icon must exist in the registry.
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import {
  DIRECTIONAL_ICONS,
  GENERATED_FILES,
  checkSchemes,
  generate,
  generateFromRepository,
  iconNames,
  parseShadow,
  renderIconsTs,
  renderTokensCss,
  renderTokensTs,
  resolve,
  toNumber,
  type IconSource,
  type TokenSource,
} from '../../scripts/build-tokens';

const root = join(__dirname, '..', '..');

/** The smallest source the generator accepts, with one alias in each scheme. */
function source(overrides: Partial<TokenSource> = {}): TokenSource {
  return {
    palette: { green: { '600': '#2f7a56' }, neutral: { '0': '#ffffff', '950': '#141412' } },
    color: {
      light: { bg: '{palette.neutral.0}', primary: '{palette.green.600}' },
      dark: { bg: '{palette.neutral.950}', primary: '{palette.green.600}' },
    },
    space: { '1': '4px', half: '2px' },
    radius: { md: '12px' },
    'border-width': { hairline: '1px' },
    font: { family: { arabic: "'IBM Plex Sans Arabic', sans-serif" }, weight: { bold: '700' } },
    text: { body: { size: '14px', line: '1.7' } },
    size: { touch: '44px' },
    media: { md: '40px' },
    icon: { size: { md: '20px' }, stroke: { regular: '1.75' } },
    shadow: { sm: '0 1px 3px rgba(28, 28, 26, 0.1)', focus: '0 0 0 3px var(--color-primary)' },
    opacity: { disabled: '0.5' },
    duration: { fast: '120ms' },
    layout: { gutter: '20px' },
    easing: { standard: 'cubic-bezier(0.2, 0, 0, 1)' },
    motion: { 'press-scale': '0.98' },
    density: { compact: { 'size.touch': '36px' } },
    ...overrides,
  };
}

const icons: IconSource = Object.fromEntries([
  ['$description', 'registry'],
  ...DIRECTIONAL_ICONS.map((name) => [name, '<path d="M0 0" />']),
  ['star', '<path d="M1 1" />'],
]);

describe('aliases', () => {
  it('resolves an alias to the token it names, through a chain', () => {
    const chained = source({
      color: { light: { bg: '{color.dark.bg}' }, dark: { bg: '{palette.neutral.950}' } },
    });
    expect(resolve(chained, '{color.light.bg}')).toBe('#141412');
  });

  it('leaves a plain value as it is', () => {
    expect(resolve(source(), '#abcdef')).toBe('#abcdef');
  });

  it('fails an alias that names no token', () => {
    expect(() => resolve(source(), '{palette.blue.500}')).toThrow('names no token');
  });

  it('fails an alias cycle', () => {
    const cyclic = source({
      color: { light: { bg: '{color.dark.bg}' }, dark: { bg: '{color.light.bg}' } },
    });
    expect(() => resolve(cyclic, '{color.light.bg}')).toThrow('alias cycle');
  });
});

describe('the two colour schemes', () => {
  it('must name the same semantic colours in the same order', () => {
    expect(() => checkSchemes(source())).not.toThrow();
    const missing = source({
      color: { light: { bg: '#fff', primary: '#000' }, dark: { bg: '#000' } },
    });
    expect(() => checkSchemes(missing)).toThrow('same semantic colours');
    const reordered = source({
      color: { light: { bg: '#fff', primary: '#000' }, dark: { primary: '#000', bg: '#000' } },
    });
    expect(() => checkSchemes(reordered)).toThrow('same semantic colours');
  });
});

describe('values', () => {
  it('turns lengths, durations and bare numbers into numbers and keeps the rest', () => {
    expect(toNumber('12px')).toBe(12);
    expect(toNumber('-8px')).toBe(-8);
    expect(toNumber('120ms')).toBe(120);
    expect(toNumber('0.6')).toBe(0.6);
    expect(toNumber('#ffffff')).toBe('#ffffff');
    expect(toNumber('100%')).toBe('100%');
  });

  it('reads a box-shadow as layers, keeping a semantic colour by name', () => {
    expect(parseShadow('0 1px 3px rgba(28, 28, 26, 0.1)')).toEqual([
      { inset: false, x: 0, y: 1, blur: 3, spread: 0, color: 'rgba(28, 28, 26, 0.1)' },
    ]);
    expect(
      parseShadow('0 0 0 8px rgba(1, 2, 3, 0.2), inset 0 0 0 3px var(--color-focus-ring)'),
    ).toEqual([
      { inset: false, x: 0, y: 0, blur: 0, spread: 8, color: 'rgba(1, 2, 3, 0.2)' },
      { inset: true, x: 0, y: 0, blur: 0, spread: 3, color: '{color.focus-ring}' },
    ]);
  });
});

describe('the phone app’s tokens.ts', () => {
  const text = renderTokensTs(source());

  // The render is read before Prettier runs in `generate`, so a literal still carries the double
  // quotes JSON.stringify gave it; the written file carries the repository's single quotes.
  it('carries resolved values, numbers for lengths and the pixel line height', () => {
    expect(text).toContain('bg: "#ffffff"');
    expect(text).toContain('bg: "#141412"');
    expect(text).toContain('touch: 44,');
    expect(text).toContain('fast: 120,');
    expect(text).toContain('body: { size: 14, line: 1.7, lineHeight: 23.8 }');
    expect(text).toContain('standard: [0.2, 0, 0, 1]');
    expect(text).toContain('color: "{color.primary}"');
  });

  it('is marked generated and exports the semantic colour type', () => {
    expect(text.startsWith('// GENERATED from packages/tokens/tokens.json')).toBe(true);
    expect(text).toContain("export type ColorToken = keyof Tokens['color']['light'];");
  });

  it('round-trips a value holding a backslash and a quote as a valid literal', async () => {
    const value = "'Plex' \\ fallback";
    const tricky = source({ font: { family: { arabic: value }, weight: { bold: '700' } } });
    const files = await generate(root, tricky, icons, '{}', '{}');
    const line = /^ {6}arabic: (.+),$/m.exec(files['apps/mobile/src/design/tokens.ts']);
    expect(line).not.toBeNull();
    expect(runInNewContext(line?.[1] ?? '')).toBe(value);
  });
});

describe('the CSS custom properties', () => {
  const css = renderTokensCss(source());

  it('declares light under :root, dark under its theme and compact under its density', () => {
    expect(css).toContain(':root,\n[data-theme="light"] {\n');
    expect(css).toContain('  --color-bg: #ffffff;');
    expect(css).toContain('[data-theme="dark"] {\n  --color-bg: #141412;');
    expect(css).toContain('[data-density="compact"] {\n  --size-touch: 36px;');
    expect(css).toContain('  --text-body-size: 14px;\n  --text-body-line: 1.7;');
    expect(css).toContain('  --shadow-focus: 0 0 0 3px var(--color-primary);');
  });
});

describe('the icon lists', () => {
  it('lists every registry name and the directional ones, and leaves documentation keys out', () => {
    expect(iconNames(icons)).not.toContain('$description');
    const text = renderIconsTs(icons, 'mobile');
    expect(text).toContain('  "star",');
    expect(text).toContain('export const directionalIcons = [\n  "chevron-right",');
    expect(text).toContain('useDirection()');
    expect(renderIconsTs(icons, 'admin')).toContain('[dir="rtl"]');
  });

  it('fails a directional icon missing from the registry', () => {
    const { 'chevron-left': _left, ...without } = icons;
    expect(() => renderIconsTs(without, 'mobile')).toThrow('chevron-left');
  });
});

describe('this repository’s sources', () => {
  it('generate every file, each marked as generated', async () => {
    const files = await generateFromRepository(root);
    for (const path of GENERATED_FILES) {
      expect(files[path].length).toBeGreaterThan(0);
      if (path.endsWith('.ts') || path.endsWith('.css')) expect(files[path]).toContain('GENERATED');
    }
  });
});
