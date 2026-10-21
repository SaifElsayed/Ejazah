// T058, T059 (FR-151, FR-150, FR-153): one PDF of an application or a credential. Empty, it is the
// upload target; tapped, the system picker opens for a PDF, the file is uploaded at once
// (`POST /uploads/documents`) and the row shows its name and size, as the picker reported them,
// with an action to remove it, or to replace it where a document is required. An upload in flight
// shows a spinner; a refused one says so in place, and the person picks again. The name and the
// size stay on the device: the server knows the document by its id.
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, FileRow, Spinner, Upload } from '../../../design/primitives';
import { tokens } from '../../../design/tokens';
import { useT } from '../../../i18n';
import { useApi } from '../../../lib/api';
import type { DocumentKind } from '../../../lib/client';
import { pickPdf } from '../../../lib/files';
import { useFormatters } from '../../../lib/formatters';

/** A PDF the person picked and uploaded: the server's id, and what the row shows. */
export interface UploadedPdf {
  readonly documentId: string;
  readonly name: string;
  readonly sizeBytes: number;
}

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/** One decimal of a megabyte, as the boards draw it («2.4 م.ب»). */
const TENTHS = 10;

/** A file's size in the page's language: kilobytes under one megabyte, megabytes from there. */
export function useFileSize(): (sizeBytes: number) => string {
  const t = useT();
  const format = useFormatters();
  return (sizeBytes) =>
    sizeBytes < BYTES_PER_MEGABYTE
      ? t('common.unit.kilobytes', {
          size: format.number(Math.max(1, Math.round(sizeBytes / BYTES_PER_KILOBYTE))),
        })
      : t('common.file.sizeMb', {
          size: format.number(Math.round((sizeBytes / BYTES_PER_MEGABYTE) * TENTHS) / TENTHS),
        });
}

export function PdfField({
  kind,
  file,
  label,
  hint,
  onChange,
  replaceOnly = false,
}: {
  readonly kind: DocumentKind;
  readonly file: UploadedPdf | undefined;
  /** The empty target's label («رفع إجازة التجويد»). */
  readonly label: string;
  readonly hint?: string;
  readonly onChange: (file: UploadedPdf | undefined) => void;
  /** A required document already given: the row offers a replacement, never a removal. */
  readonly replaceOnly?: boolean;
}) {
  const t = useT();
  const { client } = useApi();
  const size = useFileSize();
  const [state, setState] = useState<'idle' | 'uploading' | 'failed'>('idle');

  async function choose(): Promise<void> {
    const picked = await pickPdf();
    if (picked === null) return;
    setState('uploading');
    try {
      const documentId = await client.uploadDocument(kind, picked);
      setState('idle');
      onChange({ documentId, name: picked.name, sizeBytes: picked.sizeBytes });
    } catch {
      setState('failed');
    }
  }

  return (
    <View style={{ gap: tokens.space['2'] }}>
      {state === 'uploading' ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={label}
          style={{ alignItems: 'center' }}
        >
          <Spinner size="sm" />
        </View>
      ) : file === undefined ? (
        <Upload
          label={label}
          {...(hint === undefined ? {} : { hint })}
          icon={{ name: 'upload' }}
          onPress={() => void choose()}
        />
      ) : (
        <FileRow
          name={file.name}
          meta={size(file.sizeBytes)}
          action={
            replaceOnly
              ? {
                  icon: { name: 'refresh-cw' },
                  accessibilityLabel: t('common.action.replace'),
                  onPress: () => void choose(),
                }
              : {
                  icon: { name: 'x' },
                  accessibilityLabel: t('common.a11y.deleteFile'),
                  onPress: () => onChange(undefined),
                }
          }
        />
      )}
      {state === 'failed' ? (
        <Banner icon={{ name: 'alert-circle' }} tone="danger">
          {t('common.state.actionError')}
        </Banner>
      ) : null}
    </View>
  );
}
