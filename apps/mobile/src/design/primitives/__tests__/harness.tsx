// T032: the render harness every primitive spec uses (R-MOBILE-4/5/6). A primitive is rendered in
// both directions (Arabic right-to-left, English left-to-right) inside the theme, and two checks
// run on every render: no physical direction anywhere in the rendered styles (start and end only),
// and no colour that is not a semantic token of the scheme in force.
import { expect } from '@jest/globals';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';

import { setLocale } from '../../../i18n';
import { type Direction, DirectionContext } from '../../../lib/direction';
import { ThemeProvider } from '../../theme';
import { type ColorScheme, tokens } from '../../tokens';

export const directions: readonly Direction[] = ['rtl', 'ltr'];

type Rendered = Awaited<ReturnType<typeof render>>;

/** `ui` in `direction`, with the locale that reads in it, inside the theme of `scheme`. */
export async function renderIn(
  direction: Direction,
  ui: ReactElement,
  scheme: ColorScheme = 'light',
): Promise<Rendered> {
  setLocale(direction === 'rtl' ? 'ar' : 'en');
  return render(
    <ThemeProvider scheme={scheme}>
      <DirectionContext.Provider value={direction}>{ui}</DirectionContext.Provider>
    </ThemeProvider>,
  );
}

/**
 * Renders `ui` in both directions, runs the two checks on each render, then `check`; every
 * primitive's render test goes through here.
 */
export async function inBothDirections(
  ui: () => ReactElement,
  check: (rendered: Rendered, direction: Direction) => void | Promise<void> = () => undefined,
  scheme: ColorScheme = 'light',
): Promise<void> {
  for (const direction of directions) {
    const rendered = await renderIn(direction, ui(), scheme);
    expectLogicalOnly(rendered);
    expectTokenColours(rendered, scheme);
    await check(rendered, direction);
    await rendered.unmount();
  }
}

interface Node {
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly children: readonly (Node | string)[] | null;
}

/** Every host node of the rendered tree. */
export function nodesOf(rendered: Rendered): Node[] {
  const out: Node[] = [];
  const walk = (node: unknown) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const host = node as Node;
    out.push(host);
    for (const child of host.children ?? []) walk(child);
  };
  walk(rendered.toJSON());
  return out;
}

/** The flattened style of a host node. */
export function styleOf(node: {
  readonly props: Record<string, unknown>;
}): Record<string, unknown> {
  return (StyleSheet.flatten(node.props['style'] as never) ?? {}) as Record<string, unknown>;
}

const PHYSICAL = new Set([
  'left',
  'right',
  'marginLeft',
  'marginRight',
  'paddingLeft',
  'paddingRight',
  'borderLeftWidth',
  'borderRightWidth',
  'borderLeftColor',
  'borderRightColor',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
]);

/** No style of the tree names a physical side (R-MOBILE-5). */
export function expectLogicalOnly(rendered: Rendered): void {
  const found: string[] = [];
  for (const node of nodesOf(rendered)) {
    const style = styleOf(node);
    for (const key of Object.keys(style)) if (PHYSICAL.has(key)) found.push(`${node.type}.${key}`);
    if (style['textAlign'] === 'left' || style['textAlign'] === 'right') {
      found.push(`${node.type}.textAlign`);
    }
  }
  expect(found).toEqual([]);
}

/** Every colour of the tree is a semantic colour of `scheme` (R-MOBILE-4). */
export function expectTokenColours(rendered: Rendered, scheme: ColorScheme): void {
  const allowed = new Set<unknown>([...Object.values(tokens.color[scheme]), 'transparent']);
  for (const layers of Object.values(tokens.shadow))
    for (const layer of layers) allowed.add(layer.color);
  const found: string[] = [];
  const check = (where: string, value: unknown) => {
    if (typeof value === 'string' && value !== 'none' && !allowed.has(value)) {
      found.push(`${where}=${value}`);
    }
  };
  for (const node of nodesOf(rendered)) {
    const style = styleOf(node);
    for (const [key, value] of Object.entries(style)) {
      if (/color$/i.test(key)) check(`${node.type}.${key}`, value);
      if (key === 'boxShadow' && Array.isArray(value)) {
        for (const layer of value)
          check(`${node.type}.boxShadow`, (layer as { color?: unknown }).color);
      }
    }
    // An icon's drawing colour is a prop of the SVG root.
    if (node.type === 'RNSVGSvgView') {
      check(`${node.type}.stroke`, node.props['stroke']);
      check(`${node.type}.fill`, node.props['fill']);
    }
  }
  expect(found).toEqual([]);
}

/** The colour token a value of `scheme` is, for readable assertions. */
export function colour(scheme: ColorScheme, token: keyof (typeof tokens.color)['light']): string {
  return tokens.color[scheme][token];
}
