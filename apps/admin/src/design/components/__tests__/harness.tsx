// T036: the render harness every component spec runs through. A component is rendered inside the
// panel's frame once in Arabic (right to left) and once in English (left to right), and each pass
// fails on what the design forbids (docs/design/components.md, "Conventions"):
// - a class that `components.css` does not define: the panel draws with the design's own classes,
//   so a component is right when it matches the board, and a made-up class matches nothing;
// - a physical side in an inline style (`left`, `margin-right`, …): start and end only (R-MOBILE-5);
// - a literal colour in an inline style: semantic tokens only (R-MOBILE-4).
// Lucide's own marker classes on its drawings (`lucide`, `lucide-<name>`) are the library's and are
// let through.
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { expect } from 'vitest';

import { type Direction, directionOf, type Locale, setLocale } from '../../../i18n';
import stylesheet from '../../components.css?raw';
import { Console } from '../Console';

/** Every class `components.css` defines. */
export const designClasses: ReadonlySet<string> = new Set(
  [...stylesheet.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? ''),
);

const PHYSICAL_SIDE =
  /(?:^|[;\s])(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:|text-align\s*:\s*(?:left|right)/;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

/** The design's rules, checked on every element under `root`. */
export function expectDesignRules(root: Element): void {
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const name of element.classList) {
      if (name === 'lucide' || name.startsWith('lucide-')) continue;
      expect(designClasses.has(name), `class "${name}" is not in components.css`).toBe(true);
    }
    const style = element.getAttribute('style') ?? '';
    expect(style, `a physical side in "${style}"`).not.toMatch(PHYSICAL_SIDE);
    expect(style, `a literal colour in "${style}"`).not.toMatch(LITERAL_COLOUR);
  }
}

export interface DirectionPass {
  readonly locale: Locale;
  readonly dir: Direction;
  readonly view: RenderResult;
  /** The frame the component was rendered in (`.console`). */
  readonly frame: HTMLElement;
}

/**
 * Renders `ui()` in the frame in Arabic, then in English, checks the design's rules in each, and
 * hands each pass to `check` before it is unmounted.
 */
export function inBothDirections(
  ui: () => ReactElement,
  check: (pass: DirectionPass) => void = () => undefined,
): void {
  for (const locale of ['ar', 'en'] as const) {
    setLocale(locale);
    const view = render(<Console>{ui()}</Console>);
    const frame = view.container.querySelector<HTMLElement>('.console');
    if (frame === null) throw new Error('harness: the frame did not render');
    expect(frame.getAttribute('dir')).toBe(directionOf(locale));
    expectDesignRules(frame);
    check({ locale, dir: directionOf(locale), view, frame });
    view.unmount();
  }
  setLocale('ar');
}
