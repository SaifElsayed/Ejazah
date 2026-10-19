// T024: `POST /uploads/photos` (public-pages.md "The uploads route"; decision 46, R-API-6). The
// profile photo of either role is the identity module's: behind the user bearer, admitting the
// standings the profile editor admits (not suspended, not banned, FR-137), a JPEG or PNG decided
// by content through T020's guard is stored through the storage port under a server-minted key,
// `users.photo_key` is written through this module's own repository, the photo it replaces is
// removed from storage, and the answer is a signed link living `document_link_ttl_seconds`, the
// same link `account.me` answers as `photoUrl`. The key is plain in its column: a photo is not an
// identity document (R-DB-8 names the document key), and the column is served only through a
// signed link (R-SEC-3).
import { randomUUID } from 'node:crypto';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { uploadRoute, type UploadRouteDependencies } from '../../surfaces/upload-route.js';

/** Where the photos route is served (public-pages.md). */
export const PHOTOS_UPLOAD_PATH = '/uploads/photos';

/** What the route asks of the identity repository. */
export interface PhotoWriter {
  /** Sets the user's photo key; answers the key it replaced, when there was one. */
  replacePhotoKey(userId: string, key: string): Promise<string | null>;
}

export interface PhotoUploadDependencies extends UploadRouteDependencies {
  readonly storage: Pick<StoragePort, 'put' | 'remove' | 'temporaryLink'>;
  readonly settings: SettingsReader;
  readonly users: PhotoWriter;
}

export function photoUploadRoute({
  storage,
  settings,
  users,
  ...dependencies
}: PhotoUploadDependencies): NodeHandler {
  return uploadRoute(dependencies, {
    kindOf: () => 'photo' as const,
    refuses: ['suspended', 'banned'],
    handle: async ({ uploader, type, bytes }) => {
      const extension = type === 'image/png' ? 'png' : 'jpg';
      const key = `photos/${uploader.userId}/${randomUUID()}.${extension}`;
      await storage.put(key, bytes, type);
      const previous = await users.replacePhotoKey(uploader.userId, key);
      if (previous !== null && previous !== key)
        await storage.remove(previous).catch(() => undefined);
      const ttl = await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl);
      return { photoUrl: await storage.temporaryLink(key, ttl) };
    },
  });
}
