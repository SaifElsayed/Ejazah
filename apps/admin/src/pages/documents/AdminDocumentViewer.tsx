// T071, second part (FR-160, FR-166): `AdminDocumentViewer`, the overlay over a document's signed link
// (screens.md "AdminDocumentViewer"; drawn as a page, built as a wide dialog by the owner's decision,
// B14b-2). The document's pages beside what is known of it. Its `context` says where it opened: in a
// person's (`user`), for the document an identity request brought, it carries the decision (a note,
// «قبول», «طلب وثيقة أخرى», each confirmed); in an application's or a credential's it only shows
// (screens.md: "the decision block does not apply"). Documents are never downloaded or changed.
import { useState } from 'react';

import {
  Banner,
  Button,
  Dialog,
  Field,
  Icon,
  Input,
  KeyValue,
  Skeleton,
} from '../../design/components';
import { useT } from '../../i18n';
import { DocumentDecisionDialog, type DocumentDecision } from './DocumentDecisionDialog';
import { DocumentPages, usePdf } from './DocumentPages';
import { useDocumentLink } from './queries';

interface ViewerBase {
  readonly documentId: string;
  /** The document's name: its type, or the credential's file. */
  readonly title: string;
  readonly subtitle: string;
  /** What is known of it, before its pages' count. */
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly onClose: () => void;
}

export type DocumentViewerProps = ViewerBase &
  (
    | { readonly context: 'application' | 'credential' }
    | {
        readonly context: 'user';
        /** The identity request the document answers, and the person's name. */
        readonly request: {
          readonly requestId: string;
          readonly reason: string;
          readonly name: string;
        };
      }
  );

export function AdminDocumentViewer(props: DocumentViewerProps) {
  const { documentId, title, subtitle, facts, onClose } = props;
  const t = useT();
  const link = useDocumentLink(documentId);
  const pdf = usePdf(link.data?.url);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState<DocumentDecision | null>(null);
  const request = props.context === 'user' ? props.request : null;

  const failed = link.isError || pdf.failed;
  const pages =
    pdf.file === undefined
      ? []
      : [
          {
            label: t('admin.dialogs.documentViewer.pages'),
            value: t('admin.dialogs.documentViewer.pagesValue', { count: pdf.file.pageCount }),
          },
        ];
  const close = {
    label: t('admin.dialogs.documentViewer.close'),
    variant: 'secondary' as const,
    onPress: onClose,
  };

  return (
    <>
      <Dialog
        open
        wide
        title={title}
        subtitle={subtitle}
        onDismiss={onClose}
        note={t(
          request === null
            ? 'admin.dialogs.documentViewer.footerViewOnly'
            : 'admin.dialogs.documentViewer.footer',
        )}
        actions={
          request === null
            ? [close]
            : [
                close,
                {
                  label: t('admin.dialogs.documentViewer.requestAnother'),
                  variant: 'secondary',
                  disabled: note.trim() === '',
                  onPress: () => setDeciding('requestAnother'),
                },
                {
                  label: t('admin.dialogs.documentViewer.accept'),
                  onPress: () => setDeciding('accept'),
                },
              ]
        }
      >
        <div className="grid-2 gap-4">
          {failed ? (
            <div className="stack gap-3">
              <Banner icon={{ name: 'alert-circle' }} tone="danger">
                {t('admin.dialogs.documentViewer.loadError')}
              </Banner>
              <div className="self-start">
                <Button
                  label={t('admin.common.action.retry')}
                  variant="secondary"
                  onPress={() => void link.refetch()}
                />
              </div>
            </div>
          ) : pdf.file === undefined ? (
            <Skeleton shape="block" />
          ) : (
            // A new link starts again at the first page (B14b-2 review, round 1).
            <DocumentPages key={link.data?.url} file={pdf.file} name={title} />
          )}
          <div className="stack gap-4">
            <KeyValue items={[...facts, ...pages]} />
            {request === null ? null : (
              <>
                <section className="section">
                  <h3 className="group-label">{t('admin.dialogs.documentViewer.requestReason')}</h3>
                  <p className="text-callout">
                    <bdi>{request.reason}</bdi>
                  </p>
                </section>
                <section className="section">
                  <h3 className="group-label">{t('admin.dialogs.documentViewer.afterDecision')}</h3>
                  <ul className="stack gap-2 text-callout">
                    <li className="row row--top gap-2">
                      <Icon name="circle-check" size="sm" />
                      <span>{t('admin.dialogs.documentViewer.acceptEffect')}</span>
                    </li>
                    <li className="row row--top gap-2">
                      <Icon name="file-text" size="sm" />
                      <span>{t('admin.dialogs.documentViewer.requestAnotherEffect')}</span>
                    </li>
                  </ul>
                </section>
                <Field label={t('admin.dialogs.documentViewer.noteLabel')}>
                  <Input
                    value={note}
                    onChangeText={setNote}
                    multiline
                    placeholder={t('admin.dialogs.documentViewer.notePlaceholder')}
                  />
                </Field>
              </>
            )}
          </div>
        </div>
      </Dialog>
      {deciding === null || request === null ? null : (
        <DocumentDecisionDialog
          decision={deciding}
          requestId={request.requestId}
          name={request.name}
          note={note.trim()}
          onCancel={() => setDeciding(null)}
          onDone={onClose}
        />
      )}
    </>
  );
}
