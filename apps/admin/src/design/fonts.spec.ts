// T116 (a): the panel draws in the tokens' fonts from its own files. `tokens.css` names IBM Plex
// Sans Arabic and Inter, but no page loaded them, so every page fell back to the system font.
// `fonts.css` declares one `@font-face` per family and per weight the tokens use, each served from
// `apps/admin/public/fonts` beside its OFL licence; never from an outside server (the owner's
// decision of 2026-10-28: Phase 6's CSP stays closed).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const FAMILIES = ['IBM Plex Sans Arabic', 'Inter'] as const;
const LICENCES = ['IBMPlexSansArabic-LICENSE.txt', 'Inter-LICENSE.txt'] as const;
const WOFF2_SIGNATURE = 'wOF2';

// Read from disk: the admin project's Vitest processes `components.css` alone, so `?raw` of any
// other stylesheet is empty there.
const fonts = readFileSync(path.join(import.meta.dirname, 'fonts.css'), 'utf8');
const tokens = readFileSync(path.join(import.meta.dirname, 'tokens.css'), 'utf8');

/** A file of the panel's public folder, as Vite serves it from `/fonts/…`. */
function publicFile(name: string): string {
  return path.join(import.meta.dirname, '../../public/fonts', name);
}

interface FontFace {
  readonly family: string;
  readonly weight: string;
  readonly url: string;
}

function fontFaces(): FontFace[] {
  const css = fonts.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/@font-face\s*\{([^{}]*)\}/g)].map(([, body = '']) => ({
    family: /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? '',
    weight: /font-weight:\s*(\d+)/.exec(body)?.[1] ?? '',
    url: /url\('([^']+)'\)/.exec(body)?.[1] ?? '',
  }));
}

const weights = [...tokens.matchAll(/--weight-[a-z]+:\s*(\d+);/g)].map(([, weight]) => weight);

describe('the panel’s own fonts', () => {
  it('declares every family the tokens name, at every weight the tokens use', () => {
    expect(weights.length).toBeGreaterThan(0);
    const declared = fontFaces().map(({ family, weight }) => `${family} ${weight}`);
    for (const family of FAMILIES) {
      expect(tokens).toContain(`'${family}'`);
      for (const weight of weights) expect(declared).toContain(`${family} ${weight}`);
    }
  });

  it('serves each face from its own woff2 file, never from an outside server', () => {
    expect(fonts).not.toMatch(/https?:|\/\//);
    for (const { url } of fontFaces()) {
      expect(url).toMatch(/^\/fonts\/[\w-]+\.woff2$/);
      const file = publicFile(url.slice('/fonts/'.length));
      expect(existsSync(file), url).toBe(true);
      expect(readFileSync(file).subarray(0, WOFF2_SIGNATURE.length).toString('latin1'), url).toBe(
        WOFF2_SIGNATURE,
      );
    }
  });

  it('keeps each family’s OFL licence beside its files', () => {
    for (const licence of LICENCES) {
      expect(readFileSync(publicFile(licence), 'utf8')).toContain(
        'SIL Open Font License, Version 1.1',
      );
    }
  });
});
