// B14b-2: the panel's PDF reader, pdf.js (`pdfjs-dist`, pinned, Apache-2.0; owner's permission), for
// the document viewer (T071) and the credentials' page (T072). Every uploaded document is a PDF
// (upload.middleware.ts). The library and its worker load when a document is first opened, never
// with the panel. A link is fetched without credentials: it is signed and needs none.
//
// The reviewer asked for `isEvalSupported: false` against CVE-2024-4367 (a font compiled into code).
// pdf.js 6 removed the option along with the evaluation itself; `pdf.spec.ts` pins that the pinned
// build compiles nothing.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** An open PDF: how many pages it has, and a page drawn on a canvas. */
export interface PdfFile {
  readonly pageCount: number;
  /** Draws page `page` (from 1) on `canvas`, sized to the page's own proportions. */
  renderPage(page: number, canvas: HTMLCanvasElement): Promise<void>;
  /** Lets the file and its worker go. */
  close(): void;
}

/** How sharply a page is drawn: twice its size, for the viewer's width and high-density screens. */
const SCALE = 2;

export async function openPdf(url: string): Promise<PdfFile> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ url, withCredentials: false });
  const document = await task.promise;
  return {
    pageCount: document.numPages,
    renderPage: async (page, canvas) => {
      const drawn = await document.getPage(page);
      const viewport = drawn.getViewport({ scale: SCALE });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await drawn.render({ canvas, viewport }).promise;
    },
    close: () => void task.destroy(),
  };
}
