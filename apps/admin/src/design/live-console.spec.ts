// T111: the live console scrolls instead of clipping. A board draws `.console` as the fixed 1440×900
// frame with every box inside `overflow: hidden`; the panel adds `.console--live`, a class of its
// own, so the window is the frame, the page body, the list, the detail and a panel's body scroll,
// a panel's actions stay in view, a table scrolls sideways inside its border and a long text cell
// ends in an ellipsis. The boards' rules stay as they are (the owner's decision, 2026-10-28).
import { describe, expect, it } from 'vitest';

import stylesheet from './components.css?raw';

/** The declarations of the rules written exactly as `selector`, in order, property to value. */
function rule(selector: string): Readonly<Record<string, string>> {
  const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, head]) => head?.trim() === selector,
  );
  expect(blocks.length, `a rule for "${selector}"`).toBeGreaterThan(0);
  const declarations: Record<string, string> = {};
  for (const [, , body] of blocks) {
    for (const declaration of (body ?? '').split(';')) {
      const [property, ...value] = declaration.split(':');
      if (property === undefined || value.length === 0) continue;
      // A repeated property is a fallback; the last one is what a browser that knows it applies.
      declarations[property.trim()] = value.join(':').trim();
    }
  }
  return declarations;
}

describe('the boards’ frame (unchanged)', () => {
  it('stays the fixed 1440×900 frame that clips, as the boards draw it', () => {
    expect(rule('.console')).toMatchObject({
      width: 'var(--layout-web-width)',
      height: 'var(--layout-web-height)',
      overflow: 'hidden',
    });
    expect(rule('.page-body')).toMatchObject({ overflow: 'hidden' });
    expect(rule('.split__list')).toMatchObject({ overflow: 'hidden' });
    expect(rule('.split__detail')).toMatchObject({ overflow: 'hidden' });
    expect(rule('.table-wrap')).toMatchObject({ overflow: 'hidden' });
    expect(rule('.panel')).toMatchObject({ overflow: 'hidden' });
    expect(rule('.panel__body')).toMatchObject({ overflow: 'hidden' });
  });
});

describe('the live console (T111)', () => {
  it('fills the window', () => {
    expect(rule('.console--live')).toMatchObject({ width: 'auto', height: '100dvh' });
  });

  it('scrolls the sidebar, the page body, the list, the detail and a panel’s body', () => {
    for (const box of [
      '.sidebar',
      '.page-body',
      '.split__list',
      '.split__detail',
      '.panel__body',
    ]) {
      expect(rule(`.console--live ${box}`), box).toMatchObject({ 'overflow-y': 'auto' });
    }
  });

  it('keeps a panel’s actions in view: the panel is the detail’s height and only its body scrolls', () => {
    expect(rule('.panel')).toMatchObject({ height: '100%', display: 'flex' });
    expect(rule('.panel__body')).toMatchObject({ flex: '1', 'min-height': '0' });
    expect(stylesheet).not.toMatch(/\.console--live \.panel__footer/);
  });

  it('scrolls a table sideways inside its border, its count and pager kept in view', () => {
    expect(rule('.console--live .table-wrap')).toMatchObject({
      'overflow-x': 'auto',
      'flex-shrink': '0',
    });
    expect(rule('.console--live .table-footer')).toMatchObject({
      position: 'sticky',
      'inset-inline-start': '0',
    });
  });

  it('ends a long text cell in an ellipsis after two lines', () => {
    expect(rule('.console--live .table__clip')).toMatchObject({
      display: '-webkit-box',
      '-webkit-line-clamp': '2',
      '-webkit-box-orient': 'vertical',
      overflow: 'hidden',
      'white-space': 'normal',
    });
  });

  it('reaches no board: every rule that names it starts with it', () => {
    const css = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
    const heads = [...css.matchAll(/([^{}]+)\{/g)]
      .map(([, head]) => head?.trim() ?? '')
      .filter((head) => head.includes('console--live') || head.includes('table__clip'));
    expect(heads.length).toBeGreaterThan(0);
    for (const head of heads) {
      for (const selector of head.split(',')) expect(selector.trim()).toMatch(/^\.console--live\b/);
    }
  });
});
