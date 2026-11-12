// T045 of specs/004-sessions (FR-489, FR-490): a document the person picks for the chat. The system
// picker is asked for PDFs and plain text only; the server decides the type again by content and
// refuses any image (`ATTACHMENT_REFUSED`), so the filter is a convenience, not the check. The name
// is the one the chat shows (`POST /uploads/chat`'s `filename`); the file itself goes under a fixed
// name (`chatPart`, lib/client.ts).
import * as DocumentPicker from 'expo-document-picker';

import type { LocalChatFile } from '../../../lib/client';

/** The types the chat takes (FR-489; plan.md decision 12). */
const CHAT_TYPES = ['application/pdf', 'text/plain'];

/** A picked document: where it is, the type the device reported, and its name. */
export interface PickedChatDocument extends LocalChatFile {
  readonly name: string;
}

/** Opens the system picker for one PDF or text document; null when the person cancels. */
export async function pickChatDocument(): Promise<PickedChatDocument | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: CHAT_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (asset === undefined) return null;
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/pdf' };
}
