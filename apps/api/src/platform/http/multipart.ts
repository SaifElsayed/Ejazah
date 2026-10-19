// T024: the one multipart reading the API does: the first file of a `multipart/form-data` body,
// with the fields that came before it (public-pages.md "The uploads route": one file, a `kind`
// field). The parser is `busboy`, streaming, the one Nest's own multer runs on; the file's stream is
// handed on unread, so the kinds guard (`guards/upload.middleware.ts`) sniffs its type and bounds
// its size as it streams, and nothing of the file is held here.
//
// What is refused, each as a validation failure in the kernel's shape: a body that is not
// multipart, one that ends without a file, and a field past the small limits a form's text fields
// need. A second file is ignored (busboy's `files: 1` skips it), and a field after the file is not
// read: the `kind` precedes the file, as the phone app sends it.
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import busboy from 'busboy';
import { DomainError } from '../errors/domain-error.js';

export interface MultipartFile {
  /** The text fields that preceded the file, by name. */
  readonly fields: ReadonlyMap<string, string>;
  /** The file's bytes, unread. */
  readonly stream: Readable;
  /** The name the client gave the file, when it gave one. */
  readonly filename: string | undefined;
}

export interface MultipartLimits {
  /** How many text fields a body may carry. */
  readonly fields: number;
  /** The longest text field, in bytes. */
  readonly fieldBytes: number;
}

function notMultipart(): DomainError {
  return new DomainError('VALIDATION_FAILED', 'The request is not a multipart upload.');
}

/** The first file of the request's multipart body, once it starts, with the fields before it. */
export function firstFileOf(
  request: IncomingMessage,
  limits: MultipartLimits,
): Promise<MultipartFile> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof busboy>;
    try {
      parser = busboy({
        headers: request.headers,
        limits: {
          files: 1,
          fields: limits.fields,
          fieldSize: limits.fieldBytes,
          parts: limits.fields + 1,
        },
      });
    } catch {
      reject(notMultipart());
      return;
    }
    const fields = new Map<string, string>();
    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      outcome();
    };
    parser.on('field', (name, value, info) => {
      if (info.nameTruncated || info.valueTruncated) {
        settle(() =>
          reject(
            new DomainError('VALIDATION_FAILED', 'A field is too long.', {
              details: [{ path: name, code: 'too_long' }],
            }),
          ),
        );
        return;
      }
      fields.set(name, value);
    });
    parser.on('file', (_name, stream, info) => {
      if (settled) {
        stream.resume();
        return;
      }
      settle(() =>
        resolve({ fields, stream, filename: info.filename === '' ? undefined : info.filename }),
      );
    });
    parser.on('error', () => settle(() => reject(notMultipart())));
    parser.on('close', () =>
      settle(() =>
        reject(
          new DomainError('VALIDATION_FAILED', 'A file is required.', {
            details: [{ path: 'file', code: 'required' }],
          }),
        ),
      ),
    );
    request.pipe(parser);
  });
}
