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
import { mapError } from '../errors/error-filter.js';
import { SettingError, type SettingsReader } from '../settings/settings-reader.js';
import { type RateLimitCounter, RateLimiter } from './rate-limit.guard.js';
import {
  acceptUpload,
  acceptUploadOfKind,
  AttachmentRefusedError,
  refuseImageFilename,
  sniffContentType,
  sniffUpload,
  UPLOAD_MAX_BYTES_SETTING,
  UPLOAD_RATE_LIMIT,
  type UploadGuard,
} from './upload.middleware.js';

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

// T020 (FR-151, research R-109): the kinds, the setting, the per-user limit, the one error shape.
describe('the upload kinds (T020, FR-151)', () => {
  // A PDF of 128 bytes: its signature, then padding, as the size cases need.
  const PDF = Buffer.concat([ascii('%PDF-1.7\n'), Buffer.alloc(119, 0x20)]);

  /** A guard over an in-memory limiter (`uploads` per user) and a settings row for the size. */
  function guardOf(
    options: { uploads?: number; maxBytes?: number | undefined } = {},
  ): UploadGuard & {
    reads: string[];
    counter: RateLimitCounter & { hits: number };
  } {
    const uploads = options.uploads ?? 100;
    const maxBytes = 'maxBytes' in options ? options.maxBytes : 1_000;
    const reads: string[] = [];
    const settings: SettingsReader = {
      read: async (key, schema) => {
        reads.push(key);
        if (key === UPLOAD_RATE_LIMIT) return schema.parse({ limit: uploads, window_seconds: 600 });
        if (key === UPLOAD_MAX_BYTES_SETTING && maxBytes !== undefined)
          return schema.parse(maxBytes);
        throw new SettingError(key, 'missing');
      },
    };
    const counts = new Map<string, number>();
    const counter = {
      hits: 0,
      hit: async (key: string) => {
        counter.hits += 1;
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return count;
      },
    };
    const rateLimiter = new RateLimiter({ settings, counter, subjectKey: Buffer.alloc(32, 1) });
    return { settings, rateLimiter, reads, counter };
  }

  const uploader = '0199d0a0-0000-7000-8000-000000000001';

  it('refuses a renamed image on a PDF kind, by its content, and accepts it as a photo', async () => {
    const guard = guardOf();
    for (const kind of ['identity', 'credential'] as const) {
      await expect(
        acceptUploadOfKind(guard, { kind, uploaderId: uploader, body: chunks(PNG, 7) }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    const photo = await acceptUploadOfKind(guard, {
      kind: 'photo',
      uploaderId: uploader,
      body: chunks(PNG, 7),
    });
    expect(photo.type).toBe('image/png');
    expect(await collect(photo.body)).toEqual(PNG);
    // A PDF is not a photo.
    await expect(
      acceptUploadOfKind(guard, { kind: 'photo', uploaderId: uploader, body: chunks(PDF, 16) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses an oversized file with the one error shape, as it streams, and never holds it whole', async () => {
    const guard = guardOf({ maxBytes: 32 });
    const upload = await acceptUploadOfKind(guard, {
      kind: 'identity',
      uploaderId: uploader,
      body: chunks(PDF, 8),
    });
    expect(upload.type).toBe('application/pdf');
    const received: Uint8Array[] = [];
    const failure = await (async () => {
      try {
        for await (const chunk of upload.body) received.push(chunk);
      } catch (error: unknown) {
        return error;
      }
      throw new Error('expected the body to be refused');
    })();
    expect(failure).toBeInstanceOf(DomainError);
    const mapped = mapError(failure);
    expect(mapped.status).toBe(413);
    expect(mapped.body).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The file is larger than allowed.',
    });
    // Four chunks of eight fit; the fifth crosses the limit and nothing after it is read.
    expect(received).toHaveLength(4);

    // A declared length over the limit is refused before a byte is read.
    let read = false;
    const unread = (async function* () {
      read = true;
      yield PDF;
    })();
    await expect(
      acceptUploadOfKind(guard, {
        kind: 'identity',
        uploaderId: uploader,
        body: unread,
        declaredLength: 33,
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(read).toBe(false);
  });

  it('reads the size limit from the settings reader on every upload, and fails closed without it', async () => {
    const guard = guardOf({ maxBytes: 64 });
    const exact = await acceptUploadOfKind(guard, {
      kind: 'credential',
      uploaderId: uploader,
      body: chunks(PDF.subarray(0, 64), 16),
    });
    expect(await collect(exact.body)).toHaveLength(64);
    expect(guard.reads.filter((key) => key === UPLOAD_MAX_BYTES_SETTING)).toHaveLength(1);

    const missing = guardOf({ maxBytes: undefined });
    await expect(
      acceptUploadOfKind(missing, {
        kind: 'credential',
        uploaderId: uploader,
        body: chunks(PDF, 16),
      }),
    ).rejects.toMatchObject({ key: UPLOAD_MAX_BYTES_SETTING, problem: 'missing' });
  });

  it('counts each uploader under rate_limit_upload before anything is read', async () => {
    const guard = guardOf({ uploads: 1 });
    await acceptUploadOfKind(guard, {
      kind: 'identity',
      uploaderId: uploader,
      body: chunks(PDF, 16),
    });
    await expect(
      acceptUploadOfKind(guard, { kind: 'identity', uploaderId: uploader, body: chunks(PDF, 16) }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    // Another uploader is another subject.
    await acceptUploadOfKind(guard, {
      kind: 'identity',
      uploaderId: '0199d0a0-0000-7000-8000-000000000002',
      body: chunks(PDF, 16),
    });
    expect(guard.counter.hits).toBe(3);
  });

  // T003 of specs/005-certification (FR-601, R-411; R-SEC-4): the `signature` kind, a PNG or a JPEG
  // decided by content. The guard never sees a name, so a renamed file is judged by its bytes.
  describe('the signature kind (T003 of specs/005-certification)', () => {
    const JPEG = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10), ascii('JFIF\0')]);
    const TEXT = Buffer.from('توقيع المعلم\n', 'utf8');

    it.each([
      ['a PNG', PNG, 'image/png'],
      ['a JPEG', JPEG, 'image/jpeg'],
    ] as const)('accepts %s by its content, every byte handed back', async (_name, body, type) => {
      const upload = await acceptUploadOfKind(guardOf(), {
        kind: 'signature',
        uploaderId: uploader,
        body: chunks(body, 5),
      });
      expect(upload.type).toBe(type);
      expect(await collect(upload.body)).toEqual(body);
    });

    it.each([
      ['a PDF', PDF],
      ['UTF-8 text', TEXT],
    ] as const)(
      'refuses %s, VALIDATION_FAILED, whatever it is named (R-SEC-4)',
      async (_name, body) => {
        await expect(
          acceptUploadOfKind(guardOf(), {
            kind: 'signature',
            uploaderId: uploader,
            body: chunks(body, 7),
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      },
    );
  });
});

// T038 of specs/004-sessions (FR-489, FR-490; R-SEC-4, R-SEC-5; research R-314; plan.md decision
// 12; the notes under T038): the `chat` kind. Refused whenever the sniffer names an image, whatever
// the name; a PDF by `%PDF-`; `text/plain` when no signature matches and the whole stream, checked as
// it streams, is UTF-8 with no WHATWG binary data byte and is not an SVG (an image written as text,
// the owner's Q1 (a)); anything else refused. A name with an image's extension is refused by
// `refuseImageFilename`, which the route calls after the content check. Each refusal is
// `ATTACHMENT_REFUSED` with no field on the wire, its cause kept on the error for the route's log.
describe('the chat kind (T038 of specs/004-sessions)', () => {
  const PDF = Buffer.concat([ascii('%PDF-1.7\n'), Buffer.alloc(119, 0x20), ascii('%%EOF\n')]);
  const ARABIC = Buffer.from(
    'بسم الله الرحمن الرحيم\nسورة الفاتحة، الآية ١\r\n\tتجويد\f\u001b',
    'utf8',
  );
  const uploader = '0199d0a0-0000-7000-8000-000000000001';

  function guardOf(): UploadGuard & { readonly limited: unknown[][] } {
    const limited: unknown[][] = [];
    const settings: SettingsReader = {
      read: async (key, schema) => {
        if (key === UPLOAD_MAX_BYTES_SETTING) return schema.parse(1_000_000);
        throw new SettingError(key, 'missing');
      },
    };
    const rateLimiter = {
      check: async (...args: unknown[]) => {
        limited.push(args);
      },
    } as unknown as RateLimiter;
    return { settings, rateLimiter, limited };
  }

  /** The chat kind's answer for `data`, its body read to the end: the type, or the refusal. */
  async function chatOutcome(data: Uint8Array, size = 7): Promise<string> {
    try {
      const upload = await acceptUploadOfKind(guardOf(), {
        kind: 'chat',
        uploaderId: uploader,
        body: chunks(data, size),
      });
      const received = await collect(upload.body);
      expect(received.equals(Buffer.from(data))).toBe(true);
      return upload.type;
    } catch (error: unknown) {
      if (error instanceof AttachmentRefusedError) {
        expect(error.code).toBe('ATTACHMENT_REFUSED');
        return `refused ${error.refusal}`;
      }
      throw error;
    }
  }

  it.each([
    ['a PNG', PNG],
    ['a JPEG', bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46)],
    ['a GIF87a', ascii('GIF87a\x01\x00\x01\x00')],
    ['a GIF89a', ascii('GIF89a\x01\x00\x01\x00')],
    ['a WebP', ascii('RIFF\x24\x00\x00\x00WEBPVP8 ')],
    ['a BMP', ascii('BM\x3a\x00\x00\x00\x00\x00')],
    ['an icon', bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00)],
    ['a cursor', bytes(0x00, 0x00, 0x02, 0x00, 0x01, 0x00)],
    ['a little-endian TIFF', bytes(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00)],
    ['a big-endian TIFF', bytes(0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08)],
    ['a HEIC photo', ftyp('heic', 'mif1', 'heic')],
    ['a HEIF image', ftyp('mif1', 'mif1')],
    ['an AVIF image', ftyp('avif', 'mif1', 'miaf')],
  ])('refuses %s by its content, ATTACHMENT_REFUSED (image_content)', async (_, data) => {
    expect(await chatOutcome(data)).toBe('refused image_content');
  });

  it('accepts a PDF by %PDF-, every byte handed back', async () => {
    expect(await chatOutcome(PDF)).toBe('application/pdf');
  });

  it('accepts UTF-8 text as text/plain, a character split across chunks, tab, line ends, form feed and escape allowed', async () => {
    expect(await chatOutcome(ARABIC, 1)).toBe('text/plain');
    expect(await chatOutcome(Buffer.concat([bytes(0xef, 0xbb, 0xbf), ARABIC]), 3)).toBe(
      'text/plain',
    );
  });

  it.each([0x00, 0x01, 0x08, 0x0b, 0x0e, 0x1a, 0x1c, 0x1f])(
    'refuses text carrying the binary data byte %d, found as it streams (not_text)',
    async (byte) => {
      const data = Buffer.concat([ARABIC, ARABIC, bytes(byte), ascii('tail')]);
      expect(await chatOutcome(data)).toBe('refused not_text');
    },
  );

  it('refuses the stream at the chunk that carries the binary byte, after the earlier chunks', async () => {
    const data = Buffer.concat([Buffer.alloc(64, 0x61), bytes(0x00), Buffer.alloc(64, 0x61)]);
    const upload = await acceptUploadOfKind(guardOf(), {
      kind: 'chat',
      uploaderId: uploader,
      body: chunks(data, 16),
    });
    const received: Uint8Array[] = [];
    await expect(
      (async () => {
        for await (const chunk of upload.body) received.push(chunk);
      })(),
    ).rejects.toBeInstanceOf(AttachmentRefusedError);
    expect(Buffer.concat(received).byteLength).toBe(64);
  });

  it.each([
    ['a lone continuation byte', Buffer.concat([ARABIC, bytes(0x80), ascii('x')])],
    ['an invalid lead byte', Buffer.concat([ascii('note '), bytes(0xff), ascii('x')])],
    ['an overlong encoding', Buffer.concat([ascii('a'), bytes(0xc0, 0xaf)])],
    ['a sequence cut short at the end', Buffer.concat([ARABIC, bytes(0xd8)])],
    ['Latin-1 text', Buffer.from('café résumé', 'latin1')],
    ['a document in a ZIP container', bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)],
  ])('refuses %s as not text (not_text)', async (_, data) => {
    expect(await chatOutcome(data)).toBe('refused not_text');
  });

  const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect/></svg>';

  it.each([
    ['an SVG', SVG],
    ['an SVG after a byte-order mark and white space', `${BYTE_ORDER_MARK} \n\t${SVG}`],
    ['an SVG after an XML declaration', `<?xml version="1.0" encoding="UTF-8"?>\n${SVG}`],
    ['an SVG after a comment', `<!-- drawn by hand -->\n${SVG}`],
    [
      'an SVG after a doctype',
      `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${SVG}`,
    ],
    ['an upper-case SVG element', '<SVG></SVG>'],
    ['an SVG element closed at once', '<svg/>'],
    ['a doctype naming svg whatever follows', '<!DOCTYPE svg>\n<g/>'],
    [
      'an SVG after a processing instruction and two comments',
      '<?xml-stylesheet href="a.css"?><!--a--><!--b-->\r\n<svg>',
    ],
  ])('refuses %s as an image by its content (image_content)', async (_, text) => {
    expect(await chatOutcome(Buffer.from(text, 'utf8'), 1)).toBe('refused image_content');
    expect(await chatOutcome(Buffer.from(text, 'utf8'), 64)).toBe('refused image_content');
  });

  it.each([
    ['a text mentioning an SVG later', `ملاحظة: ${SVG}`],
    ['an element whose name only starts with svg', '<svgnote>نص</svgnote>'],
    ['an XML file of another kind', '<?xml version="1.0"?>\n<notes><n>تجويد</n></notes>'],
    ['a comment and nothing else', '<!-- just a comment -->\n'],
    ['an empty file', ''],
  ])('accepts %s as text/plain', async (_, text) => {
    expect(await chatOutcome(Buffer.from(text, 'utf8'), 2)).toBe('text/plain');
  });

  it('answers a refusal as ATTACHMENT_REFUSED, 400, with no field and nothing of the cause', async () => {
    const failure = await acceptUploadOfKind(guardOf(), {
      kind: 'chat',
      uploaderId: uploader,
      body: chunks(PNG, 7),
    }).catch((error: unknown) => error);
    const mapped = mapError(failure);
    expect(mapped.status).toBe(400);
    expect(mapped.body).toEqual({
      code: 'ATTACHMENT_REFUSED',
      message: 'This file cannot be sent in the chat.',
    });
  });

  it('counts the uploader under rate_limit_upload as uploads.chat, before anything is read', async () => {
    const guard = guardOf();
    await acceptUploadOfKind(guard, { kind: 'chat', uploaderId: uploader, body: chunks(PDF, 9) });
    expect(guard.limited).toEqual([
      [UPLOAD_RATE_LIMIT, { kind: 'user', userId: uploader }, 'uploads.chat'],
    ]);
  });

  it.each([
    'photo.png',
    'PHOTO.PNG',
    'scan.jpg',
    'scan.jpeg',
    'a.gif',
    'a.webp',
    'a.bmp',
    'a.ico',
    'a.tif',
    'a.tiff',
    'a.heic',
    'a.heif',
    'a.avif',
    'drawing.svg',
    'drawing.svgz',
    'تجويد.pdf.png',
    'photo.png.',
    'photo.png ',
    '.png',
  ])('refuses the name %j by its image extension (image_extension)', (filename) => {
    let thrown: unknown;
    try {
      refuseImageFilename(filename);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AttachmentRefusedError);
    expect((thrown as AttachmentRefusedError).refusal).toBe('image_extension');
  });

  it.each(['تجويد.pdf', 'notes.txt', 'png', 'photo.png.pdf', 'a.svg.txt', 'readme'])(
    'admits the name %j',
    (filename) => {
      expect(() => {
        refuseImageFilename(filename);
      }).not.toThrow();
    },
  );

  // The review session's condition 1 of 2026-11-11 on T038's route change: the document and photo
  // kinds keep their behaviour, so UTF-8 text is still refused there.
  it.each(['identity', 'credential', 'photo'] as const)(
    'still refuses UTF-8 text on the %s kind, VALIDATION_FAILED',
    async (kind) => {
      await expect(
        acceptUploadOfKind(guardOf(), { kind, uploaderId: uploader, body: chunks(ARABIC, 7) }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
});
