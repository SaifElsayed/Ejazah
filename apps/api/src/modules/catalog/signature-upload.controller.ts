// T003 of specs/005-certification: `POST /uploads/signature`, the upload route's fourth use (FR-601,
// SRS FR-IJAZAH-12; research R-411; R-SEC-3, R-SEC-4; contracts/app-surface.md).
//
// Behind the user bearer of a teacher the route admits as approved, the payout account verified or
// not (`admits: 'approved'`, as `teacher.signature.get` declares; R-106): a student and an applicant
// `FORBIDDEN`, a suspended or banned teacher `ACCOUNT_RESTRICTED`, each before a byte of the body is
// read. One file of the kind `signature`, a PNG or a JPEG decided by its content through the
// kernel's guard (`upload_max_bytes`, `rate_limit_upload`), whatever its name or declared type, is
// handed to catalog's signature service with the uploader's own id, which stores it and replaces the
// teacher's one row (teacher-signature.service.ts). The 201 answer is `{ uploadedAt }`, never a key:
// the file is read through `teacher.signature.get`'s signed link (R-SEC-3). Each refusal once the
// caller is known writes one info line, `{ userId, errorCode }`: never the file's name or any of its
// content.
//
// The owner's Q16 (b): before it reaches the service, the file is turned upright and re-encoded in its
// own type with no metadata (no EXIF, so no GPS or device; no PNG text chunks) by the photo's own
// strip, identity's `imageWithoutMetadata` (T145), in a turn of the `PhotoTurns` the route is
// handed. `main.ts` hands the photos route and this one the same instance, so the process decodes
// one image at a time across both (T073's memory bound). A header declaring more than
// `PHOTO_MAX_INPUT_PIXELS`, or a file `sharp` cannot read, is refused `VALIDATION_FAILED`, and a
// request finding no turn in time `RATE_LIMITED`, each before anything is stored.
import { type SignatureUploadOutput, signatureUploadOutput } from '@ijazah/contracts';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { NodeHandler } from '../../platform/web/route.js';
import { imageWithoutMetadata, type PhotoTurns } from '../identity/index.js';
import {
  type RefusedUpload,
  uploadRoute,
  type UploadRouteDependencies,
} from '../../surfaces/upload-route.js';
import type { SignatureFile, SignatureType } from './teacher-signature.service.js';

/** Where the signature is posted (contracts/app-surface.md, `POST /uploads/signature`). */
export const SIGNATURE_UPLOAD_PATH = '/uploads/signature';

/** What the route asks of catalog's signature service. */
export interface SignatureReplacer {
  replace(teacherUserId: string, file: SignatureFile): Promise<SignatureUploadOutput>;
}

export interface SignatureUploadDependencies extends UploadRouteDependencies {
  readonly signatures: SignatureReplacer;
  /** The process's one image line (the owner's Q16 (b)), shared with the photos route. */
  readonly turns: PhotoTurns;
}

function isSignatureType(type: string): type is SignatureType {
  return type === 'image/png' || type === 'image/jpeg';
}

/** One line per refused upload: the uploader and the refusal's code. */
function logRefusal(error: unknown, { uploader, log }: RefusedUpload): void {
  log.info(
    {
      userId: uploader.userId,
      errorCode: error instanceof DomainError ? error.code : 'unexpected',
    },
    'A signature upload was refused',
  );
}

export function createSignatureUploadRoute({
  signatures,
  turns,
  ...dependencies
}: SignatureUploadDependencies): NodeHandler {
  return uploadRoute<'signature'>(dependencies, {
    kindOf: () => 'signature',
    admits: 'approved',
    refuses: ['suspended', 'banned'],
    refused: logRefusal,
    handle: async ({ uploader, type, bytes }): Promise<SignatureUploadOutput> => {
      if (!isSignatureType(type)) {
        throw new Error('signature: the signature kind admitted a type it does not take');
      }
      const stored = await turns.take(() => imageWithoutMetadata(type, bytes));
      return signatureUploadOutput.parse(
        await signatures.replace(uploader.userId, { type, bytes: stored }),
      );
    },
  });
}
