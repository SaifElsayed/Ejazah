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
import { type SignatureUploadOutput, signatureUploadOutput } from '@ijazah/contracts';

import { DomainError } from '../../platform/errors/domain-error.js';
import type { NodeHandler } from '../../platform/web/route.js';
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
      return signatureUploadOutput.parse(
        await signatures.replace(uploader.userId, { type, bytes }),
      );
    },
  });
}
