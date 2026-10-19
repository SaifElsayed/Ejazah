// T019 (PR #79 review, owner's decision 2026-10-19): the design's two stylesheets, read once at
// start with a content hash, so a page links `tokens.<hash>.css` and the browser's year-long
// `immutable` cache can never serve a stale design: a new build is a new name, and the old name is
// simply never linked again. The bare names stay answerable for a hand-written link, revalidated
// on every request (`no-cache` with an ETag), never cached as immutable.
//
// The copies live in `apps/api/src/platform/web/assets/`, written by `scripts/build-tokens.ts`
// under `check:generated`; they are read from the package root so the built `dist/` (which `tsc`
// emits without assets) serves the same files. A missing file is a build that did not run, and
// stops the start.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Where the design's stylesheets are served (public-pages.md "The pages"). */
export const DESIGN_ASSETS_PATH = '/public/design';

/** The two stylesheets every page links, in order: the tokens, then the components. */
export const DESIGN_STYLESHEETS = ['tokens.css', 'components.css'] as const;

export type DesignStylesheet = (typeof DESIGN_STYLESHEETS)[number];

/** How many hex characters of the SHA-256 name a build: enough to never collide, short in a link. */
const HASH_LENGTH = 16;

const ASSETS_DIRECTORY = new URL('../../../src/platform/web/assets/', import.meta.url);

export interface DesignAsset {
  /** The bare name, `tokens.css`. */
  readonly name: DesignStylesheet;
  /** The name a page links, `tokens.<hash>.css`: immutable, since a new build is a new name. */
  readonly hashedName: string;
  /** The content hash, also the ETag of the bare name. */
  readonly hash: string;
  readonly body: string;
}

function readAsset(name: DesignStylesheet): DesignAsset {
  const body = readFileSync(new URL(name, ASSETS_DIRECTORY), 'utf8');
  const hash = createHash('sha256').update(body).digest('hex').slice(0, HASH_LENGTH);
  const dot = name.lastIndexOf('.');
  return { name, hashedName: `${name.slice(0, dot)}.${hash}${name.slice(dot)}`, hash, body };
}

let loaded: readonly DesignAsset[] | undefined;

/** The two assets, read once on first use. */
export function designAssets(): readonly DesignAsset[] {
  loaded ??= DESIGN_STYLESHEETS.map(readAsset);
  return loaded;
}

/** The hrefs a page links, hashed. */
export function designStylesheetHrefs(): readonly string[] {
  return designAssets().map((asset) => `${DESIGN_ASSETS_PATH}/${asset.hashedName}`);
}

/** The asset a requested file name denotes, and whether that name is the immutable one. */
export function findDesignAsset(
  file: string,
): { readonly asset: DesignAsset; readonly immutable: boolean } | undefined {
  for (const asset of designAssets()) {
    if (file === asset.hashedName) return { asset, immutable: true };
    if (file === asset.name) return { asset, immutable: false };
  }
  return undefined;
}
