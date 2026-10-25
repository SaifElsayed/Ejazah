// B14b-2: a PDF's pages, one at a time, with the file's caption and a pager (the viewer's board,
// `AdminDocumentViewer`; T072's credential page draws the same). A page is drawn on a canvas at its
// own proportions inside the drawn sheet. `usePdf` opens a link and lets the file go when the link
// changes or the viewer closes.
import { useEffect, useRef, useState } from 'react';

import { type Content, Pager } from '../../design/components';
import { useT } from '../../i18n';
import { openPdf, type PdfFile } from '../../lib/pdf';

export function usePdf(url: string | undefined): {
  readonly file: PdfFile | undefined;
  readonly failed: boolean;
} {
  const [opened, setOpened] = useState<{
    readonly url: string;
    readonly file?: PdfFile;
    readonly failed?: boolean;
  } | null>(null);
  useEffect(() => {
    if (url === undefined) return;
    let live = true;
    let file: PdfFile | undefined;
    openPdf(url).then(
      (answer) => {
        file = answer;
        if (live) setOpened({ url, file: answer });
        else answer.close();
      },
      () => {
        if (live) setOpened({ url, failed: true });
      },
    );
    return () => {
      live = false;
      file?.close();
    };
  }, [url]);
  const current = opened !== null && opened.url === url ? opened : null;
  return { file: current?.file, failed: current?.failed === true };
}

export function DocumentPages({
  file,
  name,
  inline = false,
  accessory,
}: {
  readonly file: PdfFile;
  readonly name: string;
  /** Beside a credential's panel (T072): «الصفحة 1 من 2» and «صفحات الإجازة», as drawn. */
  readonly inline?: boolean;
  /** Beside the pager (the credentials board's «فتح الوثيقة بالحجم الكامل»). */
  readonly accessory?: Content;
}) {
  const t = useT();
  const [page, setPage] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current !== null) void file.renderPage(page, canvas.current).catch(() => undefined);
  }, [file, page]);
  return (
    <div className="stack gap-3">
      <div className={inline ? 'row row--between gap-2' : 'toolbar row--between'}>
        <span className="text-callout text-medium">
          {inline
            ? t('admin.common.pager.pageOf', { page, total: file.pageCount })
            : t('admin.dialogs.documentViewer.fileCaption', {
                file: name,
                page,
                total: file.pageCount,
              })}
        </span>
        <span className="row gap-1">
          <Pager
            page={page}
            pageCount={file.pageCount}
            onChange={setPage}
            accessibilityLabel={t(
              inline
                ? 'admin.credentials.a11y.documentPages'
                : 'admin.dialogs.documentViewer.a11y.pages',
            )}
          />
          {accessory}
        </span>
      </div>
      <div
        className="doc-viewer grow"
        role="img"
        aria-label={t('admin.dialogs.documentViewer.a11y.page', { documentType: name, page })}
      >
        <span className="doc-viewer__page">
          <canvas ref={canvas} className="certificate-page__image" />
        </span>
      </div>
    </div>
  );
}
