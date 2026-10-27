// T058: a PDF the person picks from the device, for an upload (FR-151). The system picker is asked
// for PDFs only; the server decides the type again by the file's content (T020), so the filter is a
// convenience, not the check. The name and the size are the picker's, shown on the file row and
// never sent: the upload names every file `document.pdf` (`filePart` in client.ts), and the server
// stores no name (owner's decisions 2026-10-21, B11 and B11b). T084: the profile photo is picked the
// same way, JPEG or PNG only (the types `POST /uploads/photos` admits, decided again by content), so
// no image library is added, and sent as `photo.jpg` or `photo.png` (`photoPart`). T100: the `uri`
// here is never sent either; the upload reads the file's bytes from it (owner's decision 2026-10-27).
import * as DocumentPicker from 'expo-document-picker';

import type { LocalFile, LocalPhoto } from './client';

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

/** The image types the photos route admits (public-pages.md "The uploads route"). */
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

/** Opens the system picker for one JPEG or PNG; null when the person cancels. */
export async function pickPhoto(): Promise<LocalPhoto | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: PHOTO_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (asset === undefined) return null;
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'image/jpeg' };
}
