// T058: a PDF the person picks from the device, for an upload (FR-151). The system picker is asked
// for PDFs only; the server decides the type again by the file's content (T020), so the filter is a
// convenience, not the check. The name and the size are the picker's, shown on the file row and
// never sent: the upload names every file `document.pdf` (`filePart` in client.ts), and the server
// stores no name (owner's decisions 2026-10-21, B11 and B11b).
import * as DocumentPicker from 'expo-document-picker';

import type { LocalFile } from './client';

/** A picked PDF: where it is, its name and its size as the device reports them. */
export interface PickedFile extends LocalFile {
  readonly sizeBytes: number;
}

/** Opens the system picker for one PDF; null when the person cancels. */
export async function pickPdf(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/pdf',
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (asset === undefined) return null;
  return { uri: asset.uri, name: asset.name, sizeBytes: asset.size ?? 0 };
}
