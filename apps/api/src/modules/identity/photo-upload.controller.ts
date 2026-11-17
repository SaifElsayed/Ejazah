// T024: `POST /uploads/photos` (public-pages.md "The uploads route"; decision 46, R-API-6). The
// profile photo of either role is the identity module's: behind the user bearer, admitting the
// standings the profile editor admits (not suspended, not banned, FR-137), a JPEG or PNG decided
// by content through T020's guard is stored through the storage port under a server-minted key,
// `users.photo_key` is written through this module's own repository, the photo it replaces is
// removed from storage, and the answer is a signed link living `document_link_ttl_seconds`, the
// same link `account.me` answers as `photoUrl`. The key is plain in its column: a photo is not an
// identity document (R-DB-8 names the document key), and the column is served only through a
// signed link (R-SEC-3).
//
// T145 (the owner's decision of 2026-11-02): the photo is stored without its metadata, since its
// EXIF can carry where it was taken and the device. `sharp` turns it upright by its EXIF
// orientation first (`rotate()` with no angle), then re-encodes it in its own type, JPEG as JPEG
// and PNG as PNG; asked for no metadata, it writes none (no EXIF, XMP, IPTC, ICC, nor a PNG's text
// chunks). Its header is read first, and a photo declaring more than `PHOTO_MAX_INPUT_PIXELS` is
// refused before a pixel is decoded; the decoder carries the same bound. A file `sharp` cannot
// read is refused as the kinds guard refuses a type, `VALIDATION_FAILED`. Either refusal comes
// before `storage.put`, so nothing is stored and the previous photo stays.
//
// T073 (PR #117's review; the owner's decision of 2026-11-02): one photo at the bound holds up to
// about 551 MB while it is processed, so the route processes `PHOTOS_PROCESSED_AT_ONCE` (one)
// at a time through `PhotoTurns`, from reading the header to the re-encoded bytes; a request
// waiting longer than `PHOTO_TURN_WAIT_MS` for its turn is refused with `RATE_LIMITED`, before
// anything is stored. `sharp`'s operation cache is off for the process, set here, the one place
// that uses `sharp`: a photo is processed once, so a cached one only holds memory.
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DomainError } from '../../platform/errors/domain-error.js';
import {
  PHOTO_MAX_INPUT_PIXELS,
  PHOTO_TURN_WAIT_MS,
  PHOTOS_PROCESSED_AT_ONCE,
  type SniffedType,
} from '../../platform/guards/upload.middleware.js';
import type { StoragePort } from '../../platform/ports/storage/storage.port.js';
import { DOCUMENT_LINK_TTL_SETTING, documentLinkTtl } from '../../platform/settings/keys.js';
import type { SettingsReader } from '../../platform/settings/settings-reader.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { uploadRoute, type UploadRouteDependencies } from '../../surfaces/upload-route.js';
import { PhotoTurns } from './photo-turns.js';

sharp.cache(false);

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
  /** The turns the photos are processed in; the route builds its own, one at a time, by default. */
  readonly turns?: PhotoTurns;
}

function unreadable(cause: unknown): DomainError {
  return new DomainError('VALIDATION_FAILED', 'The image cannot be read.', { cause });
}

/** The photo upright, re-encoded in its own type, with no metadata (T145). */
export async function withoutMetadata(type: SniffedType, bytes: Buffer): Promise<Buffer> {
  const { width, height } = await sharp(bytes)
    .metadata()
    .catch((error: unknown) => {
      throw unreadable(error);
    });
  if (width * height > PHOTO_MAX_INPUT_PIXELS) {
    throw new DomainError('VALIDATION_FAILED', 'The image has more pixels than allowed.');
  }
  const upright = sharp(bytes, { limitInputPixels: PHOTO_MAX_INPUT_PIXELS }).rotate();
  return (type === 'image/png' ? upright.png() : upright.jpeg())
    .toBuffer()
    .catch((error: unknown) => {
      throw unreadable(error);
    });
}

export function photoUploadRoute({
  storage,
  settings,
  users,
  turns = new PhotoTurns({ atOnce: PHOTOS_PROCESSED_AT_ONCE, waitMs: PHOTO_TURN_WAIT_MS }),
  ...dependencies
}: PhotoUploadDependencies): NodeHandler {
  return uploadRoute(dependencies, {
    kindOf: () => 'photo' as const,
    refuses: ['suspended', 'banned'],
    handle: async ({ uploader, type, bytes }) => {
      const stored = await turns.take(() => withoutMetadata(type, bytes));
      const extension = type === 'image/png' ? 'png' : 'jpg';
      const key = `photos/${uploader.userId}/${randomUUID()}.${extension}`;
      await storage.put(key, stored, type);
      const previous = await users.replacePhotoKey(uploader.userId, key);
      if (previous !== null && previous !== key)
        await storage.remove(previous).catch(() => undefined);
      const ttl = await settings.read(DOCUMENT_LINK_TTL_SETTING, documentLinkTtl);
      return { photoUrl: await storage.temporaryLink(key, ttl) };
    },
  });
}
