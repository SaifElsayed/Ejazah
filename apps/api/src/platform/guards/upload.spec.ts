// T097 — upload content sniffing (FR-044, R-SEC-4; research R-16; contracts/kernel.md "Guards
// applied by default").
//
// An upload's type is what its leading bytes are, never what the client says. The central case is
// a renamed image: a real PNG sent as `scan.pdf` and declared `application/pdf` is an image. The
// declaration is not compared with the content, it is discarded: the sniffer takes the bytes and
// nothing else, so a declaration has no way in (a `@ts-expect-error` case), and no answer can depend
// on one. The signatures are the WHATWG MIME Sniffing Standard's for PDF and images, plus TIFF and
// the HEIF family (HEIC, AVIF), which phones produce and the standard does not list.
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { acceptUpload, sniffContentType, sniffUpload } from './upload.middleware.js';

// A real 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const ascii = (text: string) => Buffer.from(text, 'latin1');
const bytes = (...values: number[]) => Buffer.from(values);

/** An ISO base media file's first box: `ftyp`, the major brand, a minor version, compatible brands. */
function ftyp(major: string, ...compatible: string[]): Buffer {
  const size = 16 + 4 * compatible.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write('ftyp', 4, 'latin1');
  return Buffer.concat([header, ascii(major), bytes(0, 0, 0, 0), ...compatible.map(ascii)]);
}

/** The bytes split into chunks of `size`, as a request stream delivers them. */
async function* chunks(data: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let start = 0; start < data.byteLength; start += size) {
    yield data.subarray(start, start + size);
  }
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of body) parts.push(part);
  return Buffer.concat(parts);
}

/** What a client sends beside the bytes: never read by the sniffer. */
const renamed = { filename: 'scan.pdf', declaredType: 'application/pdf', body: PNG };

describe('content sniffing (T097, FR-044)', () => {
  it('judges a renamed image by its content: a PNG sent as scan.pdf, declared a PDF, is a PNG', async () => {
    const upload = await sniffUpload(chunks(renamed.body, 16));

    expect(upload.type).toBe('image/png');
    expect(upload.type).not.toBe(renamed.declaredType);
  });

  it('discards the declaration rather than comparing it: there is no way to hand one in', async () => {
    // @ts-expect-error -- T097: the sniffer takes the bytes alone; a declaration is no argument (R-SEC-4)
    const upload = await sniffUpload(chunks(renamed.body, 16), renamed);
    expect(upload.type).toBe('image/png');

    // @ts-expect-error -- T097: nor does the synchronous form take a declared type (R-SEC-4)
    expect(sniffContentType(PNG, 'application/pdf')).toBe('image/png');
  });

  it('refuses the renamed image on a path that accepts PDF only', async () => {
    await expect(acceptUpload(chunks(renamed.body, 16), ['application/pdf'])).rejects.toEqual(
      new DomainError('VALIDATION_FAILED', 'This type of file is not accepted.'),
    );
  });

  it('accepts a real PDF on that path, and hands back every byte', async () => {
    const pdf = Buffer.concat([ascii('%PDF-1.7\n'), Buffer.alloc(5000, 0x20), ascii('%%EOF\n')]);

    const upload = await acceptUpload(chunks(pdf, 7), ['application/pdf']);

    expect(upload.type).toBe('application/pdf');
    expect((await collect(upload.body)).equals(pdf)).toBe(true);
  });

  it.each([
    ['a PNG', PNG, 'image/png'],
    ['a JPEG', bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46), 'image/jpeg'],
    ['a GIF87a', ascii('GIF87a\x01\x00\x01\x00'), 'image/gif'],
    ['a GIF89a', ascii('GIF89a\x01\x00\x01\x00'), 'image/gif'],
    ['a WebP', ascii('RIFF\x24\x00\x00\x00WEBPVP8 '), 'image/webp'],
    ['a BMP', ascii('BM\x3a\x00\x00\x00\x00\x00'), 'image/bmp'],
    ['an icon', bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00), 'image/x-icon'],
    ['a cursor', bytes(0x00, 0x00, 0x02, 0x00, 0x01, 0x00), 'image/x-icon'],
    ['a little-endian TIFF', bytes(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00), 'image/tiff'],
    ['a big-endian TIFF', bytes(0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08), 'image/tiff'],
    ['a HEIC photo', ftyp('heic', 'mif1', 'heic'), 'image/heic'],
    ['a HEIF image', ftyp('mif1', 'mif1'), 'image/heif'],
    ['an AVIF image', ftyp('avif', 'mif1', 'miaf'), 'image/avif'],
    ['a HEIF whose compatible brand is HEIC', ftyp('mif1', 'heic'), 'image/heic'],
    ['a PDF', ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'), 'application/pdf'],
  ])('recognises %s by its leading bytes', async (_, data, type) => {
    expect(sniffContentType(data)).toBe(type);
    expect((await sniffUpload(chunks(data, 1))).type).toBe(type);
  });

  it.each([
    ['plain text', ascii('hello, this is a note\n')],
    ['a document in a ZIP container', bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)],
    ['an audio RIFF', ascii('RIFF\x24\x00\x00\x00WAVEfmt ')],
    ['a video ISO file', ftyp('isom', 'isom', 'mp41')],
    ['a PDF signature cut short', ascii('%PD')],
    ['a JPEG signature cut short', bytes(0xff, 0xd8)],
    ['nothing at all', Buffer.alloc(0)],
  ])('answers no type for %s, so nothing unknown passes as a known type', async (_, data) => {
    expect(sniffContentType(data)).toBeUndefined();
    expect((await sniffUpload(chunks(data, 3))).type).toBeUndefined();
    await expect(acceptUpload(chunks(data, 3), ['image/png', 'application/pdf'])).rejects.toThrow(
      DomainError,
    );
  });

  it('reads only the leading bytes before deciding, then hands back the whole body unchanged', async () => {
    const tail = Buffer.alloc(200_000);
    for (let index = 0; index < tail.byteLength; index += 1) tail[index] = (index * 31) % 251;
    const data = Buffer.concat([PNG, tail]);
    let delivered = 0;
    async function* counted(): AsyncIterable<Uint8Array> {
      for await (const part of chunks(data, 4093)) {
        delivered += part.byteLength;
        yield part;
      }
    }

    const upload = await sniffUpload(counted());
    expect(upload.type).toBe('image/png');
    expect(delivered).toBeLessThan(data.byteLength);

    expect((await collect(upload.body)).equals(data)).toBe(true);
    expect(delivered).toBe(data.byteLength);
  });
});
