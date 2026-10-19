// T024: what the upload specs share: a PDF's leading bytes and a multipart body built by hand, so
// no spec depends on a client library's encoding. Not a spec itself; imported by the specs of the
// helper and of the two routes.
import { addSeconds } from '@ijazah/time';

/** A PDF's leading bytes, padded past the sniffing head. */
export function pdfBytes(size = 512): Buffer {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.write('%PDF-1.4\n', 0, 'latin1');
  return bytes;
}

export interface MultipartPart {
  readonly name: string;
  readonly value?: string;
  readonly filename?: string;
  readonly type?: string;
  readonly bytes?: Buffer;
}

/** A multipart/form-data body of `parts`, in order, and its content type. */
export function multipart(parts: readonly MultipartPart[]): {
  body: Buffer;
  contentType: string;
} {
  const boundary = 'ijazah-boundary-7f3e';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.bytes !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename ?? 'file.bin'}"\r\nContent-Type: ${part.type ?? 'application/octet-stream'}\r\n\r\n`,
        ),
        part.bytes,
        Buffer.from('\r\n'),
      );
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value ?? ''}\r\n`,
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export interface StorageCall {
  readonly operation: 'put' | 'remove' | 'exists' | 'temporaryLink';
  readonly args: readonly unknown[];
}

/**
 * A storage port for a spec outside the port's folder, which may name no adapter (R-API-4): it
 * keeps objects in memory, records each operation, and issues links that read the key until their
 * moment has passed, as the real links do; `now` is the clock a spec moves.
 */
export function storageStub(options: { readonly now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date());
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const links = new Map<string, { key: string; expires: string }>();
  const calls: StorageCall[] = [];
  let issued = 0;
  return {
    calls,
    async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
      calls.push({ operation: 'put', args: [key, body, contentType] });
      objects.set(key, { body: Uint8Array.from(body), contentType });
    },
    async remove(key: string): Promise<void> {
      calls.push({ operation: 'remove', args: [key] });
      objects.delete(key);
    },
    async exists(key: string): Promise<boolean> {
      calls.push({ operation: 'exists', args: [key] });
      return objects.has(key);
    },
    async temporaryLink(key: string, expiresInSeconds: number): Promise<string> {
      calls.push({ operation: 'temporaryLink', args: [key, expiresInSeconds] });
      issued += 1;
      const expires = addSeconds(now(), expiresInSeconds);
      const url = `http://link.invalid/files/${encodeURIComponent(key)}?expires=${expires}&signature=stub-${issued}`;
      links.set(url, { key, expires });
      return url;
    },
    /** The key a link reads while its moment has not passed; else undefined. */
    verifyLink(url: string): string | undefined {
      const link = links.get(url);
      if (link === undefined || !(new Date(link.expires) > now())) return undefined;
      return link.key;
    },
    stored(key: string): { body: Uint8Array; contentType: string } | undefined {
      return objects.get(key);
    },
  };
}
