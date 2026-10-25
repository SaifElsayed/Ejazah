// B14b-2: the PDF reader opens a link without credentials, counts its pages, and draws a page on a
// canvas at the page's own proportions. The reviewer asked for `isEvalSupported: false`
// (CVE-2024-4367 was a font compiled into code); pdf.js 6 removed the option with the evaluation
// itself, so the case below pins that the pinned build compiles nothing, and an upgrade that brings
// it back fails here.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const render = vi.fn(() => ({ promise: Promise.resolve() }));
const getViewport = vi.fn(({ scale }: { scale: number }) => ({
  width: 300 * scale,
  height: 400 * scale,
}));
const destroy = vi.fn(async () => {});
const getDocument = vi.fn(() => ({
  promise: Promise.resolve({
    numPages: 3,
    getPage: vi.fn(async () => ({ getViewport, render })),
  }),
  destroy,
}));

vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: { workerSrc: '' } }));

const { openPdf } = await import('./pdf');

afterEach(() => vi.clearAllMocks());

describe('openPdf', () => {
  it('opens the link without credentials, and counts its pages', async () => {
    const file = await openPdf('http://localhost:3000/files/a.pdf?x=1');

    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:3000/files/a.pdf?x=1',
        withCredentials: false,
      }),
    );
    expect(file.pageCount).toBe(3);
  });

  it('reads with a build that compiles no code from a document (CVE-2024-4367)', () => {
    const require = createRequire(import.meta.url);
    for (const build of [
      'pdfjs-dist/build/pdf.mjs',
      'pdfjs-dist/build/pdf.worker.mjs',
      'pdfjs-dist/build/pdf.worker.min.mjs',
    ]) {
      const source = readFileSync(require.resolve(build), 'utf8');
      expect(source).not.toMatch(/new Function\(|[^\w.]eval\(/);
    }
  });

  it('draws a page on the canvas at its own proportions, and lets the file go', async () => {
    const file = await openPdf('http://localhost:3000/files/a.pdf');
    const canvas = document.createElement('canvas');

    await file.renderPage(2, canvas);

    expect(canvas.height / canvas.width).toBeCloseTo(400 / 300);
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ canvas }));
    file.close();
    expect(destroy).toHaveBeenCalled();
  });
});
